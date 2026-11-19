import path from 'node:path';
import {removeVoice} from './voice.mjs';
import {addCompatibleAudio} from './audio-compatibility.mjs';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DATA, ROOT, required, numeric } from './store.mjs';
import { run, update, checkCancelled } from './jobs.mjs';
import { addMedia, probe, pythonProcess } from './media.mjs';
import { assCaptions, suppliedCaptions, retimeCaptions, serializeCaptions } from './subtitles.mjs';

export const PRESETS = {
  clean: { name: 'Clean Gameplay', effect: 'none', normalize: true, fade: false, zoom: false, captionStyle: 'classic' },
  viral: { name: 'Viral Gaming Shorts', effect: 'vivid', normalize: true, fade: true, zoom: true, captionStyle: 'pop' },
  cinematic: { name: 'Cinematic GTA', effect: 'cinematic', normalize: true, fade: true, zoom: false, captionStyle: 'classic' },
  funny: { name: 'Funny Moments', effect: 'warm', normalize: true, fade: false, zoom: true, captionStyle: 'karaoke' },
  action: { name: 'Action Highlights', effect: 'vivid', normalize: true, fade: true, zoom: false, captionStyle: 'pop' }
};
const EFFECTS = { none: '', vivid: 'eq=saturation=1.3:contrast=1.07', mono: 'hue=s=0', warm: 'colorbalance=rs=.07:bs=-.05', cinematic: 'eq=saturation=.8:contrast=1.12:brightness=-.02', fade: 'fade=t=in:d=0.5' };
export function dimensions(options) {
  if (options.sourceCanvas) {
    const footage = options.clips?.filter(item => item.type !== 'title') || (options.sourceId ? [{ sourceId: options.sourceId }] : []);
    if (!footage.length) return dimensions({ ...options, sourceCanvas: false });
    const sources = footage.map(clip => required('media', clip.sourceId));
    const width = Math.max(...sources.map(source => source.width));
    const height = Math.max(...sources.map(source => source.height));
    return [90, 270].includes(Number(options.rotation || 0)) ? [height, width] : [width, height];
  }
  const ratio = options.ratio || '9:16';
  if (!/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(ratio)) throw new Error('Use an aspect ratio such as 9:16');
  const [a, b] = ratio.split(':').map(Number);
  numeric(a / b, .2, 5, 'aspect ratio');
  const resolution = numeric(options.resolution || 1080, 360, 2160, 'resolution');
  // Resolution refers to the short edge of the canvas.
  const w = Math.round((a < b ? resolution : resolution * a / b) / 2) * 2;
  const h = Math.round((a < b ? resolution * b / a : resolution) / 2) * 2;
  if (w > 7680 || h > 7680) throw new Error('Canvas dimensions exceed 7680 pixels');
  return [w, h];
}
export function validateTimeline(payload) {
  const clips = payload.clips || [{ sourceId: payload.sourceId, start: payload.start, end: payload.end }];
  if (!Array.isArray(clips) || !clips.length || clips.length > 100) throw new Error('Choose 1 to 100 timeline clips');
  const options = { ...(PRESETS[payload.preset || 'clean'] || PRESETS.clean), ...payload };
  dimensions(options);
  if (options.fps) numeric(options.fps, 24, 240, 'frame rate');
  numeric(options.brightness ?? 0, -.5, .5, 'brightness');
  numeric(options.contrast ?? 1, .5, 2, 'contrast');
  numeric(options.saturation ?? 1, 0, 2, 'saturation');
  numeric(options.sharpen ?? 0, 0, 1.5, 'sharpen');
  if (![0, 90, 180, 270].includes(Number(options.rotation || 0))) throw new Error('Choose a supported rotation');
  numeric(options.speed || 1, .5, 2, 'speed');
  numeric(options.volume ?? 1, 0, 2, 'volume');
  numeric(options.voiceReductionStrength ?? 1,0,1,'voice reduction strength');
  numeric(options.sourceAudioTrack || 0,0,31,'source audio track');
  numeric(options.cropX ?? .5, 0, 1, 'crop position');
  numeric(options.cropY ?? .5, 0, 1, 'crop position');
  numeric(options.captionSize || 54, 16, 160, 'caption size');
  if (options.captionMaxWords !== undefined) numeric(options.captionMaxWords, 1, 8, 'words per caption');
  if (!['cover', 'contain', 'blur', 'auto-face', undefined].includes(options.fit)) throw new Error('Unknown framing option');
  if (options.bitrate) numeric(options.bitrate, 1, 80, 'bitrate');
  if (!(options.effect in EFFECTS)) throw new Error('Unknown effect');
  for (const clip of clips) {
    if (clip.type === 'title') { numeric(clip.duration || 2, .5, 15, 'title card duration'); continue; }
    const source = required('media', clip.sourceId);
    numeric(clip.start, 0, source.duration - .01, 'clip start');
    numeric(clip.end, Number(clip.start) + .01, source.duration + .1, 'clip end');
  }
  const outputSeconds = clips.reduce((total, clip) => total + (clip.type === 'title' ? Number(clip.duration || 2) : (Number(clip.end) - Number(clip.start)) / Number(options.speed || 1)), 0);
  if (!options.sourceCanvas && ['9:16', '3:4'].includes(options.ratio || '9:16') && outputSeconds > 120.05) throw new Error('9:16 and 3:4 short exports support up to two minutes. Trim your timeline or choose 16:9 long form.');
  if (options.musicId) {
    if (required('media', options.musicId).kind !== 'audio') throw new Error('Choose an audio file for music');
    numeric(options.musicVolume ?? .15, 0, 1, 'music volume');
  }
  return { clips, options };
}
async function removeSilence(clips, job) {
  const result = [];
  for (const clip of clips) {
    if (clip.type === 'title') { result.push(clip); continue; }
    const source = required('media', clip.sourceId);
    if (source.hasAudio === false) { result.push(clip); continue; }
    const logFile = path.join(DATA, 'work', `${job.id}-silence.log`);
    // silencedetect logs to stderr. Store it through a dedicated output file filter.
    await run('ffmpeg', ['-y', '-v', 'error', '-ss', String(clip.start), '-i', path.join(DATA, source.file), '-t', String(clip.end - clip.start), '-vn', '-af', `silencedetect=n=-38dB:d=0.7,ametadata=print:file=${path.basename(logFile)}`, '-f', 'null', '-'], job, { cwd: path.dirname(logFile) });
    const logs = await fs.readFile(logFile, 'utf8');
    const silences = [];
    let from = null;
    for (const line of logs.split('\n')) {
      const start = line.match(/lavfi.silence_start=(.+)/);
      const end = line.match(/lavfi.silence_end=(.+)/);
      if (start) from = Number(start[1]);
      if (end && from !== null) { silences.push([from, Number(end[1])]); from = null; }
    }
    if (from !== null) silences.push([from, clip.end - clip.start]);
    let cursor = 0;
    for (const [start, end] of silences) {
      if (start - cursor > .15) result.push({ ...clip, start: clip.start + cursor, end: clip.start + Math.min(clip.end - clip.start, start + .1) });
      cursor = Math.max(cursor, end - .1);
    }
    if (clip.end - clip.start - cursor > .15) result.push({ ...clip, start: clip.start + cursor });
    await fs.unlink(logFile).catch(() => {});
  }
  if (!result.length) throw new Error('Silence removal left no playable footage. Disable silence removal for this recording.');
  return result;
}
export async function render(payload, job) {
  let { clips, options } = validateTimeline(payload);
  const renderId = randomUUID();
  const work = path.join(DATA, 'work', renderId);
  await fs.mkdir(work, { recursive: true });
  const [w, h] = dimensions(options);
  const firstSource = clips.find(clip => clip.type !== 'title');
  const primary = firstSource && required('media', firstSource.sourceId);
  const sourceProbe = primary ? await probe(path.join(DATA, primary.file)) : null;
  const videoInfo = sourceProbe?.streams.find(stream => stream.codec_type === 'video');
  const audioInfo = sourceProbe?.streams.filter(stream => stream.codec_type === 'audio')[Number(options.sourceAudioTrack || 0)];
  const otherIds = [...new Set(clips.filter(clip => clip.type !== 'title' && clip.sourceId !== primary?.id).map(clip => clip.sourceId))];
  const otherProbes = await Promise.all(otherIds.map(id => probe(path.join(DATA, required('media', id).file))));
  const allVideos = [videoInfo, ...otherProbes.map(info => info.streams.find(stream => stream.codec_type === 'video'))].filter(Boolean);
  const allAudio = [audioInfo, ...otherProbes.map(info => info.streams.filter(stream => stream.codec_type === 'audio')[Number(options.sourceAudioTrack || 0)])].filter(Boolean);
  const sourceFps = allVideos.length ? Math.max(1, ...allVideos.map(video => Number(video.avg_frame_rate?.split('/')[0]) / Number(video.avg_frame_rate?.split('/')[1]) || 30)) : 30;
  const fps = Number(options.fps || sourceFps || 30);
  const speed = Number(options.speed || 1);
  let transition = 0;
  const lossless = !options.quality || options.quality === 'lossless';
  const pixelFormat = primary?.pixelFormat || videoInfo?.pix_fmt || 'yuv420p';
  const rgb = lossless && /^(rgb|bgr|gbr)/.test(pixelFormat);
  const encoder = lossless ? rgb ? 'libx264rgb' : 'libx264' : options.encoder === 'nvenc' ? 'h264_nvenc' : 'libx264';
  const supportedPixels = ['yuv420p','yuvj420p','yuv422p','yuvj422p','yuv444p','yuvj444p','yuv420p10le','yuv422p10le','yuv444p10le','gray','gray10le'];
  if (lossless && ((!rgb && !supportedPixels.includes(pixelFormat)) || rgb && /(?:10|12|16)/.test(pixelFormat))) throw new Error(`Lossless editing cannot preserve pixel format ${pixelFormat}. Use source-quality copying or explicitly choose a compatible edited format.`);
  const outputPixelFormat = lossless ? rgb ? 'rgb24' : pixelFormat : 'yuv420p';
  const quality = options.quality === 'standard' ? '20' : '16';
  const audioRate = lossless ? Math.max(...allAudio.map(audio => Number(audio.sample_rate) || 48000), allAudio.length ? 8000 : 48000) : 48000;
  const widestAudio = allAudio.reduce((best, audio) => !best || audio.channels > best.channels ? audio : best, null);
  const audioLayout = lossless ? widestAudio?.channel_layout || 'stereo' : 'stereo';
  const audioEncode = lossless ? ['-c:a', 'flac', '-strict', '-2'] : ['-c:a', 'aac', '-b:a', '320k'];
  const encode = ['-c:v', encoder, '-preset', encoder.startsWith('libx264') ? lossless ? 'ultrafast' : 'veryfast' : 'p4', ...(lossless ? ['-crf', '0'] : options.bitrate ? ['-b:v', `${Number(options.bitrate)}M`] : encoder === 'libx264' ? ['-crf', quality] : ['-cq', quality]), '-pix_fmt', outputPixelFormat, ...audioEncode];
  let captions = [];
  const bundledFont = options.captionStyle === 'gta6' || options.captionFont === 'Anton';
  const fontOption = bundledFont ? ':fontsdir=fonts' : '';
  const captionRenderScale = options.preview && options.previewOutputResolution ? 360 / Number(options.previewOutputResolution) : 1;
  const captionOptions = { ...options, captionSize: Number(options.captionSize || 54) * captionRenderScale, captionRenderScale };
  try {
    if (bundledFont) {
      await fs.mkdir(path.join(work, 'fonts'));
      await fs.copyFile(path.join(ROOT, 'public/fonts/Anton-Regular.ttf'), path.join(work, 'fonts/Anton-Regular.ttf'));
    }
    if (options.removeSilence) { update(job, { stage: 'Finding silence', progress: 1 }); clips = await removeSilence(clips, job); }
    const canCrossfade = clips.every(clip => (clip.type === 'title' ? clip.duration || 2 : (clip.end - clip.start) / speed) > .6);
    transition = options.transition === 'fade' && clips.length > 1 && canCrossfade ? .3 : 0;
    const files = [];
    const durations = [];
    let offset = 0;
    for (let index = 0; index < clips.length; index++) {
      checkCancelled(job);
      const clip = clips[index];
      const destination = path.join(work, `scene-${index}.mp4`);
      const filters = [];
      let framingGraph = "";
      const args = ['-y', '-v', 'warning', '-progress', 'pipe:1', '-nostats', '-filter_complex_threads', '1'];
      const isTitle = clip.type === 'title';
      const source = isTitle ? null : required('media', clip.sourceId);
      const duration = isTitle ? Number(clip.duration || 2) : (clip.end - clip.start) / speed;
      durations.push(duration);
      if (isTitle) {
        args.push('-f', 'lavfi', '-i', `color=c=0x12101f:s=${w}x${h}:r=${fps}:d=${duration}`);
        const textFile = `title-${index}.txt`;
        await fs.writeFile(path.join(work, textFile), String(clip.text || options.title || 'Highlights').slice(0, 140));
        filters.push(`drawtext=textfile=${textFile}:expansion=none:fontcolor=white:fontsize=${Math.round(w / 20)}:x=(w-tw)/2:y=(h-th)/2`);
      } else {
        args.push('-ss', String(clip.start), '-t', String(clip.end - clip.start), '-i', path.join(DATA, source.file));
        if (Number(options.rotation) === 90) filters.push('transpose=1');
        if (Number(options.rotation) === 180) filters.push('hflip', 'vflip');
        if (Number(options.rotation) === 270) filters.push('transpose=2');
        if (options.mirror) filters.push('hflip');
        let cropX = Number(options.cropX ?? .5);
        if (options.smartCrop && source.analysis?.cropPoints?.length) {
          const points = source.analysis.cropPoints.filter(point => point.time >= clip.start && point.time <= clip.end);
          if (points.length) cropX = points.reduce((total, point) => total + point.x, 0) / points.length;
        }
        if (options.fit === 'auto-face' && !options.sourceCanvas) {
          if (Number(options.rotation || 0) || options.mirror) throw new Error('Reset rotation and mirror before using face-aware framing.');
          update(job, { stage: 'Tracking faces, speakers and people', progress: index / clips.length * 85 });
          const speech = (source.transcript?.segments || []).flatMap(segment => segment.words || [segment]).filter(word => word.end > clip.start && word.start < clip.end).map(word => [Math.max(0, word.start - clip.start), Math.min(clip.end - clip.start, word.end - clip.start)]);
          const framing = await pythonProcess({ operation: 'framing', file: path.join(DATA, source.file), start: clip.start, end: clip.end, sourceWidth: source.width, sourceHeight: source.height, width: w, height: h, speech }, job);
          framingGraph = framing.video_filter;
        } else if (options.fit === 'blur' && !options.sourceCanvas) {
          framingGraph = `[0:v]${filters.length ? filters.splice(0).join(',') + ',' : ''}split=2[bgsrc][fgsrc];[bgsrc]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=20:2,eq=brightness=-0.08[bg];[fgsrc]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[vf]`;
        } else if (options.fit === 'contain' || options.sourceCanvas) filters.push(`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`);
        else filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`, `crop=${w}:${h}:(iw-ow)*${cropX}:(ih-oh)*${Number(options.cropY ?? .5)}`);
        if (EFFECTS[options.effect]) filters.push(EFFECTS[options.effect]);
        if (options.brightness || Number(options.contrast ?? 1) !== 1 || Number(options.saturation ?? 1) !== 1) filters.push(`eq=brightness=${Number(options.brightness || 0)}:contrast=${Number(options.contrast ?? 1)}:saturation=${Number(options.saturation ?? 1)}`);
        if (options.sharpen) filters.push(`unsharp=5:5:${Number(options.sharpen)}:5:5:0`);
        if (options.vignette) filters.push('vignette=PI/5');
        if (options.zoom) filters.push(`scale=${Math.ceil(w * 1.08 / 2) * 2}:${Math.ceil(h * 1.08 / 2) * 2}`, `crop=${w}:${h}:(iw-ow)/2+sin(t*1.2)*(iw-ow)/4:(ih-oh)/2`);
        if (options.shake) filters.push(`scale=${Math.ceil(w * 1.04 / 2) * 2}:${Math.ceil(h * 1.04 / 2) * 2}`, `crop=${w}:${h}:(iw-ow)/2+sin(t*36)*(iw-ow)/3:(ih-oh)/2+cos(t*27)*(ih-oh)/3`);
        if (speed !== 1) filters.push(`setpts=PTS/${speed}`);
        if (options.captions !== false && source.transcript && !options.subtitles?.trim()) {
          const localCaptions = retimeCaptions(source.transcript.segments, clip.start, clip.end, 0, speed);
          const assFile = `captions-${index}.ass`;
          await fs.writeFile(path.join(work, assFile), assCaptions(localCaptions, captionOptions, w, h));
          if (localCaptions.length) filters.push(`ass=${assFile}${fontOption}`);
          captions.push(...retimeCaptions(source.transcript.segments, clip.start, clip.end, offset, speed));
        }
      }
      const supplied = options.captions !== false ? suppliedCaptions(options) : [];
      if (supplied.length) {
        const local = retimeCaptions(supplied, offset, offset + duration, 0, 1);
        await fs.writeFile(path.join(work, `manual-${index}.ass`), assCaptions(local, captionOptions, w, h));
        if (local.length) filters.push(`ass=manual-${index}.ass${fontOption}`);
        captions = supplied;
      }
      if (options.overlay) {
        await fs.writeFile(path.join(work, 'overlay.txt'), String(options.overlay).slice(0, 180));
        filters.push(`drawtext=textfile=overlay.txt:expansion=none:fontcolor=white:fontsize=${Math.max(18, Math.round(w / 34))}:box=1:boxcolor=black@0.4:boxborderw=12:x=30:y=30`);
      }
      if (options.watermark) {
        await fs.writeFile(path.join(work, 'watermark.txt'), String(options.watermark).slice(0, 100));
        filters.push(`drawtext=textfile=watermark.txt:expansion=none:fontcolor=white@0.65:fontsize=${Math.max(16, Math.round(w / 45))}:x=w-tw-25:y=h-th-25`);
      }
      if (options.fade && duration > 1) filters.push('fade=t=in:d=0.2', `fade=t=out:st=${duration - .2}:d=0.2`);
      filters.push('setsar=1', `fps=${fps}`, 'settb=AVTB');
      const hasAudio = source && source.hasAudio !== false;
      if (!hasAudio) args.push('-f', 'lavfi', '-i', `anullsrc=r=${audioRate}:cl=${audioLayout}`);
      const track=Number(options.sourceAudioTrack || 0);
      if(hasAudio && source.audioTracks && track>=source.audioTracks.length)throw new Error('Selected audio track is not present in this recording. Choose another track in Audio.');
      const audioFilters = [`aresample=${audioRate}`, `aformat=channel_layouts=${audioLayout}`, `volume=${Number(options.volume ?? 1)}`];
      if (hasAudio && speed !== 1) audioFilters.push(`atempo=${speed}`);
      if (options.normalize && hasAudio) audioFilters.push('dynaudnorm=f=250:g=15:p=0.95:m=10');
      args.push(...(framingGraph ? ['-filter_complex', framingGraph + ';[vf]' + filters.join(',') + '[framed]', '-map', '[framed]'] : ['-map', '0:v:0', '-vf', filters.join(',')]), '-map', hasAudio ? `0:a:${track}` : '1:a:0', '-af', audioFilters.join(','), '-t', String(duration), ...encode, '-movflags', '+faststart', destination);
      update(job, { stage: `Rendering scene ${index + 1} of ${clips.length}`, progress: index / clips.length * 85 });
      await run('ffmpeg', args, job, { cwd: work, onLine: line => {
        if (line.startsWith('out_time_us=')) update(job, { progress: Math.min(86, (index + Number(line.split('=')[1]) / 1000000 / duration) / clips.length * 85) });
      } });
      files.push(destination);
      offset += duration - (index < clips.length - 1 ? transition : 0);
    }
    checkCancelled(job);
    update(job, { stage: 'Assembling final video', progress: 88 });
    let assembled = path.join(work, 'assembled.mp4');
    if (files.length === 1) await fs.copyFile(files[0], assembled);
    else if (transition && durations.every(duration => duration > transition * 2)) {
      const args = ['-y', '-v', 'warning', '-filter_complex_threads', '1'];
      for (const file of files) args.push('-i', file);
      const graph = [];
      let elapsed = durations[0];
      let video = '0:v';
      let audio = '0:a';
      for (let index = 1; index < files.length; index++) {
        graph.push(`[${video}][${index}:v]xfade=transition=fade:duration=${transition}:offset=${elapsed - transition}[v${index}]`);
        graph.push(`[${audio}][${index}:a]acrossfade=d=${transition}[a${index}]`);
        video = `v${index}`; audio = `a${index}`; elapsed += durations[index] - transition;
      }
      args.push('-filter_complex', graph.join(';'), '-map', `[${video}]`, '-map', `[${audio}]`, ...encode, assembled);
      await run('ffmpeg', args, job, { cwd: work });
    } else {
      await fs.writeFile(path.join(work, 'concat.txt'), files.map((_, index) => `file 'scene-${index}.mp4'`).join('\n'));
      await run('ffmpeg', ['-y', '-v', 'warning', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', assembled], job, { cwd: work });
    }
    if(options.reduceStreamerVoice){
      const gameAudio=path.join(work,'game-only.mp4');
      await removeVoice(assembled,gameAudio,work,Number(options.voiceReductionStrength ?? 1),job);
      assembled=gameAudio;
    }
    const output = path.join(DATA, `${renderId}.mp4`);
    if (options.musicId) {
      const music = required('media', options.musicId);
      await run('ffmpeg', ['-y', '-v', 'warning', '-i', assembled, '-stream_loop', '-1', '-i', path.join(DATA, music.file), '-filter_complex', musicMixFilter(options), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', ...audioEncode, '-shortest', '-movflags', '+faststart', output], job);
    } else await fs.copyFile(assembled, output);
    if (lossless) {
      update(job, {stage:'Adding compatible playback audio; preserving lossless master'});
      const master = path.join(work, 'lossless-master.mp4');
      await fs.rename(output, master);
      await addCompatibleAudio(master, output, job);
    }
    checkCancelled(job);
    const srt = `${renderId}.srt`;
    const vtt = `${renderId}.vtt`;
    await fs.writeFile(path.join(DATA, srt), serializeCaptions(captions));
    await fs.writeFile(path.join(DATA, vtt), serializeCaptions(captions, true));
    return await addMedia(output, options.title || `${PRESETS[options.preset]?.name || 'Gameplay'} highlights`, options.preview ? 'preview' : 'export', {
      previewSession: options.previewSession,
      audioCompatibilityVersion: 1, losslessAudioCodec: lossless ? 'flac' : undefined,
      quality: lossless ? 'lossless-edited' : options.quality || 'high',
      srt, vtt, preset: options.preset || 'clean', ratio: options.ratio || '9:16', sourceIds: [...new Set(clips.filter(clip => clip.sourceId).map(clip => clip.sourceId))],
      timeline: { clips, options }, subtitleCount: captions.length
    });
  } finally {
    // Every work path is created under this job's UUID directory.
    await fs.rm(work, { recursive: true, force: true });
  }
}

export function musicMixFilter(options) {
  const volume = Number(options.musicVolume ?? .15);
  return options.musicDuck ? `[0:a]asplit=2[voice][detector];[1:a]volume=${volume}[music];[music][detector]sidechaincompress=threshold=0.025:ratio=8:attack=15:release=350[ducked];[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]` : `[1:a]volume=${volume}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`;
}
