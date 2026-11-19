import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA, required, numeric } from './store.mjs';
import { addMedia } from './media.mjs';
import { run, update } from './jobs.mjs';

export function originalRanges(payload) {
  const source = required('media', payload.sourceId);
  if (!Array.isArray(payload.ranges) || !payload.ranges.length || payload.ranges.length > 200) throw new Error('Select 1 to 200 ranges');
  return { source, ranges: payload.ranges.map(range => ({
    title: String(range.title || 'Original-quality clip').slice(0, 180),
    start: numeric(range.start, 0, source.duration - .01, 'start'),
    end: numeric(range.end, Number(range.start) + .01, source.duration + .05, 'end'),
  })) };
}
export async function exportOriginal(payload, job) {
  const { source, ranges } = originalRanges(payload);
  const exports = [];
  for (const [index, range] of ranges.entries()) {
    update(job, { stage: `Copying original streams ${index + 1} of ${ranges.length}`, progress: index / ranges.length * 100 });
    const id = randomUUID();
    const input = path.join(DATA, source.file);
    let start = 0;
    if (range.start > 0) {
      const frames = JSON.parse(await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-read_intervals', `${Math.max(0, range.start - 60)}%${range.start + .001}`, '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', input], job));
      const candidates = (frames.frames || []).map(frame => Number(frame.best_effort_timestamp_time)).filter(value => Number.isFinite(value) && value <= range.start + .001);
      if (!candidates.length) throw new Error('Could not locate a preceding keyframe. Choose an earlier start or use edited export.');
      start = Math.max(...candidates);
    }
    const output = path.join(DATA, `${id}.mp4`);
    // Copy encoded packets unchanged. No filters, scaling, FPS conversion, or audio encoding.
    try {
      await run('ffmpeg', ['-y', '-v', 'warning', '-ss', String(start), '-i', input, '-t', String(range.end - start), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', output], job);
    } catch (error) {
      throw new Error(`Original streams could not be placed in MP4 without conversion. No compressed fallback was used. ${error.message}`);
    }
    exports.push(await addMedia(output, range.title, 'export', { quality: 'original', sourceIds: [source.id], requestedStart: range.start, requestedEnd: range.end, actualStart: start,
      qualityNote: 'Original encoded video and audio copied. Native canvas and frame rate retained. Start aligned to the preceding keyframe.' }));
    update(job, { exportIds: exports.map(item => item.id) });
  }
  return { sourceId: source.id, exports };
}
