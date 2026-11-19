import { get, numeric } from './store.mjs';
import { capture, analyzeSource } from './media.mjs';
import { render, dimensions, PRESETS } from './render.mjs';
import { update, checkCancelled } from './jobs.mjs';
import { randomUUID } from 'node:crypto';

export function validateLinkRequest(payload) {
  const url = new URL(String(payload.url).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Paste a valid HTTP or HTTPS video link');
  numeric(payload.duration ?? 120, 1, 21600, 'capture duration');
  numeric(payload.start ?? 0, 0, 604800, 'start time');
  numeric(payload.clipDuration ?? 30, 1, 1800, 'clip duration');
  numeric(payload.maxClips ?? 200, 1, 200, 'candidate limit');
  if (['9:16', '3:4'].includes(payload.ratio || '16:9') && Number(payload.clipDuration || 30) > 120) throw new Error('9:16 and 3:4 clips support up to 120 seconds. Choose landscape for long-form video.');
  if (payload.manualClip && ['9:16', '3:4'].includes(payload.ratio) && Number(payload.duration) > 120) throw new Error('Short clips support up to two minutes. Choose long form for a longer selection.');
  if (payload.preset && !PRESETS[payload.preset]) throw new Error('Choose a supported editing preset');
  dimensions(payload);
}

export async function processLink(payload, job) {
  const clipDuration = Number(payload.clipDuration ?? 30);
  const maxClips = Number(payload.maxClips ?? 200);
  const options = { preset: 'viral', ratio: '16:9', resolution: 1080, ...payload };
  update(job, { phase: 'detect', exportIds: [], stage: 'Detecting video or live stream' });
  let source = payload.resumeSourceId && get('media', payload.resumeSourceId);
  if (!source) source = await capture({ ...payload, title: undefined, mode: payload.inputMode === 'full' ? 'full' : 'auto', duration: payload.duration ?? 120 }, job);
  update(job, { sourceId: source.id, phase: 'analyze', stage: 'Finding highlights', progress: 0 });
  const analysis = payload.detectionMode === 'manual' || payload.manualClip ? { highlights: [], activity: [] } : await analyzeSource({ sourceId: source.id, clipDuration, maxClips, mode: payload.analysisMode || 'balanced',
    transcribe: payload.transcribe !== false, model: payload.model || 'base', language: payload.language || '' }, job);
  const highlights = analysis.highlights;
  if (payload.reviewFirst !== false || !highlights.length) {
    update(job, { phase: 'review', stage: 'Ready for timestamp review', progress: 100 });
    return { sourceId: source.id, ...analysis, reviewRequired: true, exports: [],
      manualRanges: payload.manualClip ? [{ id: randomUUID(), start: 0, end: Math.min(source.duration, Number(payload.duration) || source.duration), title: `${source.title} clip` }] : [],
      note: !highlights.length && !payload.manualClip ? 'Add timestamps manually or analyze another recording section. No prominent activity peaks were selected.' : undefined };
  }
  const exports = [];
  for (let index = 0; index < highlights.length; index++) {
    checkCancelled(job);
    const highlight = highlights[index];
    update(job, { phase: 'render', stage: `Editing clip ${index + 1} of ${highlights.length}`, clipIndex: index + 1, clipCount: highlights.length, progress: 0 });
    const item = await render({ ...options, title: highlight.title,
      clips: [{ sourceId: source.id, start: highlight.start, end: highlight.end }], captions: payload.transcribe !== false }, job);
    exports.push(item);
    update(job, { exportIds: exports.map(item => item.id) });
  }
  return { sourceId: source.id, exports, detected: job.detected, note: job.note };
}
