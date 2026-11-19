import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = path.resolve('.');
const directory = path.join(root, 'data', `network-test-${randomUUID()}`);
await fs.mkdir(directory, { recursive: true });
const server = spawn(process.execPath, ['server.mjs'], { windowsHide: true, env: { ...process.env, PORT: '3102', DATA_DIR: directory, MODEL_CACHE: path.join(root, 'data/models') } });
server.stdout.on('data', chunk => process.stdout.write(chunk));
server.stderr.on('data', chunk => process.stderr.write(chunk));
const base = 'http://127.0.0.1:3102';
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { if ((await fetch(base + '/api/stats')).ok) { ready = true; break; } } catch { /* Startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Server did not start');
  const source = process.argv[2] || 'https://www.w3schools.com/html/mov_bbb.mp4';
  const pipeline = process.argv[3] === 'pipeline';
  if (pipeline) {
    const detection = await fetch(base + '/api/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source }) });
    const metadata = await detection.json();
    assert.equal(detection.status, 200, JSON.stringify(metadata));
    console.log(`Detected ${metadata.live ? 'LIVE' : 'VIDEO'}: ${metadata.title}`);
  }
  const response = await fetch(base + (pipeline ? '/api/process-link' : '/api/capture'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: source, mode: 'video', start: 0, duration: pipeline ? 8 : 3,
    clipDuration: 3, maxClips: 1, preset: 'viral', ratio: '16:9', resolution: 1080, transcribe: false, rightsConfirmed: true }) });
  let job = await response.json();
  let reviewed = false;
  assert.equal(response.status, 202, JSON.stringify(job));
  let complete = false;
  for (let attempt = 0; attempt < 360; attempt++) {
    const jobs = await (await fetch(base + '/api/jobs')).json();
    const current = jobs.find(item => item.id === job.id);
    assert.ok(['queued', 'running', 'done'].includes(current.status), current.error);
    if (current.status === 'done') {
      if (pipeline && !reviewed) {
        assert.equal(current.result.reviewRequired, true);
        assert.deepEqual(current.result.exports, []);
        console.log(`Review ready: ${current.result.highlights.length} prominent candidates`);
        const range = current.result.highlights[0] || { start: 0, end: 3, title: 'Manually reviewed test range' };
        const selected = await fetch(base + '/api/review/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          sourceId: current.result.sourceId, ranges: [range], options: { preset: 'viral', ratio: '16:9', resolution: 1080, captions: false }, transcribe: false
        }) });
        job = await selected.json();
        assert.equal(selected.status, 202, JSON.stringify(job));
        reviewed = true;
        continue;
      }
      const output = pipeline ? current.result.exports[0] : current.result;
      assert.ok(output.duration > 0 && output.duration < 4);
      if (pipeline) { assert.equal(output.width, 1920); assert.equal(output.height, 1080); }
      console.log(`PASS ${pipeline ? 'link → edited MP4' : 'public URL import'}: ${output.width}x${output.height}, ${output.duration}s`);
      complete = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(complete, 'Online import timed out');
} finally {
  server.kill();
  await new Promise(resolve => server.once('close', resolve));
  assert.equal(path.dirname(directory), path.join(root, 'data'));
  assert.match(path.basename(directory), /^network-test-[0-9a-f-]{36}$/);
  await fs.rm(directory, { recursive: true, force: true });
}
