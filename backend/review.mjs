import { randomUUID } from 'node:crypto';
import { required, numeric } from './store.mjs';
import { validateTimeline, render } from './render.mjs';
import { transcribeSource } from './media.mjs';
import { checkCancelled, update } from './jobs.mjs';

export function reviewPayloads(payload) {
  const source = required('media', payload.sourceId);
  if (!Array.isArray(payload.ranges) || !payload.ranges.length || payload.ranges.length > 200) throw new Error('Select 1 to 200 reviewed ranges');
  const options = { preset: 'clean', ratio: '16:9', resolution: 1080, ...payload.options };
  const ranges = payload.ranges.map(range => ({ id: range.id || randomUUID(), sourceId: source.id,
    title: String(range.title || 'Reviewed moment').slice(0, 180),
    start: numeric(range.start, 0, source.duration - .01, 'range start'),
    end: numeric(range.end, Number(range.start) + .01, source.duration + .05, 'range end') }));
  if (['9:16', '3:4'].includes(options.ratio) && ranges.some(range => range.end - range.start > 120.01)) throw new Error('Each short-form clip must be at most two minutes. Trim the selected ranges or choose long-form landscape.');
  if (payload.outputKind === 'long') {
    if (['9:16', '3:4'].includes(options.ratio)) throw new Error('Choose landscape for long-form output');
    const target = numeric(payload.targetMinutes || 20, 20, 30, 'long-form target minutes') * 60;
    const clips = [];
    let remaining = target * Number(options.speed || 1);
    for (const range of ranges) {
      if (remaining <= .01) break;
      // Keep the reviewed order and avoid repeating the same source footage.
      const overlaps = clips.some(clip => range.start < clip.end && range.end > clip.start);
      if (overlaps) continue;
      const end = Math.min(range.end, range.start + remaining);
      clips.push({ ...range, end });
      remaining -= end - range.start;
    }
    const result = { ...options, title: options.title || 'Reviewed long-form highlights', clips };
    validateTimeline(result);
    return [result];
  }
  const ratios = payload.dualFormat ? ['9:16', '16:9'] : [options.ratio];
  if (payload.dualFormat && ranges.some(range => (range.end - range.start) / Number(options.speed || 1) > 120.01)) throw new Error('Dual-format exports require ranges of two minutes or less.');
  return ranges.flatMap(range => ratios.map(ratio => {
    const result = { ...options, ratio, sourceCanvas: payload.dualFormat ? false : options.sourceCanvas, title: payload.dualFormat ? `${range.title} (${ratio})` : range.title, clips: [range] };
    validateTimeline(result);
    return result;
  }));
}

export async function exportReview(payload, job) {
  const payloads = reviewPayloads(payload);
  if (payload.options?.captions !== false && payload.transcribe !== false) await transcribeSource(payload.sourceId, payload, job);
  const exports = [];
  for (let index = 0; index < payloads.length; index++) {
    checkCancelled(job);
    update(job, { stage: `Rendering reviewed selection ${index + 1} of ${payloads.length}`, clipIndex: index + 1, clipCount: payloads.length });
    const result = await render(payloads[index], job);
    exports.push(result);
    update(job, { exportIds: exports.map(item => item.id) });
  }
  return { sourceId: payload.sourceId, exports };
}
