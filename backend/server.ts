import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, ROOT, all, get, put, required, numeric } from './store.mjs';
import { cancel, enqueue, events, recoverJobs, register, run, update, finishRecording } from './jobs.mjs';
import { analyzeSource, capture, transcribeSource, inspectLink, pythonProcess, addMedia } from './media.mjs';
import { PRESETS, render, validateTimeline } from './render.mjs';
import { serializeCaptions } from './subtitles.mjs';
import { uploads, rights } from './uploads.mjs';
import { processLink, validateLinkRequest } from './pipeline.mjs';
import { reviewPayloads, exportReview } from './review.mjs';
import { playback } from './playback.mjs';
import { exportOriginal, originalRanges } from './original.mjs';
import { automaticEdit, editorPreview, generateTimelineCaptions } from './editor.mjs';
import { validateOutputFolder } from './output.mjs';
import { ollamaModels } from './semantic.mjs';
import { importLocalPath } from './local-import.mjs';
import { youtube } from './youtube.mjs';
import {repairExportAudio} from './audio-compatibility.mjs';
import {dvr} from './dvr.mjs';
import {voice} from './voice.mjs';
import { files } from './files.mjs';

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = req.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return res.status(403).json({ error: 'Local workspace only' });
  const origin = req.headers.origin;
  if (origin) {
    let localOrigin = false;
    try { const parsed = new URL(origin); localOrigin = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname); } catch { }
    if (!localOrigin) return res.status(403).json({ error: 'Origin rejected' });
  }
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use('/api', uploads);
app.use('/api', files);
app.use('/api', playback);
app.use('/api', dvr);
app.use('/api', voice);
app.use('/api', youtube);
register('capture', capture);
register('local-import', importLocalPath);
app.post('/api/import-path', (req,res) => { rights(req.body); if (!path.isAbsolute(req.body.path || '')) throw new Error('Enter an absolute file or folder path'); res.status(202).json(enqueue('local-import',{path:req.body.path,rightsConfirmed:true},'Import local file or folder')); });
register('link', processLink);
register('live-clip', processLink);
register('review-export', exportReview);
register('original-export', exportOriginal);
register('editor-original', async (payload, job) => {
  const footage = payload.clips?.filter(clip => clip.type !== 'title') || [];
  if (!footage.length || footage.length > 100) throw new Error('Choose 1 to 100 source ranges');
  const exports = [];
  for (const clip of footage) {
    const result = await exportOriginal({ sourceId: clip.sourceId, ranges: [{ ...clip, title: payload.title || 'Source-quality clip' }] }, job);
    exports.push(...result.exports);
    update(job, { exportIds: exports.map(item => item.id) });
  }
  return { exports };
});
app.post('/api/editor/original', (req, res) => {
  const footage = req.body.clips?.filter(clip => clip.type !== 'title') || [];
  if (!footage.length || footage.length > 100) throw new Error('Choose 1 to 100 source ranges');
  for (const clip of footage) originalRanges({ sourceId: clip.sourceId, ranges: [clip] });
  res.status(202).json(enqueue('editor-original', { ...req.body, manualClip: true }, 'Prepare source-quality downloads'));
});
register('editor-auto', automaticEdit);
register('editor-preview', editorPreview);
register('editor-captions', generateTimelineCaptions);
for (const [route, type] of [['auto', 'editor-auto'], ['preview', 'editor-preview'], ['captions', 'editor-captions']]) {
  app.post(`/api/editor/${route}`, (req, res) => {
    validateTimeline(req.body);
    res.status(202).json(enqueue(type, { ...req.body, manualClip: true }, route === 'auto' ? 'Automatically edit selected footage' : 'Render editing preview'));
  });
}
register('analyze', analyzeSource);
register('transcribe', (payload, job) => transcribeSource(payload.sourceId, payload, job));
register('render', render);
register('audio-repair', repairExportAudio);
app.post('/api/audio-compatible', (req,res) => { const media=required('media',req.body.mediaId); if(!['export','preview'].includes(media.kind))throw new Error('Choose a completed edited export'); res.status(202).json(enqueue('audio-repair',{mediaId:media.id},'Repair MP4 audio compatibility')); });
register('generate-music', async (_payload, job) => {
  const destination = path.join(DATA, `${randomUUID()}.wav`);
  await pythonProcess({ operation: 'music', destination }, job);
  return addMedia(destination, 'Generated lo-fi loop', 'audio', { generated: true });
});
app.post('/api/music/generate', (_req, res) => res.status(202).json(enqueue('generate-music', {}, 'Generate original lo-fi music')));
register('proxy', async (payload, job) => {
  const source = required('media', payload.sourceId);
  const proxy = `${source.id}-proxy.mp4`;
  await run('ffmpeg', ['-y', '-v', 'warning', '-i', path.join(DATA, source.file), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-c:a', 'flac', '-strict', '-2', '-movflags', '+faststart', path.join(DATA, proxy)], job);
  return put('media', { ...required('media', source.id), proxy, proxyQuality: 'full-lossless' });
});
register('auto', async (payload, job) => {
  const result = await analyzeSource(payload, job);
  if (payload.reviewFirst !== false) return { ...result, reviewRequired: true, exports: [] };
  const renderJobs = result.highlights.map((highlight, index) => enqueue('render', {
    ...payload, title: highlight.title, clips: [{ sourceId: payload.sourceId, start: highlight.start, end: highlight.end }]
  }, `Auto clip ${index + 1} · ${highlight.title}`).id);
  update(job, { stage: 'Highlights ranked and exports queued' });
  return { sourceId: payload.sourceId, renderJobs, highlights: result.highlights };
});
app.get('/api/speech-settings', (_req,res)=>res.json(get('settings','speech') || {model:'base',device:'cpu'}));
app.post('/api/speech-settings', (req,res)=>{if(!['tiny','base','small','medium','large-v3','turbo'].includes(req.body.model) || !['cpu','cuda'].includes(req.body.device))throw new Error('Choose a supported speech model and device');res.json(put('settings',{id:'speech',model:req.body.model,device:req.body.device}));});
app.get('/api/ollama', async (_req, res) => res.json({...await ollamaModels(), ...get('settings','ollama'),cloudAvailable:!!process.env.ANTHROPIC_API_KEY && !!process.env.ANTHROPIC_MODEL,cloudModel:process.env.ANTHROPIC_MODEL || ''}));
app.post('/api/ollama', async (req, res) => {
  const model = String(req.body.model || '');
  if (req.body.provider === 'claude' && req.body.enabled && (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_MODEL || req.body.cloudConsent !== true)) throw new Error('Cloud review requires ANTHROPIC_API_KEY, ANTHROPIC_MODEL and explicit cloud consent');
  if (req.body.enabled && req.body.provider !== 'claude' && !(await ollamaModels()).models.includes(model)) throw new Error('Choose an installed model from the running local Ollama service');
  res.json(put('settings',{id:'ollama',enabled:req.body.enabled === true,provider:req.body.provider === 'claude' ? 'claude' : 'ollama',cloudConsent:req.body.cloudConsent===true,model:req.body.provider === 'claude' ? process.env.ANTHROPIC_MODEL : model,vision:req.body.vision===true}));
});
app.get('/api/ratings', (_req, res) => res.json(all('ratings')));
app.post('/api/ratings', (req, res) => {
  const source = required('media', req.body.sourceId);
  const start = numeric(req.body.start,0,source.duration-.01,'rating start');
  const end = numeric(req.body.end,start+.01,source.duration+.05,'rating end');
  if (!['good','bad'].includes(req.body.rating)) throw new Error('Choose good or bad');
  res.json(put('ratings',{id:`${source.id}:${start}:${end}`,sourceId:source.id,start,end,rating:req.body.rating,title:String(req.body.title || source.title).slice(0,180),note:String(req.body.note || '').slice(0,1000),updatedAt:Date.now()}));
});
app.get('/api/output-folder', (_req, res) => res.json(get('settings', 'output-folder') || {folder:''}));
app.post('/api/output-folder', async (req, res) => res.json(put('settings', {id:'output-folder', folder:await validateOutputFolder(req.body.folder)})));
register('batch-captions', async (payload, job) => {
  const exports = [];
  for (const sourceId of payload.sourceIds) {
    const source = required('media', sourceId);
    await transcribeSource(sourceId, {model:'base'}, job);
    exports.push(await render({ title:source.title + ' captioned', sourceCanvas:true, quality:'lossless', fps:0, preset:'clean', effect:'none', fit:'contain', captions:true, captionStyle:'gta6', captionFont:'Anton', captionAnimation:'word-pop', clips:[{sourceId,start:0,end:source.duration}] }, job));
    update(job, {exportIds:exports.map(item => item.id)});
  }
  return {exports};
});
app.post('/api/batch-captions', (req, res) => {
  const ids = req.body.sourceIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw new Error('Choose 1 to 100 video files');
  for (const id of ids) if (required('media', id).kind === 'audio') throw new Error('Choose videos for batch captions');
  res.status(202).json(enqueue('batch-captions', {sourceIds:[...new Set(ids)]}, 'Batch caption finished clips'));
});
app.get('/api/library', (_req, res) => res.json(all('media').filter(item => item.kind !== 'preview' && !item.voiceSample)));
app.get('/api/version', (_req, res) => res.json({ name: 'Noah', version: '1.11.7', linkWorkflow: true, momentReview: true, immediatePlayer: true, shortRatios: ['9:16', '3:4'] }));
app.get('/api/jobs', (_req, res) => res.json(all('jobs').slice(0, 100)));
app.get('/api/jobs/:id', (req, res) => res.json(required('jobs', req.params.id)));
app.get('/api/presets', (_req, res) => res.json(PRESETS));
app.get('/api/projects', (_req, res) => res.json(all('projects')));
app.get('/api/highlights', (req, res) => res.json(all('media').filter(item => !req.query.sourceId || item.id === req.query.sourceId).flatMap(source => source.analysis?.highlights || [])));
app.get('/api/stats', async (_req, res) => {
  const media = all('media').filter(item => item.kind !== 'preview' && !item.voiceSample);
  let free = null;
  try { const stat = await fs.statfs(DATA); free = stat.bavail * stat.bsize; } catch { /* Some filesystems do not expose free space. */ }
  res.json({ imported: media.filter(item => !['export', 'audio'].includes(item.kind)).length, exports: media.filter(item => item.kind === 'export').length,
    highlights: media.reduce((count, item) => count + (item.analysis?.highlights?.length || 0), 0),
    queued: all('jobs').filter(job => ['queued', 'running'].includes(job.status)).length, storage: media.reduce((count, item) => count + (item.size || 0), 0), free });
});
app.get('/api/health', async (_req, res) => {
  const tools = Object.fromEntries(await Promise.all(['ffmpeg', 'ffprobe', 'yt-dlp', 'python'].map(async name => {
    try { await run(name, name === 'python' ? ['-c', 'import faster_whisper, cv2, numpy; print("ready")'] : [name === 'yt-dlp' ? '--version' : '-version']); return [name, true]; }
    catch { return [name, false]; }
  })));
  const models = await fs.readdir(path.join(DATA, 'models'));
  res.json({ ...tools, models: models.filter(name => name.startsWith('models--')), capabilities: {
    activityAnalysis: tools.python, localTranscription: tools.python, gameEventRecognition: false, subjectTracking: tools.python,
    crop: 'Manual, blurred background, motion-centroid or face/speaker/body tracking', gpuEncoding: 'Select NVENC when supported by your GPU and drivers'
  } });
});
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('data: {"connected":true}\n\n');
  const report = job => res.write(`data: ${JSON.stringify({ jobId: job.id, status: job.status, progress: job.progress })}\n\n`);
  events.on('update', report);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => { clearInterval(heartbeat); events.off('update', report); });
});
app.post('/api/inspect', async (req, res) => res.json(await inspectLink(req.body.url)));
app.post('/api/process-link', (req, res) => {
  rights(req.body);
  validateLinkRequest(req.body);
  const type = req.body.manualClip && req.body.captureLive ? 'live-clip' : 'link';
  res.status(202).json(enqueue(type, req.body, type === 'live-clip' ? 'Record live clip for review' : 'Detect moments for review'));
});
app.post('/api/review/export', (req, res) => {
  reviewPayloads(req.body);
  res.status(202).json(enqueue('review-export', req.body, req.body.outputKind === 'long' ? 'Export reviewed long-form video' : 'Export reviewed clips'));
});
app.post('/api/review/original', (req, res) => {
  originalRanges(req.body);
  res.status(202).json(enqueue('original-export', { ...req.body, manualClip: true }, 'Copy original-quality clips'));
});
app.post('/api/capture', (req, res) => { rights(req.body); res.status(202).json(enqueue('capture', req.body, 'Import online video')); });
for (const type of ['analyze', 'transcribe', 'auto', 'proxy']) {
  app.post(`/api/${type}`, (req, res) => {
    const source = required('media', req.body.sourceId);
    if (type === 'auto') validateTimeline({ ...req.body, clips: [{ sourceId: source.id, start: 0, end: Math.min(source.duration, Number(req.body.clipDuration || 30)) }] });
    res.status(202).json(enqueue(type, req.body, { analyze: 'Analyze highlights', transcribe: 'Generate subtitles', auto: 'One-click auto clip', proxy: 'Create browser preview' }[type]));
  });
}
app.post('/api/export', (req, res) => {
  const exportPayload = { ...req.body, preview: false, previewDraft: false, previewOutputResolution: undefined };
  validateTimeline(exportPayload);
  res.status(202).json(enqueue('render', exportPayload, `Export · ${req.body.title || 'Gameplay highlight'}`));
});
app.post('/api/batch', (req, res) => {
  if (!Array.isArray(req.body.highlights) || !req.body.highlights.length || req.body.highlights.length > 50) throw new Error('Select 1 to 50 highlights');
  const payloads = req.body.highlights.map(id => {
    const highlight = required('highlights', id);
    const payload = { ...req.body.options, title: highlight.title, clips: [{ sourceId: highlight.sourceId, start: highlight.start, end: highlight.end }] };
    validateTimeline(payload);
    return payload;
  });
  res.status(202).json(payloads.map(payload => enqueue('render', payload, `Batch · ${payload.title}`)));
});
app.post('/api/compilation', (req, res) => {
  const ids = [...new Set(req.body.highlights || [])] as string[];
  const target = numeric(req.body.targetMinutes || 5, .1, 60, 'target minutes') * 60;
  const candidates = ids.map(id => required('highlights', id)).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.start - b.start);
  const clips = [];
  let duration = 0;
  for (const highlight of candidates) {
    if (duration >= target) break;
    if (clips.some(clip => clip.sourceId === highlight.sourceId && highlight.start < clip.end && highlight.end > clip.start)) continue;
    const end = Math.min(highlight.end, highlight.start + target - duration);
    clips.push({ sourceId: highlight.sourceId, start: highlight.start, end });
    duration += end - highlight.start;
  }
  const payload = { ...req.body.options, clips, title: req.body.title || 'Gameplay compilation' };
  validateTimeline(payload);
  res.status(202).json(enqueue('render', payload, `Compilation · ${Math.round(duration)} seconds of available footage`));
});
app.post('/api/cancel/:id', (req, res) => { cancel(req.params.id); res.json({ ok: true }); });
app.post('/api/finish/:id', (req, res) => { finishRecording(req.params.id); res.json({ ok: true }); });
app.post('/api/retry/:id', (req, res) => {
  const job = required('jobs', req.params.id);
  if (!['error', 'cancelled'].includes(job.status)) throw new Error('Only failed or cancelled jobs can be retried');
  const payload = ['link', 'live-clip'].includes(job.type) && job.sourceId ? { ...job.payload, resumeSourceId: job.sourceId } : job.payload;
  res.status(202).json(enqueue(job.type, payload, job.label));
});
app.post('/api/projects', (req, res) => {
  validateTimeline(req.body.timeline);
  const id = req.body.id || randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid project identifier');
  res.json(put('projects', { id, title: String(req.body.title || 'Untitled project').slice(0, 180), timeline: req.body.timeline,
    createdAt: get('projects', id)?.createdAt || Date.now(), updatedAt: Date.now() }));
});
app.put('/api/transcript/:id', (req, res) => {
  const source = required('media', req.params.id);
  const segments = req.body.segments;
  if (!Array.isArray(segments) || segments.length > 100000) throw new Error('Invalid transcript');
  for (const segment of segments) {
    numeric(segment.start, 0, source.duration, 'caption start');
    numeric(segment.end, segment.start + .001, source.duration + .1, 'caption end');
    if (typeof segment.text !== 'string' || segment.text.length > 5000) throw new Error('Invalid caption text');
  }
  res.json(put('media', { ...source, transcript: { ...source.transcript, segments } }));
});
app.get('/api/transcript/:id/:format', (req, res) => {
  const source = required('media', req.params.id);
  const vtt = req.params.format === 'vtt';
  res.type(vtt ? 'text/vtt' : 'application/x-subrip').attachment(`${source.title}.${vtt ? 'vtt' : 'srt'}`).send(serializeCaptions(source.transcript?.segments || [], vtt));
});
app.get('/media/:id', (req, res) => {
  const media = required('media', req.params.id);
  const file = req.query.format === 'srt' ? media.srt : req.query.format === 'vtt' ? media.vtt : req.query.proxy && media.proxy ? media.proxy : media.file;
  if (!file) throw new Error('Requested media version is unavailable');
  if (req.query.download) res.attachment(`${media.title.replace(/[<>:"/\\|?*]/g, '_')}${path.extname(file)}`);
  res.sendFile(path.join(DATA, path.basename(file)));
});
app.get('/thumb/:id', (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.sendStatus(404);
  res.sendFile(path.join(DATA, `${req.params.id}.jpg`));
});
app.use(express.static(path.join(ROOT, 'dist')));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'dist/index.html')));
app.use((error, _req, res, _next) => { if (!res.headersSent) res.status(400).json({ error: error.message }); });
const port = Number(process.env.PORT || 3000);
app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`Noah is ready at http://127.0.0.1:${port}`);
  recoverJobs();
});
