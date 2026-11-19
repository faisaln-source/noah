import { reviewWithOllama } from './semantic.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, ROOT, get, put, required, numeric } from './store.mjs';
import { run, binary, update, checkCancelled } from './jobs.mjs';

export async function probe(file) {
  return JSON.parse(await run('ffprobe', ['-v', 'quiet', '-show_format', '-show_streams', '-of', 'json', file]));
}
export async function addMedia(file, title, kind, extra = {}) {
  const info = await probe(file);
  const video = info.streams.find(stream => stream.codec_type === 'video');
  const audio = info.streams.find(stream => stream.codec_type === 'audio');
  if (!video && kind !== 'audio') throw new Error('This file has no video track');
  if (!video && !audio) throw new Error('No usable media tracks');
  const item = { id: randomUUID(), file: path.basename(file), title: String(title || 'Untitled').slice(0, 180), kind,
    duration: Number(info.format.duration) || 0, width: video?.width, height: video?.height,
    audioTracks: info.streams.filter(stream=>stream.codec_type==='audio').map((stream,index)=>({index,title:stream.tags?.title || stream.tags?.handler_name || `Audio track ${index+1}`,codec:stream.codec_name,channels:stream.channels})),
    hasAudio: Boolean(audio), videoCodec: video?.codec_name, audioCodec: audio?.codec_name, pixelFormat: video?.pix_fmt,
    fps: (video?.r_frame_rate || video?.avg_frame_rate || '0/1').split('/').reduce((a, b) => Number(a) / Number(b)),
    size: Number(info.format.size), createdAt: Date.now(), ...extra };
  if (video) {
    const thumb = `${item.id}.jpg`;
    try { await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(Math.min(2, item.duration / 2)), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', path.join(DATA, thumb)]); item.thumbnail = thumb; }
    catch { /* Thumbnail failure does not discard a successfully imported recording. */ }
  }
  return put('media', item);
}
export async function pythonProcess(request, job) {
  if (request.operation === 'transcribe') { const speech = get('settings','speech'); request = {...request, model:request.model && request.model !== 'base' ? request.model : speech?.model || request.model || 'base', device:speech?.device || 'cpu'}; }
  const requestFile = path.join(DATA, 'work', `${job.id}-${request.operation}.json`);
  const output = path.join(DATA, 'work', `${job.id}-${request.operation}-result.json`);
  await fs.writeFile(requestFile, JSON.stringify({ ...request, output, ffmpeg: binary('ffmpeg'), modelCache: process.env.MODEL_CACHE || path.join(DATA, 'models') }));
  await run('python', [path.join(ROOT, 'ai/worker.py'), requestFile], job, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } });
  checkCancelled(job);
  const result = JSON.parse(await fs.readFile(output, 'utf8'));
  await Promise.all([fs.unlink(requestFile), fs.unlink(output)]);
  return result;
}
export async function transcribeSource(sourceId, options, job) {
  const source = required('media', sourceId);
  if (source.transcript && !options.force) return source.transcript;
  if (source.hasAudio === false) {
    const transcript = { segments: [], language: null, engine: 'no audio' };
    put('media', { ...source, transcript });
    return transcript;
  }
  const transcript = await pythonProcess({ operation: 'transcribe', file: path.join(DATA, source.file), duration: source.duration,
    model: options.model || 'base', language: options.language || null }, job);
  put('media', { ...required('media', sourceId), transcript });
  return transcript;
}
export async function analyzeSource(payload, job) {
  let source = required('media', payload.sourceId);
  if (payload.transcribe) await transcribeSource(source.id, payload, job);
  source = required('media', source.id);
  update(job, { stage: 'Analyzing audiovisual activity', progress: 0 });
  let result = await pythonProcess({ operation: 'analyze', file: path.join(DATA, source.file), duration: source.duration,
    hasAudio: source.hasAudio, transcript: source.transcript || {}, clipDuration: numeric(payload.clipDuration || 30, 1, 1800, 'clip duration'),
    maxClips: numeric(payload.maxClips || 200, 1, 200, 'candidate limit'), mode: payload.mode || 'balanced' }, job);
  result = await reviewWithOllama(source, result, job, update);
  for (let index = 0; index < result.highlights.length; index++) {
    checkCancelled(job);
    const highlight = result.highlights[index];
    highlight.sourceId = source.id;
    highlight.thumbnail = `${highlight.id}.jpg`;
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(highlight.eventTime), '-i', path.join(DATA, source.file), '-frames:v', '1', '-vf', 'scale=480:-2', path.join(DATA, highlight.thumbnail)], job);
    put('highlights', highlight);
  }
  // Replace previous candidate set only after the new analysis succeeds.
  put('media', { ...required('media', source.id), analysis: { ...result, analyzedAt: Date.now() } });
  return { sourceId: source.id, ...result };
}
const inspections = new Map();
function sourceUrl(value) {
  const parsed = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Enter an HTTP or HTTPS video URL');
  return parsed.href;
}
function downloaderOptions() {
  const common = ['--no-playlist', '--no-warnings', '--socket-timeout', '20', '--retries', '3', '--js-runtimes', 'node', '-f', 'bv*+ba/best'];
  if (path.isAbsolute(binary('ffmpeg'))) common.push('--ffmpeg-location', path.dirname(binary('ffmpeg')));
  return common;
}
async function metadataFor(url, job) {
  const cached = inspections.get(url);
  if (cached && Date.now() - cached.time < 45000) return cached.metadata;
  let metadata;
  try {
    metadata = JSON.parse(await run('yt-dlp', [...downloaderOptions(), '--dump-single-json', '--skip-download', '--', url], job, { timeoutMs: 60000 }));
  } catch (error) {
    checkCancelled(job);
    const detail = error.message.match(/ERROR:[\s\S]*/)?.[0]?.slice(0, 1300) || error.message;
    throw new Error(`Could not access this video. ${detail}`);
  }
  inspections.set(url, { time: Date.now(), metadata });
  // Signed playback URLs are short-lived and stay in memory only.
  for (const [key, value] of inspections) if (Date.now() - value.time > 45000) inspections.delete(key);
  return metadata;
}
export async function playbackMetadata(value, options = {}) {
  const url=sourceUrl(value);
  if(options.refresh)inspections.delete(url);
  return metadataFor(url);
}
export function playbackInputs(metadata, options = {}) {
  const formats = metadata.requested_formats || [metadata];
  const args = [];
  for (const format of formats) {
    if (options.realtime) args.push('-re');
    if (options.start) args.push('-ss', String(options.start));
    const headers = Object.entries(format.http_headers || metadata.http_headers || {})
      .filter(([key]) => /^[A-Za-z0-9-]+$/.test(key))
      .map(([key, value]) => `${key}: ${String(value).replace(/[\r\n]/g, '')}\r\n`).join('');
    if (headers) args.push('-headers', headers);
    args.push('-rw_timeout', '20000000', '-i', format.url);
  }
  return { args, video: '0:v:0', audio: formats.length > 1 ? '1:a:0?' : '0:a:0?' };
}
export async function inspectLink(value) {
  const url = sourceUrl(value);
  const metadata = await metadataFor(url);
  return { url, title: metadata.title || 'Online video', live: Boolean(metadata.is_live || metadata.live_status === 'is_live'),
    upcoming: metadata.live_status === 'is_upcoming', duration: Number(metadata.duration) || null,
    platform: metadata.extractor_key || metadata.extractor || 'Video', videoId: metadata.id, width: metadata.width, height: metadata.height };
}
export async function capture(payload, job) {
  const url = sourceUrl(payload.url);
  const common = downloaderOptions();
  update(job, { stage: 'Reading source metadata', progress: 1 });
  const metadata = await metadataFor(url, job);
  if (metadata.live_status === 'is_upcoming') throw new Error('This stream has not started yet. Try again when the broadcaster is live.');
  const live = Boolean(metadata.is_live || metadata.live_status === 'is_live' || payload.mode === 'live');
  update(job, { detected: { title: metadata.title, live, duration: metadata.duration, platform: metadata.extractor_key }, stage: live ? 'Live stream detected' : 'Video detected' });
  const file = path.join(DATA, `${job.id}-source.mp4`);
  if (live) {
    const duration = numeric(payload.duration ?? 120, 1, 21600, 'recording duration');
    const inputs = playbackInputs(metadata);
    const args = ['-y', '-progress', 'pipe:1', '-nostats'];
    args.push(...inputs.args, '-t', String(duration), '-map', inputs.video, '-map', inputs.audio, '-c', 'copy', '-movflags', '+faststart', file);
    update(job, { phase: 'record', stage: 'Connecting live recording', progress: 0 });
    await run('ffmpeg', args, job, { onLine: line => {
      if (line.startsWith('out_time_us=')) update(job, { stage: `Recording live stream · ${duration} seconds`, progress: Math.min(99, Number(line.split('=')[1]) / 1000000 / duration * 100) });
    }, timeoutMs: (duration + 120) * 1000 });
  } else {
    const section = [];
    if (payload.mode !== 'full') {
      const start = numeric(payload.start || 0, 0, 604800, 'start');
      const duration = numeric(payload.duration || 60, 1, 86400, 'duration');
      section.push('--download-sections', `*${start}-${start + duration}`);
    }
    update(job, { stage: 'Downloading media', progress: 5 });
    await run('yt-dlp', [...common, ...section, '--newline', '--progress', '--progress-template', 'download:PROGRESS %(progress._percent_str)s', '--merge-output-format', 'mp4', '--remux-video', 'mp4', '-o', file, '--', url], job, { onLine: line => {
      const match = line.match(/PROGRESS\s+(\d+(\.\d+)?)/);
      if (match) update(job, { stage: 'Downloading media', progress: Math.min(98, Number(match[1])) });
    } });
  }
  checkCancelled(job);
  return addMedia(file, payload.title || metadata.title, live ? 'recording' : 'clip', { sourceUrl: url, sourceTitle: metadata.title, sourceStart: live || payload.mode === 'full' ? 0 : Number(payload.start || 0), captureQuality: 'source-copy', rightsConfirmedAt: Date.now() });
}
