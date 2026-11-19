import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Timeline, Scene, Media, Caption } from './types';
import { timedPreviewCaptions, previewWords, groupPreviewCaptions } from './previewCaptions';

const effects: Record<string, string> = { none: 'none', vivid: 'saturate(1.3) contrast(1.07)', mono: 'grayscale(1)', warm: 'sepia(.18) saturate(1.12)', cinematic: 'saturate(.8) contrast(1.12) brightness(.98)' };
export default function EditorPreview({ timeline, scene, item, captions, player, onTime, notify }: {
  timeline: Timeline; scene?: Scene; item?: Media; captions: Caption[]; player: RefObject<HTMLVideoElement | null>; onTime: (time: number) => void; notify: (message: string) => void;
}) {
  const [clock, setClock] = useState(scene?.start || 0);
  const background = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(480);
  useEffect(() => {
    if (!canvas.current) return;
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    observer.observe(canvas.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (player.current) { player.current.playbackRate = timeline.speed; player.current.volume = Math.min(1, timeline.volume); } }, [timeline.speed, timeline.volume, item?.id]);
  useEffect(() => {
    if (player.current && scene && (player.current.currentTime < scene.start || player.current.currentTime >= scene.end)) player.current.currentTime = scene.start;
  }, [scene?.start, scene?.end, item?.id]);
  useEffect(() => {
    const element = player.current;
    if (!element || !scene) return;
    let frame = 0; let last = 0;
    const tick = (now: number) => {
      if (now - last > 60) { setClock(element.currentTime); onTime(element.currentTime); last = now; }
      if (element.currentTime >= scene.end) element.pause();
      if (!element.paused) frame = requestAnimationFrame(tick);
    };
    const play = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(tick); };
    element.addEventListener('play', play);
    return () => { cancelAnimationFrame(frame); element.removeEventListener('play', play); };
  }, [scene?.start, scene?.end, item?.id, onTime]);
  const ratio = timeline.ratio.split(':').map(Number);
  const rotated = [90, 270].includes(timeline.rotation || 0);
  const sourceAspect = item?.width && item?.height ? item.width / item.height : 16 / 9;
  const aspect = timeline.sourceCanvas ? rotated ? 1 / sourceAspect : sourceAspect : ratio[0] / ratio[1] || 16 / 9;
  const localTime = Math.max(0, clock - (scene?.start || 0)) / timeline.speed;
  const duration = scene ? (scene.end - scene.start) / timeline.speed : 1;
  let offset = 0;
  for (const clip of timeline.clips) { if (clip.id === scene?.id) break; offset += clip.type === 'title' ? clip.duration || 2 : (clip.end - clip.start) / timeline.speed; }
  const supplied = groupPreviewCaptions(timedPreviewCaptions(timeline.subtitles || '', timeline.captionSegments), timeline.captionMaxWords);
  const active = supplied.length ? supplied.find(value => offset + localTime >= value.start && offset + localTime < value.end) : groupPreviewCaptions(captions, timeline.captionMaxWords).find(value => clock >= value.start && clock < value.end);
  const words = active ? previewWords(active) : [];
  const captionClock = supplied.length ? offset + localTime : clock;
  const wordIndex = words.findIndex(word => captionClock >= word.start && captionClock < word.end);
  const animation = timeline.captionAnimation || 'word-pop';
  const scale = timeline.zoom ? 1.08 : timeline.shake ? 1.04 : 1;
  const transform = `translate(-50%,-50%) translate(${timeline.shake ? Math.sin(localTime * 36) * 1 : 0}%,${timeline.shake ? Math.cos(localTime * 27) * 1 : 0}%) scale(${scale}) scaleX(${timeline.mirror ? -1 : 1}) rotate(${timeline.rotation || 0}deg)`;
  const fade = timeline.fade ? Math.max(0, Math.min(1, localTime / .2, (duration - localTime) / .2)) : 1;
  const outputWidth = timeline.sourceCanvas && item ? rotated ? item.height! : item.width! : timeline.resolution * (aspect >= 1 ? aspect : 1);
  const fontSize = Math.max(8, timeline.captionSize * width / outputWidth);
  useEffect(() => {
    const source = player.current; const bg = background.current;
    if (!source || !bg) return;
    const sync = () => { bg.currentTime = source.currentTime; bg.playbackRate = source.playbackRate; if (source.paused) bg.pause(); else bg.play().catch(() => {}); };
    const events = ['play', 'pause', 'seeked', 'ratechange', 'loadedmetadata'];
    events.forEach(event => source.addEventListener(event, sync)); sync();
    return () => events.forEach(event => source.removeEventListener(event, sync));
  }, [timeline.fit, item?.id]);
  return <div className="video-stage edit-live-stage" data-effect={timeline.effect} data-preview="live">
    <div ref={canvas} className="edit-live-canvas" style={{ width: `min(100%, ${440 * aspect}px)`, aspectRatio: String(aspect) }}>
      {item && scene && timeline.fit === 'blur' && !timeline.sourceCanvas && <video ref={background} src={`/media/${item.id}`} muted playsInline aria-hidden="true" style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(20px) brightness(.8)', transform: 'scale(1.1)', pointerEvents: 'none' }}/>}
      {item && scene ? <video ref={player} src={`/media/${item.id}${item.proxy && item.proxyQuality === 'full-lossless' ? '?proxy=1' : ''}`} controls playsInline
        style={{ objectFit: ['contain', 'blur'].includes(timeline.fit) || timeline.sourceCanvas ? 'contain' : 'cover', objectPosition: `${timeline.cropX * 100}% ${timeline.cropY * 100}%`, width: rotated ? `${100 / aspect}%` : '100%', height: rotated ? `${100 * aspect}%` : '100%', left: '50%', top: '50%', filter: `${effects[timeline.effect] === 'none' ? '' : effects[timeline.effect] || ''} brightness(${1 + Number(timeline.brightness || 0)}) contrast(${timeline.contrast ?? 1}) saturate(${timeline.saturation ?? 1})`, transform, opacity: player.current?.paused ? 1 : fade }}
        onLoadedMetadata={event => { event.currentTarget.currentTime = scene.start; event.currentTarget.playbackRate = timeline.speed; event.currentTarget.volume = Math.min(1, timeline.volume); }}
        onTimeUpdate={event => { setClock(event.currentTarget.currentTime); onTime(event.currentTarget.currentTime); if (event.currentTarget.currentTime >= scene.end) event.currentTarget.pause(); }}
        onSeeked={event => { setClock(event.currentTarget.currentTime); onTime(event.currentTarget.currentTime); }}
        onError={() => notify('Use Create preview to convert this source codec for your browser.')}/> : <div className="title-preview">{scene?.text || 'Add a clip to start editing'}</div>}
      {timeline.vignette && item && <div className="live-vignette"/>}{timeline.overlay && item && <div className="edit-live-heading">{timeline.overlay}</div>}
      {timeline.watermark && item && <div className="edit-live-watermark">{timeline.watermark}</div>}
      {timeline.captions && active && item && <div className={`preview-caption ${timeline.captionPosition} caption-${timeline.captionStyle}`} style={{ textTransform: timeline.captionStyle === 'gta6' && timeline.captionUppercase !== false ? 'uppercase' : 'none', fontSize, color: timeline.captionColor, fontFamily: timeline.captionFont }}>{timeline.captionStyle === 'gta6' && animation === 'word-pop' ? wordIndex >= 0 && <span className="neon-word" key={`${active.start}:${wordIndex}`} data-word-index={wordIndex}>{words[wordIndex].text}</span> : timeline.captionStyle === 'gta6' && animation === 'highlight' || timeline.captionStyle === 'karaoke' ? words.map((word, index) => <span key={index} data-active={index === wordIndex} style={{ color: index === wordIndex ? timeline.captionHighlightColor || '#ffd08a' : timeline.captionColor }}>{word.text} </span>) : timeline.captionStyle === 'gta6' && animation === 'reveal' ? words.slice(0, wordIndex + 1).map(word => word.text).join(' ') : active.text}</div>}
    </div>
  </div>;
}
