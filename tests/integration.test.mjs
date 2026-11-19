import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve('.');
const executable = name => path.join(root, 'tools', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
function command(name, args) {
  const result = spawnSync(executable(name), args, { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
test('upload, local AI, projects, effects, compilations, and export workflow', { timeout: 360000 }, async t => {
  const directory = path.join(root, 'data', `test-${randomUUID()}`);
  await fs.mkdir(directory, { recursive: true });
  const port = 3101;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), DATA_DIR: directory, MODEL_CACHE: path.join(root, 'data/models') } });
  let serverLog = '';
  server.stderr.on('data', chunk => { serverLog += chunk; });
  server.stdout.on('data', chunk => { serverLog += chunk; });
  async function api(route, body, expected = 200, method = 'POST') {
    const response = await fetch(base + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  async function wait(job) {
    for (let attempt = 0; attempt < 240; attempt++) {
      const jobs = await api('/api/jobs');
      const current = jobs.find(item => item.id === job.id);
      if (current.status === 'done') return current.result;
      assert.ok(['queued', 'running'].includes(current.status), current.error);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out ${job.id}`);
  }
  async function upload(file, name) {
    const buffer = await fs.readFile(file);
    const session = await api('/api/uploads', { name, size: buffer.length, rightsConfirmed: true });
    const midpoint = Math.floor(buffer.length / 2);
    for (const [start, end] of [[0, midpoint], [midpoint, buffer.length]]) {
      const response = await fetch(`${base}/api/uploads/${session.id}`, { method: 'PATCH', headers: { 'Upload-Offset': String(start), 'Content-Type': 'application/octet-stream' }, body: buffer.subarray(start, end) });
      assert.equal(response.status, 200, await response.text());
      const status = await api(`/api/uploads/${session.id}`);
      assert.equal(status.offset, end);
    }
    const item = await api(`/api/uploads/${session.id}/complete`, {});
    assert.equal((await api(`/api/uploads/${session.id}/complete`, {})).id, item.id);
    return item;
  }
  function probe(item) { return JSON.parse(command('ffprobe', ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', path.join(directory, item.file)])); }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { const response = await fetch(base + '/api/stats'); if (response.ok) { ready = true; break; } } catch { /* Wait for startup. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, serverLog);
    const fixture = path.join(directory, 'fixture.mp4');
    const speech = path.join(root, 'data/test-speech.wav');
    await fs.access(speech);
    command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15', '-i', speech, '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,3)+between(t,8,11)+gt(t,16)'", '-af', 'apad', '-t', '18', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture]);
    const source = await upload(fixture, 'Acceptance test recording.mp4');
    assert.equal(source.width, 320);
    await api('/api/uploads', { name: 'test.mp4', size: 50, rightsConfirmed: false }, 400);
    t.diagnostic('Resumable upload and rights validation passed');
    for (const mode of ['video', 'live']) {
      const captured = await wait(await api('/api/capture', { url: `${base}/media/${source.id}`, mode, start: 0, duration: 2, rightsConfirmed: true }, 202));
      assert.ok(Math.abs(captured.duration - 2) < .3);
    }
    t.diagnostic('Timestamp URL import and timed recording pipelines passed against local HTTP video');
    const detected = await api('/api/inspect', { url: `${base}/media/${source.id}` });
    assert.equal(detected.live, false);
    const linkResult = await wait(await api('/api/process-link', { url: `${base}/media/${source.id}`, duration: 8, clipDuration: 3, maxClips: 2,
      preset: 'viral', ratio: '16:9', resolution: 360, transcribe: true, rightsConfirmed: true }, 202));
    assert.equal(linkResult.reviewRequired, true);
    assert.deepEqual(linkResult.exports, []);
    assert.equal((await api('/api/library')).filter(item => item.kind === 'export').length, 0);
    const capturedSource = (await api('/api/library')).find(item => item.id === linkResult.sourceId);
    assert.ok(capturedSource.duration >= 7.9);
    const reviewed = await wait(await api('/api/review/export', { sourceId: capturedSource.id,
      ranges: [{ start: 0, end: 2, title: 'First manually reviewed range' }, { start: 4, end: 7, title: 'Second reviewed range' }],
      options: { preset: 'viral', ratio: '9:16', resolution: 360, captions: true }, transcribe: true }, 202));
    assert.equal(reviewed.exports.length, 2);
    assert.notEqual(reviewed.exports[0].file, reviewed.exports[1].file);
    assert.ok(reviewed.exports.every(item => item.width === 360 && item.height === 640));
    assert.ok(Math.abs(reviewed.exports[0].duration - 2) < .2);
    assert.ok(Math.abs(reviewed.exports[1].duration - 3) < .2);
    for (const item of reviewed.exports) command('ffmpeg', ['-v', 'error', '-i', path.join(directory, item.file), '-f', 'null', '-']);
    assert.notEqual(capturedSource.file, reviewed.exports[0].file);
    const devOrigin = await fetch(base + '/api/inspect', { method: 'POST', headers: { Origin: 'http://localhost:5175', 'Content-Type': 'application/json' }, body: JSON.stringify({ url: `${base}/media/${source.id}` }) });
    assert.equal(devOrigin.status, 200);
    t.diagnostic('Link analysis waits for review; manually chosen ranges export exactly, with preview byte ranges and non-default frontend ports');

    const analysis = await wait(await api('/api/analyze', { sourceId: source.id, transcribe: true, model: 'base', language: 'en', clipDuration: 4, maxClips: 2, mode: 'balanced' }, 202));
    assert.ok(analysis.highlights.length >= 1, JSON.stringify(analysis));
    const [first, second] = analysis.highlights;
    if (second) assert.ok(first.end <= second.start || second.end <= first.start);
    assert.ok(analysis.highlights.every(item => item.prominence >= .09));
    const updated = (await api('/api/library')).find(item => item.id === source.id);
    const transcriptText = updated.transcript.segments.map(segment => segment.text).join(' ');
    assert.match(transcriptText.toLowerCase(), /country/);
    assert.ok(updated.transcript.segments.some(segment => segment.words.length));
    t.diagnostic(`Real Faster-Whisper transcription passed: ${transcriptText}`);

    const timeline = { title: 'Verified vertical export', preset: 'viral', ratio: '9:16', resolution: 1080, fps: 30,
      clips: [{ id: randomUUID(), sourceId: source.id, start: 0, end: 4 }], captions: true };
    const project = await api('/api/projects', { title: timeline.title, timeline });
    assert.equal((await api('/api/projects'))[0].timeline.clips[0].end, 4);
    const vertical = await wait(await api('/api/export', timeline, 202));
    const info = probe(vertical);
    const video = info.streams.find(stream => stream.codec_type === 'video');
    assert.equal(video.width, 1080); assert.equal(video.height, 1920);
    assert.ok(Math.abs(Number(info.format.duration) - 4) < .2);
    assert.ok(info.streams.some(stream => stream.codec_type === 'audio'));
    assert.ok(vertical.subtitleCount > 0);
    const captions = await (await fetch(`${base}/media/${vertical.id}?format=srt`)).text();
    assert.match(captions, /-->/);
    const range = await fetch(`${base}/media/${vertical.id}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    command('ffmpeg', ['-v', 'error', '-i', path.join(directory, vertical.file), '-f', 'null', '-']);
    t.diagnostic('1080p portrait, captions, source audio, decode, and download passed');

    const music = await upload(speech, 'Licensed test audio.wav');
    const compilation = await wait(await api('/api/export', { title: 'Verified compilation', preset: 'cinematic', ratio: '1:1', resolution: 360, fps: 30,
      transition: 'fade', musicId: music.id, musicVolume: .1, overlay: 'Verified title', speed: .75,
      clips: [{ id: randomUUID(), type: 'title', text: 'Noah Test', duration: 1.5 }, { id: randomUUID(), sourceId: source.id, start: 0, end: 2 }, { id: randomUUID(), sourceId: source.id, start: 3, end: 5 }] }, 202));
    const compilationInfo = probe(compilation);
    assert.equal(compilationInfo.streams[0].width, 360);
    assert.equal(compilationInfo.streams[0].height, 360);
    assert.ok(Math.abs(Number(compilationInfo.format.duration) - (1.5 + 4 / .75 - .6)) < .25);
    t.diagnostic('Title card, slow motion, music mix, crossfades, overlay, and square canvas passed');

    const silentFile = path.join(directory, 'silent.mp4');
    command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=1', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '6', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', silentFile]);
    const silent = await upload(silentFile, 'Silent recording.mp4');
    const empty = await wait(await api('/api/analyze', { sourceId: silent.id, transcribe: true, clipDuration: 3 }, 202));
    assert.equal(empty.highlights.length, 0);
    const silentUpdated = (await api('/api/library')).find(item => item.id === silent.id);
    assert.deepEqual(silentUpdated.transcript.segments, []);
    const quietLink = await wait(await api('/api/process-link', { url: `${base}/media/${silent.id}`, duration: 3, clipDuration: 2, maxClips: 1,
      preset: 'clean', ratio: '9:16', resolution: 360, transcribe: false, rightsConfirmed: true }, 202));
    assert.equal(quietLink.exports.length, 0);
    assert.equal(quietLink.highlights.length, 0);
    assert.equal(quietLink.reviewRequired, true);
    assert.ok(quietLink.note);
    const silentExport = await wait(await api('/api/export', { sourceId: silent.id, start: 0, end: 2, ratio: '4:5', resolution: 360, preset: 'clean', effect: 'none' }, 202));
    assert.equal(probe(silentExport).streams[0].height, 450);
    t.diagnostic('Silent sources produce no fake dialogue and export successfully');

    const batch = await api('/api/batch', { highlights: analysis.highlights.map(item => item.id), options: { ratio: '16:9', resolution: 360, preset: 'clean' } }, 202);
    for (const job of batch) assert.equal((await wait(job)).kind, 'export');
    const combined = await wait(await api('/api/compilation', { highlights: analysis.highlights.map(item => item.id), targetMinutes: .1, options: { ratio: '16:9', resolution: 360, preset: 'clean' } }, 202));
    assert.ok(combined.duration < 6.4);
    t.diagnostic('Batch and target-duration compilation passed');
    const silenceCut = await wait(await api('/api/export', { sourceId: source.id, start: 0, end: 18, ratio: '16:9', resolution: 360, preset: 'clean', removeSilence: true }, 202));
    assert.ok(silenceCut.duration < 17 && silenceCut.duration > 5, `silence cut duration ${silenceCut.duration}`);
    assert.ok(silenceCut.subtitleCount > 0);
    t.diagnostic('Silence removal preserves caption and audio alignment');
    const automatic = await wait(await api('/api/auto', { clips: [], sourceId: source.id, clipDuration: 3, maxClips: 1, transcribe: true, ratio: '4:5', resolution: 360, preset: 'clean' }, 202));
    assert.equal(automatic.reviewRequired, true);
    assert.equal(automatic.renderJobs, undefined);
    t.diagnostic('Auto Editor also waits for candidate review');

    const longFile = path.join(directory, 'long-recording.mp4');
    command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=1', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1800', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-pix_fmt', 'yuv420p', longFile]);
    const longSource = await upload(longFile, '30 minute synthetic recording.mp4');
    assert.ok(longSource.duration >= 1800);
    const longAnalysis = await wait(await api('/api/analyze', { sourceId: longSource.id, clipDuration: 30, maxClips: 3, mode: 'fast' }, 202));
    assert.equal(longAnalysis.highlights.length, 0);
    assert.ok(longAnalysis.highlights.every(item => item.end <= longSource.duration));
    await api('/api/review/export', { sourceId: longSource.id, ranges: [{ start: 0, end: 121 }], options: { ratio: '9:16' }, transcribe: false }, 400);
    await api('/api/export', { sourceId: longSource.id, start: 0, end: 121, ratio: '9:16', preset: 'clean' }, 400);
    await api('/api/review/export', { sourceId: longSource.id, ranges: [{ start: 0, end: 1200 }], outputKind: 'long', targetMinutes: 15, options: { ratio: '16:9' } }, 400);
    const longOutput = await wait(await api('/api/review/export', { sourceId: longSource.id,
      ranges: [{ start: 0, end: 1200, title: 'Reviewed 20 minute video' }], outputKind: 'long', targetMinutes: 20,
      options: { ratio: '16:9', preset: 'clean', resolution: 360, fps: 30, normalize: false, captions: false }, transcribe: false }, 202));
    assert.ok(Math.abs(longOutput.exports[0].duration - 1200) < .2);
    assert.equal(longOutput.exports[0].width, 640);
    assert.equal(longOutput.exports[0].height, 360);
    t.diagnostic('30-minute analysis selects no fake peaks; two-minute portrait cap and real 20-minute landscape export passed');
    await api('/api/export', { ...timeline, clips: [{ sourceId: source.id, start: 4, end: 1 }] }, 400);
    assert.ok(project.id);
  } finally {
    server.kill();
    await new Promise(resolve => server.once('close', resolve));
    // Restrict test cleanup to the exact UUID directory created above.
    assert.equal(path.dirname(directory), path.join(root, 'data'));
    assert.match(path.basename(directory), /^test-[0-9a-f-]{36}$/);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
