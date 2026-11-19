import { useEffect, useMemo, useRef, useState } from 'react';
import {validateHistoryRange} from '../shared/history-range.mjs';
import Hls from 'hls.js';
import LiveAutomation from './LiveAutomation';
import { Circle, Radio, Scissors, Play, Square } from 'lucide-react';
import { parseTimestamp, timestamp } from './MomentReview';
import type { Job } from './types';

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }
let youtubeReady: Promise<any> | null = null;
function youtubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeReady) youtubeReady = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => { youtubeReady = null; reject(new Error('Player controls could not connect. Use the streamed player or enter timestamps manually.')); }, 15000);
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timeout); previous?.(); resolve(window.YT); };
    if (!document.getElementById('clipforge-youtube-api')) {
      const script = document.createElement('script');
      script.id = 'clipforge-youtube-api'; script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { clearTimeout(timeout); youtubeReady = null; script.remove(); reject(new Error('YouTube player controls could not load.')); };
      document.head.append(script);
    }
  });
  return youtubeReady;
}
function providerFor(value: string, videoId?: string) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, '');
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
      const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : url.searchParams.get('v') || url.pathname.match(/^\/(?:live|shorts|embed)\/([^/]+)/)?.[1] || videoId;
      if (id && /^[\w-]{11}$/.test(id)) return { mode: 'youtube', id, url: url.href };
    }
    if (host === 'twitch.tv') {
      const vod = url.pathname.match(/^\/videos\/(\d+)/)?.[1];
      const channel = url.pathname.match(/^\/([\w]+)\/?$/)?.[1];
      if (vod || channel) return { mode: 'twitch', id: vod ? `video=v${vod}` : `channel=${channel}`, url: url.href };
    }
    const direct = /\.(mp4|webm|m4v|mov)(?:$|\?)/i.test(url.href) || url.origin === location.origin && url.pathname.startsWith('/media/');
    return { mode: direct ? 'direct' : 'stream', id: '', url: url.href };
  } catch { return null; }
}
type Props = {
  url: string; detection?: { title: string; live: boolean; duration: number | null; videoId?: string } | null;
  rights: boolean; ratio: string; preset: string; clipDuration: number; targetMinutes: number; outputKind: string; transcribe: boolean;
  job?: Job & { phase?: string; payload?: { url?: string } }; action: any; onJob: (job: Job) => void;
};
export default function SourcePlayer({ url, detection, rights, ratio, preset, clipDuration, targetMinutes, outputKind, transcribe, job, action, onJob }: Props) {
  const provider = useMemo(() => providerFor(url, detection?.videoId), [url, detection?.videoId]);
  const [mode, setMode] = useState(provider?.mode || 'direct');
  const [status, setStatus] = useState('Loading player');
  const [error, setError] = useState('');
  const [clock, setClock] = useState(0);
  const [clockReady, setClockReady] = useState(false);
  const [start, setStart] = useState('00:00:00');
  const [end, setEnd] = useState(timestamp(outputKind === 'short' ? clipDuration : targetMinutes * 60));
  const [preparing, setPreparing] = useState(false);
  const [clipBuffered, setClipBuffered] = useState(false);
  const [bufferRange, setBufferRange] = useState({ start: 0, end: 0 });
  const [session, setSession] = useState<{ id: string; url: string; start: number; live: boolean } | null>(null);
  const [history,setHistory]=useState<{id:string;url:string;start:number;end:number;live:boolean;message:string;fromBeginning:boolean} | null>(null);
  const [historyGeneration,setHistoryGeneration]=useState(0);
  const historyResume=useRef(0);
  const [historySeek,setHistorySeek]=useState('00:00:00');
  const [streamStart, setStreamStart] = useState(0);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const youtube = useRef<any>(null);
  const hls = useRef<Hls | null>(null);
  const recoveryAttempts=useRef(0);
  const reconnectTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const reconnectRef=useRef<(reason:string)=>void>(()=>{});
  const [reconnectNotice,setReconnectNotice]=useState('');
  const selectionEdited = useRef(false);
  const previewEnd = useRef<number | null>(null);
  const pendingEnd = useRef<number | null>(null);
  const live = Boolean(detection?.live || session?.live);
  const currentJob = job?.payload?.url === provider?.url ? job : undefined;
  const busy = preparing || ['queued', 'running'].includes(currentJob?.status || '');
  function reconnect(reason:string){
    if(reconnectTimer.current)return;
    if(recoveryAttempts.current>=3){setError(`Playback could not reconnect after three attempts (${reason}). Try Reload streamed player or View full live history.`);setStatus('Connection unavailable');return;}
    recoveryAttempts.current+=1;setError('');setStatus(`Reconnecting (${recoveryAttempts.current}/3)`);
    if(mode==='history')historyResume.current=clock;
    const resumePosition=video.current?.currentTime ? video.current.currentTime+(session?.start || 0):streamStart;
    reconnectTimer.current=setTimeout(()=>{
      reconnectTimer.current=null;
      if(mode==='history')setHistoryGeneration(value=>value+1);
      else {if(!live)setStreamStart(resumePosition);if(live){selectionEdited.current=false;setStart('00:00:00');setEnd(timestamp(clipDuration));setReconnectNotice('Live connection restarted. The local buffer and its clip markers start again; use full live history to recover earlier footage.');}setStreamGeneration(value=>value+1);}
    },Math.min(8000,1000*2**(recoveryAttempts.current-1)));
  }
  reconnectRef.current=reconnect;
  useEffect(()=>()=>{if(reconnectTimer.current)clearTimeout(reconnectTimer.current);},[]);
  useEffect(()=>{recoveryAttempts.current=0;},[provider?.url,mode]);
  useEffect(() => { if (!selectionEdited.current) {const base=mode==='history' && history?history.start:0;const limit=mode==='history' && history?history.end:detection?.duration || Infinity;setEnd(timestamp(Math.min(limit,base+(outputKind === 'short' ? clipDuration : targetMinutes * 60))));} }, [clipDuration, targetMinutes, outputKind, detection?.duration,mode,history?.start,history?.end]);
  useEffect(() => {
    if (mode !== 'youtube' || !iframe.current) return;
    let disposed = false;
    let ownedPlayer: any = null;
    youtubeApi().then(YT => {
      if (disposed || !iframe.current) return;
      const player = new YT.Player(iframe.current, { events: {
        onReady: () => { if (!disposed) { youtube.current = player; setClockReady(true); setStatus('Ready to play'); player.mute(); player.playVideo(); } },
        onStateChange: (event: any) => { if (!disposed) setStatus(event.data === 1 ? 'Playing' : event.data === 2 ? 'Paused' : 'Ready to play'); },
        onError: () => { if (!disposed) { setMode('stream'); setError(''); } }
      } });
      ownedPlayer = player;
    }).catch(() => { if (!disposed) { setMode('stream'); setError(''); } });
    const watchdog = setTimeout(() => { if (!disposed && ![1, 2].includes(youtube.current?.getPlayerState?.())) { setMode('stream'); setError(''); } }, 20000);
    return () => { clearTimeout(watchdog); disposed = true; youtube.current = null; try { ownedPlayer?.destroy(); } catch { /* The iframe may already be detached. */ } };
  }, [mode, provider?.id]);
  useEffect(() => {
    if (mode !== 'stream' || !provider) return;
    const controller = new AbortController();
    let id = '';
    setStatus('Connecting streamed player'); setError(''); setSession(null); setClockReady(false);
    fetch('/api/playback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: provider.url, start: streamStart, refresh:streamGeneration>0 }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); id = result.id; if (!controller.signal.aborted) setSession(result); })
      .catch(error => { if (!controller.signal.aborted) { reconnectRef.current('source connection failed'); } });
    return () => { controller.abort(); if (id) fetch(`/api/playback/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); };
  }, [mode, provider?.url, streamStart, streamGeneration]);
  useEffect(()=>{
    if(mode!=='history' || !provider)return;
    const controller=new AbortController();let id='';
    setHistory(null);setSession(null);setClockReady(false);setStatus('Finding the broadcast replay and full available history');setError('');
    fetch('/api/dvr',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:provider.url}),signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw new Error(result.error);id=result.id;if(!controller.signal.aborted){setHistory(result);const position=Math.max(result.start,Math.min(result.end-.1,historyResume.current));setHistorySeek(timestamp(position));setClock(position);if(!selectionEdited.current){setStart(timestamp(result.start));setEnd(timestamp(Math.min(result.end,result.start+(outputKind==='short'?clipDuration:targetMinutes*60))));}}})
      .catch(error=>{if(!controller.signal.aborted){reconnectRef.current('provider history connection failed');}});
    return()=>{controller.abort();if(id)fetch(`/api/dvr/${id}`,{method:'DELETE',keepalive:true}).catch(()=>{});};
  },[mode,provider?.url,historyGeneration]);
  useEffect(() => {
    const activeSession=mode==='history'?history:session;
    if (!activeSession || !video.current) return;
    const element = video.current;
    let disposed=false;let mediaRetries=0;let networkRetries=0;let stableSince=Date.now();let lastTime=element.currentTime;let lastProgress=Date.now();
    if (Hls.isSupported()) {
      const player = new Hls({ liveSyncDurationCount: 2, maxBufferLength: 20, backBufferLength: 1800, startPosition: mode==='history'?Math.max(0,historyResume.current-activeSession.start):activeSession.live ? -1 : 0 });
      hls.current = player; player.loadSource(activeSession.url); player.attachMedia(element);
      player.on(Hls.Events.MANIFEST_PARSED, () => { previewEnd.current = pendingEnd.current; pendingEnd.current = null; element.muted = true; element.play().catch(() => setStatus('Press play to watch')); });
      player.on(Hls.Events.ERROR, (_event, data) => {
        if(disposed || !data.fatal)return;
        setStatus('Recovering playback');
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR && /manifest/i.test(data.details)){reconnectRef.current(data.details);return;}
        if(data.type===Hls.ErrorTypes.MEDIA_ERROR && mediaRetries++<2){player.recoverMediaError();return;}
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR && networkRetries++<2){player.startLoad();return;}
        reconnectRef.current(data.details || 'stream interrupted');
      });
    } else if (element.canPlayType('application/vnd.apple.mpegurl')) { element.src = activeSession.url; element.muted = true; element.play().catch(() => {}); }
    else setError('This browser does not support streamed video playback.');
    const keepalive = setInterval(() => fetch(mode==='history'?`/api/dvr/${activeSession.id}/keepalive`:`/api/playback/${activeSession.id}/keepalive`, { method: 'POST' }).then(async response=>{const state=await response.json();if(!disposed && (!response.ok || state.running===false))reconnectRef.current('playback session ended');}).catch(() => {if(!disposed)reconnectRef.current('local connection lost');}), 10000);
    const watchdog=setInterval(()=>{
      if(element.paused || element.seeking){lastProgress=Date.now();stableSince=Date.now();return;}
      if(Math.abs(element.currentTime-lastTime)>.05){lastTime=element.currentTime;lastProgress=Date.now();if(Date.now()-stableSince>15000){recoveryAttempts.current=0;setError('');}}
      else if(Date.now()-lastProgress>20000){stableSince=Date.now();reconnectRef.current('playback stalled');}
    },2000);
    return () => { disposed=true;clearInterval(keepalive);clearInterval(watchdog);if(reconnectTimer.current){clearTimeout(reconnectTimer.current);reconnectTimer.current=null;}hls.current?.destroy(); hls.current = null; };
  }, [session,history,mode]);
  useEffect(() => {
    const timer = setInterval(() => {
      const player = youtube.current;
      const native = video.current;
      const current = mode === 'youtube' ? Number(player?.getCurrentTime?.()) : native ? native.currentTime + (mode==='history'?history?.start || 0:session?.start || 0) : NaN;
      if (Number.isFinite(current)) {
        setClock(current);
        if (native?.seekable.length) setBufferRange({ start: native.seekable.start(0) + (mode==='history'?history?.start || 0:session?.start || 0), end: native.seekable.end(native.seekable.length - 1) + (mode==='history'?history?.start || 0:session?.start || 0) });
        if (previewEnd.current !== null && current >= previewEnd.current) {
          const end = previewEnd.current;
          player?.pauseVideo?.();
          if (native) { native.pause(); native.currentTime = Math.max(0, end - (mode==='history'?history?.start || 0:session?.start || 0)); }
          previewEnd.current = null;
        }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [mode, session?.start,history?.start]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]') || !clockReady || (live && !clipBuffered)) return;
      if (event.key.toLowerCase() === 'i') { event.preventDefault(); markStart(); }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); selectionEdited.current = true; setEnd(timestamp(clock)); }
      if (event.key.toLowerCase() === 'c' && rights && !busy) { event.preventDefault(); void prepareClip(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  if (!provider) return null;
  function selectedRange() {
    const a = parseTimestamp(start); const b = parseTimestamp(end);
    if (b <= a) throw new Error('Set the end after the start.');
    if (!live && detection?.duration && b > detection.duration + .05) throw new Error('Keep the range inside this video.');
    if (outputKind === 'short' && b - a > 120) throw new Error('Short clips support up to two minutes.');
    if(mode==='history'){if(!history)throw new Error('Wait for full history to load.');return validateHistoryRange({start:a,end:b,availableStart:history.start,availableEnd:history.end,maxDuration:outputKind==='short'?120:1800});}
    return { start: a, end: b };
  }
  function markStart() {
    selectionEdited.current = true; setStart(timestamp(clock));
    const length=outputKind==='short'?clipDuration:targetMinutes*60;
    const upper=mode==='history' && history?history.end:live?Infinity:detection?.duration || Infinity;
    const next=Math.min(upper,clock+length);
    try { const previous=parseTimestamp(end);if(previous<=clock || previous>next)setEnd(timestamp(next)); } catch {setEnd(timestamp(next));}
  }
  function seekBy(seconds: number) {
    previewEnd.current = null;
    if (youtube.current) { const player = youtube.current; player.seekTo(Math.max(0, player.getCurrentTime() + seconds), true); }
    else if (video.current) {
      const element = video.current;
      const lower = element.seekable.length ? element.seekable.start(0) : 0;
      const upper = element.seekable.length ? element.seekable.end(element.seekable.length - 1) : element.duration;
      element.currentTime = Math.max(lower, Math.min(upper, element.currentTime + seconds));
    }
  }
  function previewSelection() {
    try {
      const range = selectedRange(); previewEnd.current = range.end; setError('');
      if (mode === 'youtube' && youtube.current) { youtube.current.seekTo(range.start, true); youtube.current.playVideo(); }
      else if (mode === 'stream' && !live) {
        previewEnd.current = null; pendingEnd.current = range.end;
        setStreamStart(range.start); setStreamGeneration(value => value + 1);
      }
      else if (video.current) { video.current.currentTime = range.start - (mode==='history'?history?.start || 0:0); video.current.play().catch(() => {}); }
    } catch (error) { setError((error as Error).message); }
  }
  async function prepareClip() {
    if (!rights) { setError('Confirm media rights below to enable clipping.'); return; }
    if (live && clipBuffered && (mode==='history'?!history:!session)) { setError('Wait for the streamed buffer to connect before preparing a clip.'); return; }
    setPreparing(true); setError(''); previewEnd.current = null;
    try {
      const range = live && !clipBuffered ? { start: 0, end: outputKind === 'short' ? clipDuration : targetMinutes * 60 } : selectedRange();
      const next = mode==='history' && history ? await action(`/api/dvr/${history.id}/clip`,{start:range.start,end:range.end,rightsConfirmed:true,ratio,preset,transcribe},'Preparing the selected earlier live moment at original replay quality.') : live && clipBuffered && session ? await action(`/api/playback/${session.id}/clip`, { start: range.start, end: range.end, rightsConfirmed: true, ratio, preset, resolution: 1080, transcribe }, 'Preparing your selected buffered range for review.') : await action('/api/process-link', { url: provider!.url, inputMode: 'range', start: range.start, duration: range.end - range.start,
        manualClip: true, captureLive: live, detectionMode: 'manual', reviewFirst: true, rightsConfirmed: true, ratio, preset, resolution: 1080, clipDuration: outputKind === 'short' ? clipDuration : 120, transcribe },
        live ? 'Live clip recording started. Watch here while it records, then review the captured range.' : 'Your selected range is being prepared for preview and editing.');
      if (next?.id) onJob(next);
    } catch (error) { setError((error as Error).message); }
    finally { setPreparing(false); }
  }
  const youtubeUrl = mode === 'youtube' ? `https://www.youtube.com/embed/${provider.id}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}&autoplay=1&mute=1&playsinline=1&rel=0` : '';
  return <section className="source-player" data-player-mode={mode}>
    <div className="source-player-heading"><strong>{live ? <><Radio size={15}/>Watch live</> : 'Watch this video'}</strong><span className="player-status" aria-live="polite">{live && <b>{mode==='history'?'REPLAY':'LIVE'}</b>}{status}</span></div>
    <div className="source-player-screen">{mode === 'youtube' ? <div className="youtube-player-host"><iframe ref={iframe} title="Source video player" src={youtubeUrl} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div> : mode === 'twitch' ? <iframe title="Source live player" src={`https://player.twitch.tv/?${provider.id}&parent=${encodeURIComponent(location.hostname)}&autoplay=true&muted=true`} allow="autoplay; fullscreen" allowFullScreen/> : <video ref={video} src={mode === 'direct' ? provider.url : undefined} controls autoPlay muted playsInline
      onLoadedMetadata={event => {
        setClockReady(true); setStatus('Ready to play');
        if (mode === 'direct' && !selectionEdited.current && Number.isFinite(event.currentTarget.duration)) {
          const length = event.currentTarget.duration;
          setEnd(value => { try { return timestamp(Math.min(parseTimestamp(value), length)); } catch { return timestamp(length); } });
        }
      }} onPlaying={() => { setClockReady(true); setStatus('Playing');setError(''); }} onPause={() => setStatus('Paused')}
      onError={() => { if (mode === 'direct') setMode('stream'); else if(mode==='history')setError('This replay codec could not play in your browser. Try refreshing full history.'); }}/>}</div>
    <p className="fine-print">Playback uses an optimized preview. Live buffering keeps the original source streams separately for full-quality downloads.</p><div className="source-player-toolbar"><span>Player time {timestamp(clock)}</span>{live && <button type="button" className="button small" onClick={() => { if(mode==='history'){setMode('stream');setClipBuffered(true);setStreamGeneration(value=>value+1);} else if (youtube.current) { youtube.current.seekTo(youtube.current.getDuration(), true); youtube.current.playVideo(); } else if (video.current?.seekable.length) { video.current.currentTime = hls.current?.liveSyncPosition || video.current.seekable.end(video.current.seekable.length - 1); video.current.play().catch(() => {}); } }}>Go live</button>}<button type="button" className="link-button" onClick={() => { recoveryAttempts.current=0;setMode('stream'); setStreamGeneration(value => value + 1); }}> {mode === 'stream' ? 'Reload streamed player' : 'Use streamed player'}</button></div>
    {live && <div className="panel"><div className="row spaced"><button type="button" className="button primary" onClick={()=>{historyResume.current=mode==='history'?clock:0;setClipBuffered(true);setMode('history');setHistoryGeneration(value=>value+1);}}>{mode==='history'?'Refresh full history':'View full live history'}</button>{mode==='history' && history && <button type="button" className="button" disabled={!clockReady} onClick={()=>{if(video.current){previewEnd.current=null;video.current.currentTime=0;video.current.play().catch(()=>{});}}}>{history.fromBeginning?'Go to beginning':'Go to earliest available'}</button>}</div>{mode==='history' && history && <><p>{history.message} Available: {timestamp(history.start)} to {timestamp(history.end)}. Provider history is independent of the local buffer recorded after pasting your link.</p><label className="field"><span>Seek in broadcast history</span><input value={historySeek} onChange={event=>setHistorySeek(event.target.value)}/></label><button type="button" className="button small" disabled={!clockReady} onClick={()=>{try{const target=parseTimestamp(historySeek);if(target<history.start || target>history.end)throw new Error('Choose a time inside the available history');if(video.current){previewEnd.current=null;video.current.currentTime=target-history.start;video.current.play().catch(()=>{});}setError('');}catch(error){setError((error as Error).message);}}}>Seek to timestamp</button></>}<p className="fine-print">Full history uses the platform DVR or the matching ongoing replay. If the broadcaster or platform removes earlier footage, the app cannot recover it. Go live returns to the current feed.</p></div>}
    {reconnectNotice && <p className="info-box">{reconnectNotice}</p>}{error && <div className="link-error" role="alert">{error}</div>}
    {live && mode!=='history' && <div className="row spaced"><button type="button" className="button" onClick={() => { setClipBuffered(true); if (mode !== 'stream') { setMode('stream'); setStreamGeneration(value => value + 1); } }}>Enable rewind & clipping</button>{clipBuffered && <button type="button" className="button" onClick={() => setClipBuffered(false)}>Record from now instead</button>}</div>}
    {(!live || clipBuffered) && <><div className="row spaced"><button type="button" className="button" disabled={!clockReady} onClick={() => seekBy(-10)}>Back 10 seconds</button><button type="button" className="button" disabled={!clockReady} onClick={() => seekBy(-5)}>Back 5 seconds</button><button type="button" className="button" disabled={!clockReady} onClick={() => seekBy(5)}>Forward 5 seconds</button><button type="button" className="button primary" disabled={!clockReady} onClick={markStart}>Mark clip start</button><button type="button" className="button" disabled={!clockReady} onClick={() => { selectionEdited.current = true; setEnd(timestamp(clock)); }}>Mark clip end</button></div><p className="fine-print">Shortcuts: I marks start, O marks end, C prepares the clip. Rewind to the beginning of the moment, mark the start, then watch or seek to its end and mark the end.{live && (mode==='history' && history ? ` Full provider history: ${timestamp(history.start)} to ${timestamp(history.end)}.` : ` Available local buffer: ${timestamp(bufferRange.start)} to ${timestamp(bufferRange.end)}. Use View full live history for earlier footage.` )}</p><div className="row spaced">{[30, 60, 120].map(seconds => <button type="button" className="button small" key={seconds} disabled={!clockReady || clock <= 0} onClick={() => { selectionEdited.current = true; setStart(timestamp(Math.max(live ? bufferRange.start : 0, clock - seconds))); setEnd(timestamp(clock)); }}>Select last {seconds}s</button>)}</div><div className="player-clip-fields"><label className="field"><span>Clip start · HH:MM:SS or seconds</span><input value={start} onChange={event => { selectionEdited.current = true; setStart(event.target.value); }}/><button type="button" className="link-button spaced" disabled={!clockReady} onClick={markStart}>Use player time as start</button></label><label className="field"><span>Clip end · HH:MM:SS or seconds</span><input value={end} onChange={event => { selectionEdited.current = true; setEnd(event.target.value); }}/><button type="button" className="link-button spaced" disabled={!clockReady} onClick={() => { selectionEdited.current = true; setEnd(timestamp(clock)); }}>Use player time as end</button></label><button type="button" className="button" disabled={!clockReady} onClick={previewSelection}><Play size={14}/>Preview selected range</button></div></>}
    {live && session && clipBuffered && <LiveAutomation sessionId={session.id} rights={rights} ratio={ratio} preset={preset} clipDuration={clipDuration} transcribe={transcribe} onJob={onJob}/>}<div className="row spaced"><button type="button" className="button primary" disabled={!rights || busy} onClick={prepareClip}>{live ? <Circle size={15}/> : <Scissors size={15}/>} {live && !clipBuffered ? `Record next ${outputKind === 'short' ? clipDuration + ' seconds' : targetMinutes + ' minutes'}` : 'Prepare selected clip'}</button>{currentJob?.status === 'running' && currentJob.phase === 'record' && <button type="button" className="button" disabled={!currentJob.progress} onClick={() => action(`/api/finish/${currentJob.id}`, {}, 'Finishing the recording and preparing its preview.')}><Square size={13}/>Finish recording now</button>}</div>
    <p className="fine-print">{rights ? mode==='history' ? 'Clipping uses the selected earlier broadcast timestamps from the provider replay.' : live && clipBuffered ? 'Clipping uses video buffered since this streamed player opened. Mark an end inside the available buffer before preparing.' : live ? 'Recording begins from the live feed when the capture connection is established. You can finish early and review the recorded clip.' : 'Preview the selected time range, then prepare it for review, editing, and MP4 export.' : 'Confirm media rights below to enable clipping. You can watch the player now.'}</p>
  </section>;
}
