import { Router } from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, ROOT, numeric } from './store.mjs';
import { binary, enqueue, register, run } from './jobs.mjs';
import { playbackMetadata, playbackInputs, addMedia } from './media.mjs';
import { processLink } from './pipeline.mjs';

export const playback = Router();
const directory = path.join(DATA, 'playback');
await fs.mkdir(directory, { recursive: true });
const sessions = new Map();
register('buffered-clip', async (payload, job) => {
  const folder = path.join(directory, payload.snapshot);
  const file = path.join(DATA, `${job.id}-source.mp4`);
  let complete = false;
  try {
    await run('ffmpeg', ['-y', '-v', 'warning', '-f', 'concat', '-safe', '1', '-i', path.join(folder, 'clips.txt'), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', file], job);
    const source = await addMedia(file, 'Buffered live clip', 'recording', { sourceUrl: payload.url, sourceStart: payload.bufferStart, captureQuality: 'source-copy', rightsConfirmedAt: Date.now() });
    const result = await processLink({ ...payload, resumeSourceId: source.id, manualClip: !payload.autoAnalyze, detectionMode: payload.autoAnalyze ? 'auto' : 'manual', reviewFirst: true }, job);
    if (!payload.autoAnalyze) result.manualRanges = [{ id: randomUUID(), start: payload.offset, end: Math.min(source.duration, payload.offset + payload.duration), title: payload.chatSpike ? 'Chat reaction moment' : 'Selected live moment' }];
    complete = true;
    return result;
  } finally {
    if (complete && path.dirname(folder) === directory && /^[0-9a-f-]{36}$/.test(payload.snapshot)) await fs.rm(folder, { recursive: true, force: true });
  }
});
async function segmentsFor(session) {
  const list = await fs.readFile(path.join(session.folder, 'original.csv'), 'utf8');
  return [...list.matchAll(/^"?(original-\d+\.mkv)"?,([\d.]+),([\d.]+)\r?$/gm)]
    .map(match => ({ file: match[1], start: Number(match[2]), end: Number(match[3]) }));
}
let opening = 0;
function stopChild(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
  else child.kill('SIGTERM');
}
async function closeSession(id) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  await stopAutomation(session);
  if (session.child.exitCode === null) {
    const closed = new Promise(resolve => session.child.once('close', resolve));
    stopChild(session.child);
    await closed;
  }
  const target = path.resolve(directory, id);
  if (path.dirname(target) !== directory || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid playback directory');
  await fs.rm(target, { recursive: true, force: true });
}
const cleanup = setInterval(() => {
  for (const [id, session] of sessions) {
    if (Date.now() - session.accessedAt > 90000) closeSession(id).catch(() => {});
    else segmentsFor(session).then(async segments => {
      const cutoff = (segments.at(-1)?.end || 0) - (session.automation?.running && session.automation.mode === 'parts' ? Math.max(1800,session.automation.minutes*60+120) : 1800);
      for (const item of segments) if (item.end < cutoff) await fs.unlink(path.join(session.folder, item.file)).catch(() => {});
    }).catch(() => {});
  }
}, 15000);
cleanup.unref();
process.on('exit', () => {
  for (const session of sessions.values()) {
    if (session.automation?.child?.exitCode === null && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(session.automation.child.pid), '/T', '/F'], {windowsHide:true,stdio:'ignore'});
    if (session.child.exitCode !== null) continue;
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(session.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else session.child.kill('SIGTERM');
  }
});

playback.post('/playback', async (req, res) => {
  if (sessions.size + opening >= 4) throw new Error('Close another streamed player before opening an additional preview.');
  opening++;
  let reserved = true;
  const release = () => { if (reserved) { opening--; reserved = false; } };
  try { await prepareStream(req, res, release); }
  finally { release(); }
});
async function prepareStream(req, res, release) {
  const start = numeric(req.body.start || 0, 0, 604800, 'playback start');
  const metadata = await playbackMetadata(req.body.url,{refresh:req.body.refresh===true});
  if (res.destroyed) return;
  if (metadata.live_status === 'is_upcoming') throw new Error('This stream has not started yet.');
  const live = Boolean(metadata.is_live || metadata.live_status === 'is_live');
  const id = randomUUID();
  const folder = path.join(directory, id);
  await fs.mkdir(folder);
  if (res.destroyed) { await fs.rmdir(folder); return; }
  const inputs = playbackInputs(metadata, { realtime: !live, start: live ? 0 : start });
  const args = ['-y', '-nostdin', '-v', 'warning'];
  // Read VODs at playback speed to keep the rolling HLS buffer near the viewer.
  // Each input needs its own input options when video and audio are separate.
  args.push(...inputs.args);
  args.push('-map', inputs.video, '-map', inputs.audio, '-vf', 'scale=w=min(960\\,iw):h=-2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '900',
    '-hls_flags', 'delete_segments+independent_segments+program_date_time', '-hls_segment_filename', 'seg-%06d.ts', 'stream.m3u8',
    '-map', inputs.video, '-map', inputs.audio, '-c', 'copy', '-f', 'segment', '-segment_format', 'matroska', '-segment_time', '2',
    '-reset_timestamps', '1', '-segment_list', 'original.csv', '-segment_list_type', 'csv', 'original-%09d.mkv');
  const child = spawn(binary('ffmpeg'), args, { cwd: folder, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const session = { startedAt: Date.now(), child, folder, url: req.body.url, live, accessedAt: Date.now(), log: '', error: '' };
  sessions.set(id, session);
  release();
  child.stderr.on('data', chunk => { session.log = (session.log + chunk).slice(-3000); });
  child.on('error', error => { session.error = error.message; });
  let disconnected = false;
  res.on('close', () => {
    if (!res.writableEnded) { disconnected = true; closeSession(id).catch(() => {}); }
  });
  try {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (disconnected) return;
      if (session.error || child.exitCode && child.exitCode !== 0) throw new Error(session.error || session.log);
      try {
        const manifest = await fs.readFile(path.join(folder, 'stream.m3u8'), 'utf8');
        if (manifest.includes('#EXTINF:')) return res.json({ id, url: `/api/playback/${id}/stream.m3u8`, live, start: live ? 0 : start, title: metadata.title });
      } catch { /* FFmpeg is connecting or buffering the first segment. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('The source did not provide playable video in time.');
  } catch (error) {
    await closeSession(id);
    throw new Error(`Streamed preview could not start. ${error.message}`);
  }
}
playback.get('/playback/:id/:file', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session || !/^(stream\.m3u8|seg-\d+\.ts)$/.test(req.params.file)) return res.sendStatus(404);
  session.accessedAt = Date.now();
  res.setHeader('Cache-Control', 'no-store');
  res.type(req.params.file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
  res.sendFile(path.join(session.folder, req.params.file));
});
playback.post('/playback/:id/keepalive', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Playback session expired. Reload the player.' });
  session.accessedAt = Date.now();
  res.json({ ok: true, running: session.child.exitCode === null });
});
playback.post('/playback/:id/clip', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Playback buffer expired. Reload the player.' });
  if (req.body.rightsConfirmed !== true) throw new Error('Confirm media rights before clipping.');
  const start = numeric(req.body.start, 0, 604800, 'clip start');
  const end = numeric(req.body.end, start + 1, start + 1800, 'clip end');
  if (['9:16', '3:4'].includes(req.body.ratio) && end - start > 120) throw new Error('Short clips support up to two minutes.');
  session.accessedAt = Date.now();
  res.status(202).json(await snapshotClip(session, req.body));
});
export async function snapshotClip(session, body) {
  const start = Number(body.start), end = Number(body.end);
  const available = await segmentsFor(session);
  const cutoff = (available.at(-1)?.end || 0) - (body.autoAnalyze && session.automation ? Math.max(1800,session.automation.minutes*60+120) : 1800);
  const segments = available.filter(item => item.end >= cutoff);
  if (!segments.length || start < segments[0].start || end > segments.at(-1).end + .05) throw new Error('Keep the selection inside the buffered video. Wait a few seconds if the end is still live.');
  const selected = segments.filter(item => item.end > start && item.start < end);
  const snapshot = randomUUID();
  const folder = path.join(directory, snapshot);
  await fs.mkdir(folder);
  try {
    for (const item of selected) await fs.copyFile(path.join(session.folder, item.file), path.join(folder, item.file));
    await fs.writeFile(path.join(folder, 'clips.txt'), selected.map(item => `file '${item.file}'\nduration ${item.end - item.start}`).join('\n'));
    const payload = { ...body, url: session.url, snapshot, bufferStart: selected[0].start, offset: start - selected[0].start, duration: end - start, start: 0 };
    return enqueue('buffered-clip', payload, body.autoAnalyze ? 'Analyze continuous live part' : body.chatSpike ? 'Review chat reaction moment' : 'Prepare buffered clip for review');
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
}
async function stopAutomation(session) {
  if (!session.automation) return;
  clearInterval(session.automation.timer);
  session.automation.running = false;
  const child=session.automation.child;
  if (child && child.exitCode === null) {const closed=new Promise(resolve=>child.once('close',resolve));stopChild(child);await closed;}
}
playback.get('/live-automation/:id', (req,res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({error:'Player session expired'});
  const auto = session.automation;
  res.json(auto ? {running:auto.running,mode:auto.mode,status:auto.status,error:auto.error,total:auto.total,series:auto.series,jobs:auto.jobs} : {running:false,jobs:[]});
});
playback.delete('/live-automation/:id', async (req,res) => { const session=sessions.get(req.params.id); if (session) await stopAutomation(session); res.json({ok:true}); });
playback.post('/live-automation/:id', async (req,res) => {
  const session = sessions.get(req.params.id);
  if (!session || !session.live) throw new Error('Open a live streamed player before enabling automatic capture');
  if (req.body.rightsConfirmed !== true) throw new Error('Confirm media rights before recording');
  if (!['chat','parts'].includes(req.body.mode)) throw new Error('Choose chat or continuous parts');
  if (req.body.mode === 'chat' && !['youtube.com','www.youtube.com','m.youtube.com','youtu.be','twitch.tv','www.twitch.tv'].includes(new URL(session.url).hostname)) throw new Error('Chat spikes support YouTube and Twitch only');
  const minutes = numeric(req.body.partMinutes || 10,2,60,'part minutes');
  const hours = numeric(req.body.hours || 4,.5,24,'recording hours');
  const available = await segmentsFor(session).catch(()=>[]);
  const options = {rightsConfirmed:true,ratio:req.body.ratio || '9:16',preset:req.body.preset || 'clean',clipDuration:Math.min(120,Number(req.body.clipDuration)||60),transcribe:req.body.transcribe !== false,resolution:1080};
  await stopAutomation(session);
  const auto = session.automation = {running:true,mode:req.body.mode,minutes,status:req.body.mode === 'chat' ? 'Learning chat baseline (at least one minute of messages)' : 'Recording the next part',total:0,series:[],jobs:[],pending:[],next:(available.at(-1)?.end || 0)+minutes*60,busy:false,expires:Date.now()+hours*3600000};
  if (auto.mode === 'chat') {
    const url = new URL(session.url);
    if (!['youtube.com','www.youtube.com','m.youtube.com','youtu.be','twitch.tv','www.twitch.tv'].includes(url.hostname)) throw new Error('Chat spikes support YouTube and Twitch only');
    const requestFile = path.join(session.folder,'chat-request.json');
    await fs.writeFile(requestFile,JSON.stringify({url:session.url,work:session.folder}));
    const child = auto.child = spawn(binary('python'),[path.join(ROOT,'ai/chat_bridge.py'),requestFile],{cwd:ROOT,windowsHide:true,env:{...process.env,CLIPFORGE_YTDLP:binary('yt-dlp'),PYTHONIOENCODING:'utf-8'},stdio:['ignore','pipe','pipe']});
    let pending='';
    child.stdout.on('data',chunk=>{pending+=chunk; const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines){try{const value=JSON.parse(line);if(value.status)auto.status=value.status;if(value.error)auto.error=value.error;if(value.series)auto.series=value.series;if(value.total!==undefined)auto.total=value.total;if(value.spike)auto.pending.push(value.spike);}catch{}}});
    child.on('error',error=>{auto.error=error.message;});
    child.stderr.on('data',chunk=>{auto.error=String(chunk).slice(-500);});
    child.on('close',()=>{if(auto.running)auto.status='Chat reader stopped; stop and restart automatic capture to reconnect';});
  }
  auto.timer=setInterval(async()=>{
    if (!auto.running || auto.busy) return;
    if (Date.now()>auto.expires){void stopAutomation(session).catch(()=>{});auto.status='Recording time limit reached';return;}
    auto.busy=true;
    try {
      const segments=await segmentsFor(session);
      const latest=segments.at(-1)?.end || 0;
      const earliest=segments.find(item=>item.end>=latest-(auto.mode==='parts'?Math.max(1800,minutes*60+120):1800))?.start || 0;
      if (auto.mode==='parts' && latest>=auto.next) {
        const end=auto.next;
        const start=Math.max(earliest,end-minutes*60-90);
        const job=await snapshotClip(session,{...options,start,end,autoAnalyze:true});
        auto.jobs.push(job.id);auto.next+=minutes*60;auto.status='Part queued for highlight review; recording continues';
      }
      for(const spike of auto.pending) {
        if(spike.targetEnd===undefined){const peak=Math.max(0,latest-(Date.now()/1000-spike.peak));spike.targetStart=Math.max(earliest,peak-20);spike.targetEnd=peak+30;}
        if(latest>=spike.targetEnd){const job=await snapshotClip(session,{...options,start:spike.targetStart,end:spike.targetEnd,chatSpike:true});auto.jobs.push(job.id);spike.done=true;auto.status='Chat spike captured for review; watching for more';}
      }
      auto.pending=auto.pending.filter(spike=>!spike.done);
      auto.jobs=auto.jobs.slice(-200);
    }catch(error){auto.error=error.message;}finally{auto.busy=false;}
  },2000);
  res.json({running:true,mode:auto.mode});
});
playback.delete('/playback/:id', async (req, res) => { await closeSession(req.params.id); res.json({ ok: true }); });
