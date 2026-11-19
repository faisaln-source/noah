import FileSize from './FileSize';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, ChevronRight, Clapperboard, Clock3, Copy, Film, FolderOpen, Gamepad2, Gauge, Layers3, LayoutDashboard, LoaderCircle, Monitor, Pause, Play, Plus, Scissors, Settings2, Sparkles, SplitSquareHorizontal, Subtitles, Trash2, Undo2, Redo2, UploadCloud, WandSparkles, X, Zap } from 'lucide-react';
import { defaults, useEditor } from './store';
import type { Caption, Highlight, Job, Media, Project, Scene, Timeline, Options } from './types';
import './style.css';
import LinkWorkflow from './LinkWorkflow';
import MomentReview from './MomentReview';
import EditorPreview from './EditorPreview';
import EditorModes from './EditorModes';
import BulkDelete, {SelectMedia} from './BulkDelete';
import FileActions, { TrashPanel, DeleteProject } from './FileActions';
import { gtaCaptionTheme } from './captionTheme';
import EditorDelivery, { type DeliveryRequest } from './EditorDelivery';
import {YouTubeAccount,YouTubePublish} from './YouTubePublishing';
import SemanticSettings, {SpeechSettings} from './SemanticSettings';
import VoiceControls from './VoiceControls';
import EditorAdjustments from './EditorAdjustments';
import {OutputSettings, BatchCaptions, LocalPathImport} from './LibraryExtras';

async function api<T = any>(route: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
const time = (value = 0) => { const n = Math.max(0, Math.floor(value)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const bytes = (value = 0) => value > 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
const presets = [
  { id: 'viral', name: 'Viral Gaming Shorts', desc: 'Punchy color, motion zoom, pop captions', icon: Zap, effect: 'vivid', zoom: true, fade: true, captionStyle: 'pop' },
  { id: 'cinematic', name: 'Cinematic GTA', desc: 'Muted color, soft fades, classic captions', icon: Film, effect: 'cinematic', zoom: false, fade: true, captionStyle: 'classic' },
  { id: 'funny', name: 'Funny Moments', desc: 'Warm tones, zoom, karaoke captions', icon: Gamepad2, effect: 'warm', zoom: true, fade: false, captionStyle: 'karaoke' },
  { id: 'action', name: 'Action Highlights', desc: 'Vivid color, quick fades, clear captions', icon: Activity, effect: 'vivid', zoom: false, fade: true, captionStyle: 'pop' },
  { id: 'clean', name: 'Clean Gameplay', desc: 'Original color and normalized audio', icon: Monitor, effect: 'none', zoom: false, fade: false, captionStyle: 'classic' }
];
const navigation = [
  ['Dashboard', LayoutDashboard], ['Import Video', UploadCloud], ['AI Highlights', Sparkles], ['Auto Editor', WandSparkles],
  ['Video Editor', Clapperboard], ['Compilations', Layers3], ['My Projects', FolderOpen], ['Exports', ArrowDownToLine], ['Settings', Settings2]
] as const;
function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return <label className="field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}
function Empty({ icon: Icon = Film, title, text, action }: any) {
  return <div className="empty"><div className="empty-mark"><Icon size={28}/></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
function Thumb({ media }: { media: Media }) {
  return <div className="thumbnail">{media.thumbnail ? <img src={`/thumb/${media.id}`} alt="" loading="lazy"/> : <Film size={32}/>}<span>{time(media.duration)}</span></div>;
}
function App() {
  const query = useQueryClient();
  const [page, setPage] = useState('Dashboard');
  const [message, setMessage] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [preview, setPreview] = useState<Highlight | null>(null);
  const { timeline, change, load } = useEditor();
  const { data: media = [] } = useQuery({ queryKey: ['media'], queryFn: () => api<Media[]>('/api/library') });
  const { data: highlights = [] } = useQuery({ queryKey: ['highlights'], queryFn: () => api<Highlight[]>('/api/highlights') });
  const { data: jobs = [] } = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('/api/jobs'), refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: () => api('/api/stats'), refetchInterval: 10000 });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/api/projects') });
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api('/api/health'), staleTime: 60000 });
  const sources = media.filter(item => !['export', 'audio'].includes(item.kind));
  const source = sources.find(item => item.id === sourceId) || sources[0];
  const exports = media.filter(item => item.kind === 'export');
  const activeJobs = jobs.filter(job => ['running', 'queued'].includes(job.status));
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    let refreshMedia = false;
    const events = new EventSource('/api/events');
    events.onmessage = event => {
      const update = JSON.parse(event.data);
      refreshMedia ||= update.status === 'done' || update.status === 'error' || update.connected;
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        query.invalidateQueries({ queryKey: ['jobs'] });
        if (refreshMedia) {
          for (const key of ['media', 'stats', 'highlights', 'health']) query.invalidateQueries({ queryKey: [key] });
          refreshMedia = false;
        }
      }, 250);
    };
    return () => { events.close(); clearTimeout(timeout); };
  }, [query]);
  const notify = (text: string) => { setMessage(text); };
  async function action(route: string, payload: unknown, success = 'Processing started. Follow progress in the queue.') {
    try { const result = await api(route, payload); query.invalidateQueries({ queryKey: ['jobs'] }); notify(success); return result; }
    catch (error) { notify((error as Error).message); }
  }
  function openSource(item: Media, start = 0, end = item.duration, options: Partial<Options> = {}) {
    setSourceId(item.id);
    const style = presets.find(preset => preset.id === options.preset);
    const styleOptions = style ? { effect: style.effect, zoom: style.zoom, fade: style.fade, captionStyle: style.captionStyle } : {};
    load({ ...defaults, ...styleOptions, sourceCanvas: !options.ratio, ratio: options.ratio || `${item.width || 1920}:${item.height || 1080}`, resolution: Math.min(item.width || 1920, item.height || 1080), title: `${item.title} highlight`, ...options, clips: [{ id: crypto.randomUUID(), sourceId: item.id, start, end }] });
    setPage('Video Editor');
  }
  function openProject(project: Project) {
    const previous = project.timeline;
    const first = media.find(item => item.id === previous.clips.find(clip => clip.sourceId)?.sourceId);
    let upgraded = previous;
    if (!previous.qualityPolicyVersion) {
      const aspect = previous.ratio.split(':').map(Number);
      const sameCanvas = first?.width && first?.height && Math.abs(aspect[0] / aspect[1] - first.width / first.height) < .01;
      upgraded = { ...previous, qualityPolicyVersion: 2, quality: 'lossless', encoder: 'cpu', bitrate: 0, fps: 0, sourceCanvas: !!sameCanvas,
        resolution: first?.width && first?.height ? Math.max(previous.resolution || 1080, Math.min(2160, first.width, first.height)) : previous.resolution };
    }
    load(upgraded, project.id); setPage('Video Editor');
  }
  function openHighlight(highlight: Highlight) {
    const item = media.find(item => item.id === highlight.sourceId);
    if (item) { openSource(item, highlight.start, highlight.end); change({ title: highlight.title }); }
  }
  const selector = <select className="source-select" value={source?.id || ''} onChange={event => setSourceId(event.target.value)}><option value="" disabled>Select a recording</option>{sources.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>;
  return <div className="app-shell">
    <aside><a className="brand" href="#" onClick={() => setPage('Dashboard')}><div className="brand-mark"><Scissors size={22}/></div><span>ClipForge<span className="brand-ai">AI</span></span></a><div className="workspace-label">CREATOR WORKSPACE</div><nav>{navigation.map(([name, Icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><Icon size={18}/><span>{name}</span>{name === 'AI Highlights' && highlights.length > 0 && <b>{highlights.length}</b>}</button>)}</nav><div className="local-panel"><span className="status-dot"/><strong>Local AI engine</strong><p>{health?.python ? 'Ready on your computer' : 'Checking AI dependencies'}</p><small>No paid API required</small></div><div className="profile"><div>G</div><span>Gaming workspace<small>Personal studio</small></span></div></aside>
    <div className="main-shell"><header><div className="breadcrumbs">Workspace <ChevronRight size={14}/> <span>{page}</span></div><div className="header-right"><span className="local-label"><span className="status-dot"/>LOCAL WORKSPACE</span><button className="button small" onClick={() => setPage('Import Video')}><Plus size={15}/> Import video</button></div></header>
    <main><div className="page-heading"><div><div className="eyebrow">YOUR GAMEPLAY. YOUR STORY.</div><h1>{page === 'Dashboard' ? 'Great moments deserve an audience.' : page}</h1><p>{({ Dashboard: 'Turn long gaming sessions into clips worth watching.', 'Import Video': 'Bring your gameplay into the studio.', 'AI Highlights': 'Review and rank the moments found in your recordings.', 'Auto Editor': 'From recording to edited clips, in one workflow.', 'Video Editor': 'Shape your story with a non-destructive timeline.', Compilations: 'Bring your best moments together.', 'My Projects': 'Pick up where you left off.', Exports: 'Finished videos, ready to download.', Settings: 'Your local engine and processing capabilities.' } as any)[page]}</p></div>{['AI Highlights', 'Auto Editor', 'Video Editor'].includes(page) && selector}</div>
    {message && <div className="notice" role="status"><span>{message}</span><button aria-label="Dismiss" onClick={() => setMessage('')}><X size={16}/></button></div>}
    {page === 'Dashboard' && <>
      <LinkWorkflow action={action} onEdit={openSource} onExports={() => setPage('Exports')}/>
      <section className="hero"><div className="hero-copy"><span className="pill"><Sparkles size={13}/> BUILT FOR GAMING CREATORS</span><h2>Less scrubbing.<br/><span>More highlight reels.</span></h2><p>Find the action. Add your style. Let your local AI engine do the heavy lifting.</p><div className="row"><button className="button primary" onClick={() => setPage(sources.length ? 'Auto Editor' : 'Import Video')}><WandSparkles size={17}/> Create clips <ArrowRight size={16}/></button><button className="button quiet" onClick={() => setPage('Video Editor')}>Open editor <ChevronRight size={16}/></button></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card back"><AudioLines size={58}/></div><div className="art-card front"><Scissors size={60}/><div className="art-timeline"><i/><i/><i/><i/></div><span>YOUR NEXT HIGHLIGHT</span></div><div className="spark spark-one">✦</div><div className="spark spark-two">✧</div></div></section>
      <div className="stats-grid">{[[Film, 'Imported videos', stats?.imported || 0], [Sparkles, 'Highlights detected', stats?.highlights || 0], [ArrowDownToLine, 'Videos exported', stats?.exports || 0], [Gauge, 'Processing queue', stats?.queued || 0]].map(([Icon, label, value]: any) => <div className="stat" key={label}><div className="stat-icon"><Icon size={19}/></div><strong>{value}</strong><span>{label}</span></div>)}</div>
      <div className="section-title"><h2>Your recordings</h2><button className="link-button" onClick={() => setPage('Import Video')}>Import a video <Plus size={14}/></button></div>
      {!sources.length ? <Empty icon={UploadCloud} title="Your next highlight starts here" text="Import a recording or paste a video link to get started." action={<button className="button" onClick={() => setPage('Import Video')}>Import gameplay <ArrowRight size={15}/></button>}/> : <div className="media-grid">{sources.slice(0, 6).map(item => <MediaCard key={item.id} item={item} onEdit={() => openSource(item)} onAnalyze={() => { setSourceId(item.id); setPage('Auto Editor'); }}/>)}</div>}
      <div className="section-title"><h2>Recent projects</h2><span>{bytes(stats?.storage)} used · {stats?.free ? `${bytes(stats.free)} available` : 'Local storage'}</span></div><ProjectList projects={projects.slice(0, 3)} onOpen={openProject}/>
    </>}
    {page === 'Import Video' && <><ImportPanel action={action} notify={notify} onEdit={openSource} onExports={() => setPage('Exports')} onComplete={item => { query.invalidateQueries({ queryKey: ['media'] }); query.invalidateQueries({ queryKey: ['stats'] }); setSourceId(item.id); }}/><LocalPathImport action={action}/><BatchCaptions media={media} action={action}/><div className="section-title"><h2>Media library</h2><span>{sources.length} recordings</span></div><BulkDelete items={sources}><div className="media-grid">{sources.map(item => <MediaCard key={item.id} item={item} onEdit={() => openSource(item)} onAnalyze={() => { setSourceId(item.id); setPage('Auto Editor'); }}/>)}</div></BulkDelete></>}
    {page === 'Auto Editor' && (source ? <LinkWorkflow key={source.id} existingSource={source} action={action} onEdit={openSource} onExports={() => setPage('Exports')}/> : <Empty icon={UploadCloud} title="Import your gameplay first" text="Import a link or upload a recording to detect and review moments."/>)}
    {page === 'AI Highlights' && (source ? <MomentReview key={`${source.id}:${source.analysis?.analyzedAt || 0}`} source={source} highlights={highlights.filter(item => item.sourceId === source.id)} reviewId={`${source.id}:${source.analysis?.analyzedAt || 0}`} options={{ ...timeline, outputKind: ['9:16', '3:4'].includes(timeline.ratio) ? 'short' : 'long', targetMinutes: 20, transcribe: timeline.captions }} action={action} onEdit={openSource} onExports={() => setPage('Exports')}/> : <Empty icon={Sparkles} title="Import and analyze a recording" text="Every detected range and manually added timestamp will be available for preview here."/>)}
    {page === 'Video Editor' && <Editor media={media} source={source} action={action} notify={notify} onSaved={() => query.invalidateQueries({ queryKey: ['projects'] })}/>}
    {page === 'Compilations' && <Compilations highlights={highlights} chosen={chosen} setChosen={setChosen} timeline={timeline} action={action}/>}
    {page === 'My Projects' && <ProjectList projects={projects} onOpen={openProject}/>}
    {page === 'Exports' && <YouTubePublish media={media} action={action}/>}
    {page === 'Exports' && (exports.length ? <BulkDelete items={exports}><div className="media-grid">{exports.map(item => <div className="media-card" key={item.id}><SelectMedia item={item}/><video className="export-preview" controls preload="none" src={`/media/${item.id}`} poster={`/thumb/${item.id}`}/><div className="media-content"><div className="card-eyebrow">{item.quality === 'original' ? 'ORIGINAL QUALITY' : item.quality === 'lossless-edited' ? 'LOSSLESS EDITED' : 'MP4 EXPORT'} <span>{item.width} × {item.height}</span></div><h3 title={item.title}>{item.title}</h3><p><FileSize size={item.size}/> · {new Date(item.createdAt).toLocaleDateString()}</p><div className="row"><a className="button primary small" href={`/media/${item.id}?download=1`}><ArrowDownToLine size={14}/> Download</a><button className="button small" onClick={() => openSource(item)}><Scissors size={13}/>Edit video</button></div><FileActions item={item}/>{item.srt && item.vtt && <div className="subtitle-downloads"><a href={`/media/${item.id}?format=srt&download=1`}>SRT</a><a href={`/media/${item.id}?format=vtt&download=1`}>VTT</a></div>}</div></div>)}</div></BulkDelete> : <Empty icon={ArrowDownToLine} title="Your finished clips live here" text="Analyze a recording or open the editor to create your first export."/>)}
    {page === 'Settings' && <><Settings health={health} stats={stats}/><TrashPanel/></>}
    {(activeJobs.length > 0 || jobs.some(job => job.status === 'error') || page === 'Exports') && <Queue jobs={jobs} action={action}/>}
    <footer><span>ClipForge AI <span className="muted">· Your local gaming studio</span></span><span><span className="status-dot"/> {activeJobs.length ? `${activeJobs.length} jobs in progress` : 'Ready to create'}</span></footer>
    </main></div>{preview && <div className="modal-backdrop" onClick={() => setPreview(null)}><div className="modal" onClick={event => event.stopPropagation()}><div className="section-title"><h2>{preview.title}</h2><button className="icon-button" aria-label="Close preview" onClick={() => setPreview(null)}><X/></button></div><video controls autoPlay src={`/media/${preview.sourceId}#t=${preview.start},${preview.end}`} onLoadedMetadata={event => { event.currentTarget.currentTime = preview.start; }} onTimeUpdate={event => { if (event.currentTarget.currentTime >= preview.end) event.currentTarget.pause(); }}/><p>{time(preview.start)} — {time(preview.end)} · {preview.reason}</p><button className="button primary" onClick={() => { openHighlight(preview); setPreview(null); }}>Edit this highlight <ArrowRight size={15}/></button></div></div>}
  </div>;
}
function MediaCard({ item, onEdit, onAnalyze }: { item: Media; onEdit: () => void; onAnalyze: () => void }) {
  return <article className="media-card"><SelectMedia item={item}/><Thumb media={item}/><div className="media-content"><div className="card-eyebrow">{item.kind}<span>{item.width || '—'} × {item.height || '—'}</span></div><h3 title={item.title}>{item.title}</h3><p><FileSize size={item.size}/> · {item.analysis?.highlights?.length || 0} highlights</p><div className="row"><button className="button primary small" onClick={onAnalyze}><Sparkles size={13}/> Auto clip</button><button className="button small" onClick={onEdit}><Scissors size={13}/> Edit</button></div><FileActions item={item}/>{item.sourceUrl && <a className="source-link" href={item.sourceUrl} target="_blank" rel="noreferrer">Original source ↗</a>}</div></article>;
}
function ImportPanel({ action, notify, onComplete, onEdit, onExports }: any) {
  const [rights, setRights] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(-1);
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState('');
  const pause = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const currentUpload = useRef('');
  async function upload(file?: File) {
    if (!file) return;
    if (!rights) { notify('Confirm your media rights before importing.'); if (input.current) input.current.value = ''; return; }
    setUploading(true); pause.current = false; setFilename(file.name);
    const key = `clipforge-upload:${file.name}:${file.size}:${file.lastModified}`;
    try {
      let session;
      const previous = localStorage.getItem(key);
      if (previous) session = await api(`/api/uploads/${previous}`).catch(() => null);
      if (!session) session = await api('/api/uploads', { name: file.name, size: file.size, rightsConfirmed: true });
      currentUpload.current = session.id;
      localStorage.setItem(key, session.id);
      let offset = session.offset;
      while (offset < file.size) {
        if (pause.current) { notify('Upload paused. Select the same file to resume.'); return; }
        let success = false;
        for (let attempt = 0; attempt < 3 && !success; attempt++) {
          try {
            const response = await fetch(`/api/uploads/${session.id}`, { method: 'PATCH', headers: { 'Upload-Offset': String(offset), 'Content-Type': 'application/octet-stream' }, body: file.slice(offset, offset + 8 * 1024 ** 2) });
            const result = await response.json();
            if (response.status === 409 && result.offset !== undefined) { offset = result.offset; continue; }
            if (!response.ok) throw new Error(result.error);
            offset = result.offset; success = true;
          } catch (error) { if (attempt === 2) throw error; const status = await api(`/api/uploads/${session.id}`); offset = status.offset; }
        }
        if (!success) throw new Error('Upload could not resume. Select the same file to try again.');
        setUploadProgress(Math.round(offset / file.size * 100));
      }
      const item = await api(`/api/uploads/${session.id}/complete`, {});
      localStorage.removeItem(key); onComplete(item); notify(`${file.name} imported. Open Auto Editor to find highlights.`); setUploadProgress(-1);
    } catch (error) { notify((error as Error).message); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  }
  return <div className="import-layout"><section className="panel"><div className="panel-heading"><UploadCloud size={19}/><h2>Upload a recording</h2></div><label className="rights"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)}/><span>I own this media or have permission to record, edit, and reuse it.</span></label><div className="dropzone" role="button" tabIndex={0} onClick={() => !uploading && input.current?.click()} onKeyDown={event => { if (event.key === 'Enter') input.current?.click(); }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!uploading) upload(event.dataTransfer.files[0]); }}><div className="empty-mark"><UploadCloud size={30}/></div><h3>Drop your gameplay here</h3><p>or click to browse files</p><span>MP4, MOV, MKV, WebM · MP3, WAV, M4A for music</span><input ref={input} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v,.mp3,.wav,.m4a,.ogg,.flac" hidden onChange={event => upload(event.target.files?.[0])}/></div>{uploadProgress >= 0 && <div className="upload-status"><span>{filename} · {uploadProgress}%</span><progress value={uploadProgress} max={100}/><div className="row"><button className="button small" disabled={!uploading} onClick={() => { pause.current = true; }}><Pause size={13}/> Pause</button><button className="button small" disabled={uploading} onClick={async () => { try { await api(`/api/uploads/${currentUpload.current}`, {}, 'DELETE'); setUploadProgress(-1); notify('Upload cancelled.'); } catch (error) { notify((error as Error).message); } }}>Cancel upload</button></div></div>}<p className="fine-print">Uploads resume when you select the same file again, including after a browser refresh.</p></section>
  <LinkWorkflow action={action} onEdit={onEdit} onExports={onExports}/></div>;
}
function PresetPicker() {
  const { timeline, change } = useEditor();
  return <div className="preset-list">{presets.map(preset => <button className={`preset ${timeline.preset === preset.id ? 'selected' : ''}`} key={preset.id} onClick={() => change({ preset: preset.id, effect: preset.effect, zoom: preset.zoom, fade: preset.fade, captionStyle: preset.captionStyle, normalize: true })}><div className="preset-icon"><preset.icon size={20}/></div><span><strong>{preset.name}</strong><small>{preset.desc}</small></span><div className="radio">{timeline.preset === preset.id && <Check size={11}/>}</div></button>)}</div>;
}
function CanvasOptions({ compact = false }: { compact?: boolean }) {
  const { timeline, change } = useEditor();
  const known = ['9:16', '3:4', '16:9', '1:1', '4:5'];
  return <><div className="form-grid"><Field label="Canvas ratio"><select value={timeline.sourceCanvas ? 'source' : known.includes(timeline.ratio) ? timeline.ratio : 'custom'} onChange={event => change(event.target.value === 'source' ? { sourceCanvas: true } : { sourceCanvas: false, ratio: event.target.value === 'custom' ? '2:3' : event.target.value })}><option value="source">Original source canvas</option>{known.map(value => <option key={value}>{value}</option>)}<option value="custom">Custom ratio</option></select></Field>{!timeline.sourceCanvas && !known.includes(timeline.ratio) ? <Field label="Custom width:height"><input value={timeline.ratio} onChange={event => change({ ratio: event.target.value })}/></Field> : <Field label="Resolution"><select value={timeline.resolution} onChange={event => change({ sourceCanvas: false, resolution: Number(event.target.value) })}>{[360,720,1080,1440,2160].map(value => <option key={value} value={value}>{value === 2160 ? '2160p / 4K' : `${value}p`}</option>)}</select></Field>}</div>{!compact && <><div className="form-grid"><Field label="Framing"><select value={timeline.fit} onChange={event => change({ fit: event.target.value })}><option value="cover">Fill / crop</option><option value="contain">Fit / letterbox</option><option value="blur">Fit over blurred background</option><option value="auto-face">Track faces / speaker / people</option></select></Field><Field label="Frame rate"><select value={timeline.fps} onChange={event => change({ fps: Number(event.target.value) })}><option value="0">Match source FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></Field></div><Field label="Horizontal crop position"><input type="range" min="0" max="1" step="0.01" value={timeline.cropX} onChange={event => change({ cropX: Number(event.target.value) })}/></Field><Field label="Vertical crop position"><input type="range" min="0" max="1" step="0.01" value={timeline.cropY} onChange={event => change({ cropY: Number(event.target.value) })}/></Field><label className="toggle"><input type="checkbox" checked={timeline.smartCrop} onChange={event => change({ smartCrop: event.target.checked })}/>Use motion-centroid crop suggestion</label><small className="muted">Motion suggestions require completed analysis. Face/speaker tracking is computed in the rendered preview; the live canvas shows a centered crop. Choose a fixed canvas ratio to apply reframing.</small></>}</>;
}
function Editor({ media, source, action, notify, onSaved }: { media: Media[]; source?: Media; action: any; notify: (message: string) => void; onSaved: () => void }) {
  const query = useQueryClient();
  const { timeline, change, load, projectId, past, future, undo, redo } = useEditor();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryRequest, setDeliveryRequest] = useState<DeliveryRequest | null>(null);
  function prepareDownload(mode: 'edited' | 'original') { setDeliveryRequest(current => ({ id: (current?.id || 0) + 1, mode })); }
  const [tab, setTab] = useState('Style');
  const [currentTime, setCurrentTime] = useState(0);
  const [captionDraft, setCaptionDraft] = useState<Caption[]>([]);
  const [captionJobId, setCaptionJobId] = useState('');
  const captionApplied = useRef('');
  const captionSelection = useRef('');
  const { data: captionJobs = [] } = useQuery<any[]>({ queryKey: ['jobs'], queryFn: () => api('/api/jobs'), refetchInterval: captionJobId ? 1000 : false });
  const captionJob = captionJobs.find(job => job.id === captionJobId);
  useEffect(() => {
    if (captionJob?.status !== 'done' || captionApplied.current === captionJob.id) return;
    captionApplied.current = captionJob.id;
    const current = useEditor.getState().timeline;
    if (JSON.stringify({ clips: current.clips, speed: current.speed }) !== captionSelection.current) { notify('The selected ranges changed. Generate subtitles again for their new timings.'); return; }
    change({ subtitles: captionJob.result.subtitles, captionSegments: captionJob.result.captionSegments, captions: captionJob.result.captionSegments.length > 0 });
    notify(captionJob.result.wordCount ? `Speech subtitles ready: ${captionJob.result.wordCount} timed words. Review the transcript before export.` : 'No speech words were recognized. Check the audio or add captions manually.');
  }, [captionJob?.status, captionJob?.id]);
  async function generateThemedCaptions() {
    change(gtaCaptionTheme);
    const current = useEditor.getState().timeline;
    captionSelection.current = JSON.stringify({ clips: current.clips, speed: current.speed });
    const next = await action('/api/editor/captions', { ...current, forceWordTiming: true }, 'Transcribing selected footage with speech-aligned word timings.');
    if (next?.id) setCaptionJobId(next.id);
  }
  const player = useRef<HTMLVideoElement>(null);
  const dragIndex = useRef(0);
  const scene = timeline.clips[sceneIndex];
  const item = media.find(item => item.id === scene?.sourceId);
  const total = timeline.clips.reduce((sum, clip) => sum + (clip.type === 'title' ? clip.duration || 2 : (clip.end - clip.start) / timeline.speed), 0);
  useEffect(() => { setCaptionDraft(item?.transcript?.segments || []); }, [item?.id, item?.transcript]);
  useEffect(() => { if (player.current && scene && scene.type !== 'title') player.current.currentTime = scene.start; }, [sceneIndex, item?.id]);
  useEffect(() => { if (sceneIndex >= timeline.clips.length) setSceneIndex(Math.max(0, timeline.clips.length - 1)); }, [timeline.clips.length, sceneIndex]);
  function updateScene(changes: Partial<Scene>) { change({ clips: timeline.clips.map((clip, index) => index === sceneIndex ? { ...clip, ...changes } : clip) }); }
  function addSource() {
    if (!source) { notify('Import a recording first.'); return; }
    change({ clips: [...timeline.clips, { id: crypto.randomUUID(), sourceId: source.id, start: 0, end: Math.min(30, source.duration) }] });
    setSceneIndex(timeline.clips.length);
  }
  function split() {
    if (!scene || scene.type === 'title' || currentTime <= scene.start + .05 || currentTime >= scene.end - .05) { notify('Move the playhead inside the selected clip to split it.'); return; }
    const clips = [...timeline.clips];
    clips.splice(sceneIndex, 1, { ...scene, end: currentTime }, { ...scene, id: crypto.randomUUID(), start: currentTime });
    change({ clips });
  }
  async function saveProject() {
    try {
      const project = await api('/api/projects', { id: projectId || undefined, title: timeline.title, timeline });
      load(timeline, project.id); onSaved(); notify('Project saved. Reopen it from My Projects.');
    } catch (error) { notify((error as Error).message); }
  }
  async function saveTranscript() {
    if (!item) return;
    try { await api(`/api/transcript/${item.id}`, { segments: captionDraft }, 'PUT'); query.invalidateQueries({ queryKey: ['media'] }); notify('Transcript saved. Exports will use your edits.'); }
    catch (error) { notify((error as Error).message); }
  }
  const caption = captionDraft.find(caption => currentTime >= caption.start && currentTime <= caption.end);
  return <><div className="toolbar"><div className="row"><button className="icon-button" title="Undo" disabled={!past.length} onClick={undo}><Undo2 size={17}/></button><button className="icon-button" title="Redo" disabled={!future.length} onClick={redo}><Redo2 size={17}/></button><input className="project-title" aria-label="Project title" value={timeline.title} onChange={event => change({ title: event.target.value })}/></div><div className="row"><button className="button small" disabled={!timeline.clips.length} onClick={saveProject}><FolderOpen size={14}/> Save project</button><button className="button primary small" disabled={!timeline.clips.length || deliveryBusy} onClick={() => prepareDownload('edited')}><ArrowDownToLine size={15}/> Export video</button></div></div>
  <EditorDelivery request={deliveryRequest} onBusyChange={setDeliveryBusy}/><EditorModes action={action} sceneIndex={sceneIndex} onApplied={index => setSceneIndex(Math.max(0, index))}/><div className="editor-grid"><div className="editor-main"><section className="panel preview-panel"><div className="preview-top"><span className="pill">LIVE EDIT PREVIEW</span><span>{item?.title || scene?.text || 'No clip selected'}</span><span>{timeline.ratio}</span></div><EditorPreview timeline={timeline} scene={scene} item={item} captions={captionDraft} player={player} onTime={setCurrentTime} notify={notify}/><div className="preview-bottom"><span>{time(currentTime)} <span className="muted">/ {time(item?.duration)}</span></span><span>Live visuals update immediately. Use Render exact preview for export-matched effects, audio, and transitions.</span>{item && <button className="link-button" onClick={() => action('/api/proxy', { sourceId: item.id }, 'Browser preview conversion queued.')}>Create preview</button>}</div><div id="editor-rendered-preview"/></section>
    <section className="panel timeline-panel"><div className="section-title"><h2><Layers3 size={16}/>Timeline <span className="muted">{time(total)}</span></h2><div className="row"><button className="button small" onClick={addSource}><Plus size={13}/>Clip</button><button className="button small" onClick={() => change({ clips: [...timeline.clips, { id: crypto.randomUUID(), type: 'title', text: 'Your title here', start: 0, end: 2, duration: 2 }] })}><Plus size={13}/>Title</button><button className="icon-button" title="Split at playhead" onClick={split}><SplitSquareHorizontal size={17}/></button><button className="icon-button" title="Remove selected clip" disabled={!scene} onClick={() => change({ clips: timeline.clips.filter((_, index) => index !== sceneIndex) })}><Trash2 size={16}/></button></div></div><div className="track"><span className="track-label"><Film size={14}/>VIDEO</span><div className="scene-track">{timeline.clips.map((clip, index) => <button draggable onDragStart={() => { dragIndex.current = index; }} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const clips = [...timeline.clips]; const [moving] = clips.splice(dragIndex.current, 1); clips.splice(index, 0, moving); change({ clips }); setSceneIndex(index); }} key={clip.id || index} className={`scene-block ${index === sceneIndex ? 'selected' : ''}`} style={{ flexGrow: clip.type === 'title' ? clip.duration || 2 : clip.end - clip.start }} onClick={() => setSceneIndex(index)}><span>{clip.type === 'title' ? 'Title card' : media.find(item => item.id === clip.sourceId)?.title}</span><small>{clip.type === 'title' ? time(clip.duration) : `${time(clip.start)} – ${time(clip.end)}`}</small></button>)}{!timeline.clips.length && <span className="muted">Add clips to your timeline</span>}</div></div><div className="track"><span className="track-label"><Subtitles size={14}/>CAPTIONS</span><button className="caption-lane" onClick={() => setTab('Captions')}>{timeline.captions ? `${captionDraft.length} source captions · ${timeline.captionStyle}` : 'Captions disabled'}</button></div><div className="track"><span className="track-label"><AudioLines size={14}/>AUDIO</span><button className="audio-lane" onClick={() => setTab('Audio')}>{timeline.musicId ? media.find(item => item.id === timeline.musicId)?.title : `Source audio · ${Math.round(timeline.volume * 100)}%`}</button></div><small className="muted">Drag clips to reorder. Select a clip to trim, split, or remove it.</small>
      {scene && (scene.type === 'title' ? <div className="form-grid"><Field label="Title card text"><input value={scene.text || ''} onChange={event => updateScene({ text: event.target.value })}/></Field><Field label="Duration"><input type="number" min="0.5" max="15" step="0.1" value={scene.duration || 2} onChange={event => updateScene({ duration: Number(event.target.value) })}/></Field></div> : <div className="trim-grid"><Field label="In point (seconds)"><input type="number" min="0" step="0.001" value={scene.start} onChange={event => updateScene({ start: Number(event.target.value) })}/></Field><button className="button small" onClick={() => updateScene({ start: Math.round(currentTime * 1000) / 1000 })}>Set in</button><Field label="Out point (seconds)"><input type="number" min="0" step="0.001" value={scene.end} onChange={event => updateScene({ end: Number(event.target.value) })}/></Field><button className="button small" onClick={() => updateScene({ end: Math.round(currentTime * 1000) / 1000 })}>Set out</button></div>)}
    </section>
  </div><section className="panel inspector"><div className="inspector-tabs">{['Style', 'Canvas', 'Captions', 'Audio', 'Export'].map(value => <button className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{value}</button>)}</div>
    {tab === 'Style' && <><PresetPicker/><EditorAdjustments/><Field label="Color effect"><select value={timeline.effect} onChange={event => change({ effect: event.target.value })}>{['none', 'vivid', 'warm', 'mono', 'cinematic'].map(value => <option key={value}>{value}</option>)}</select></Field>{[['zoom', 'Motion zoom'], ['shake', 'Camera shake'], ['fade', 'Fade in and out'], ['removeSilence', 'Remove silence with synced cuts']].map(([key, label]) => <label className="toggle" key={key}><input type="checkbox" checked={Boolean(timeline[key])} onChange={event => change({ [key]: event.target.checked })}/>{label}</label>)}<Field label="Playback speed"><select value={timeline.speed} onChange={event => change({ speed: Number(event.target.value) })}>{[.5,.75,1,1.25,1.5,2].map(value => <option key={value} value={value}>{value}×</option>)}</select></Field><Field label="Scene transitions"><select value={timeline.transition} onChange={event => change({ transition: event.target.value })}><option value="none">Direct cut</option><option value="fade">Crossfade · 0.3 seconds</option></select></Field><Field label="Text overlay"><input maxLength={180} value={timeline.overlay} onChange={event => change({ overlay: event.target.value })} placeholder="Add a heading or callout"/></Field><Field label="Optional watermark"><input value={timeline.watermark} onChange={event => change({ watermark: event.target.value })} placeholder="Your creator name"/></Field></>}
    {tab === 'Canvas' && <CanvasOptions/>}
    {tab === 'Captions' && <><button className="button primary wide" disabled={!timeline.clips.some(clip => clip.sourceId) || ['running', 'queued'].includes(captionJob?.status)} onClick={generateThemedCaptions}>Generate GTA VI subtitles</button><p className="fine-print">GTA VI-inspired neon styling with the bundled Anton font. Dictation follows audible speech in the selected footage; review recognition before exporting.</p>{captionJob && <p aria-live="polite">{captionJob.stage}{captionJob.error && `: ${captionJob.error}`}</p>}{timeline.subtitles && <Field label="Automatic captions (editable SRT)"><textarea value={timeline.subtitles} onChange={event => change({ subtitles: event.target.value, captionSegments: undefined })}/></Field>}<label className="toggle"><input type="checkbox" checked={timeline.captions} onChange={event => change({ captions: event.target.checked })}/>Burn subtitles into video</label><button className="button wide" disabled={!item} onClick={() => action('/api/transcribe', { sourceId: item?.id, force: true }, 'Local speech transcription queued.')}><Subtitles size={15}/>Generate subtitles</button><div className="form-grid"><Field label="Style"><select value={timeline.captionStyle} onChange={event => change(event.target.value === 'gta6' ? gtaCaptionTheme : { captionStyle: event.target.value })}>{['classic', 'pop', 'karaoke', 'gta6'].map(value => <option key={value} value={value}>{value === 'gta6' ? 'GTA VI neon' : value}</option>)}</select></Field><Field label="Position"><select value={timeline.captionPosition} onChange={event => change({ captionPosition: event.target.value })}>{['top', 'center', 'bottom'].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Font"><select value={timeline.captionFont} onChange={event => change({ captionFont: event.target.value })}>{['Anton', 'Arial', 'Impact', 'Verdana', 'Trebuchet MS'].map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Size (output pixels)"><input type="number" min="16" max="160" value={timeline.captionSize} onChange={event => change({ captionSize: Number(event.target.value) })}/></Field></div>{timeline.captionStyle === 'gta6' && <><Field label="Subtitle animation"><select value={timeline.captionAnimation || 'word-pop'} onChange={event => change({ captionAnimation: event.target.value as 'word-pop' | 'highlight' | 'reveal' | 'none' })}><option value="word-pop">Word-by-word pop</option><option value="highlight">Highlight spoken word</option><option value="reveal">Reveal words progressively</option><option value="none">Static phrase</option></select></Field><Field label="Spoken-word highlight"><input type="color" value={timeline.captionHighlightColor || '#ffd08a'} onChange={event => change({ captionHighlightColor: event.target.value })}/></Field><p className="fine-print">Recognized speech retains real word timings. Imported or edited lines without word timings use evenly spaced estimates.</p></>}<Field label="Words per caption"><input type="number" min="1" max="8" value={timeline.captionMaxWords || 6} onChange={event => change({ captionMaxWords: Number(event.target.value) })}/></Field><label className="toggle"><input type="checkbox" checked={timeline.captionUppercase !== false} onChange={event => change({ captionUppercase: event.target.checked })}/>Uppercase neon captions</label><Field label="Caption color"><input type="color" value={timeline.captionColor} onChange={event => change({ captionColor: event.target.value })}/></Field><div className="section-title"><h3>Source transcript</h3><span>{captionDraft.length} captions</span></div><div className="transcript-editor">{captionDraft.map((caption, index) => <div className="caption-edit" key={index}><div className="row"><input aria-label="Caption start" type="number" step="0.01" value={caption.start} onChange={event => setCaptionDraft(captionDraft.map((item, i) => i === index ? { ...item, start: Number(event.target.value), words: [] } : item))}/><input aria-label="Caption end" type="number" step="0.01" value={caption.end} onChange={event => setCaptionDraft(captionDraft.map((item, i) => i === index ? { ...item, end: Number(event.target.value), words: [] } : item))}/><button className="icon-button" title="Remove caption" onClick={() => setCaptionDraft(captionDraft.filter((_, i) => i !== index))}><X size={13}/></button></div><textarea value={caption.text} onChange={event => setCaptionDraft(captionDraft.map((item, i) => i === index ? { ...item, text: event.target.value, words: [] } : item))}/></div>)}</div><div className="row spaced"><button className="button small" disabled={!item} onClick={() => setCaptionDraft([...captionDraft, { start: Math.max(0, currentTime), end: Math.min(item?.duration || 1, currentTime + 2), text: 'Your caption' }])}><Plus size={12}/>Caption</button><button className="button primary small" disabled={!item} onClick={saveTranscript}>Save transcript</button></div>{item && <div className="subtitle-downloads"><a href={`/api/transcript/${item.id}/srt`}>Download source SRT</a><a href={`/api/transcript/${item.id}/vtt`}>VTT</a><label className="link-button">Import SRT<input hidden type="file" accept=".srt" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; const text = await file.text(); const segments = text.replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => { const match = block.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]*)/); const stamp = (value: string) => value.replace(',', '.').split(':').reduce((total, n) => total * 60 + Number(n), 0); return match ? [{ start: stamp(match[1]), end: stamp(match[2]), text: match[3].trim() }] : []; }); if (!segments.length) notify('No valid SRT captions found.'); else setCaptionDraft(segments); }}/></label></div>}<p className="fine-print">Transcript times refer to the source recording. Exports retime captions after trims, speed changes, and silence removal. Review speech recognition for accuracy.</p></>}
    {tab === 'Audio' && <><VoiceControls item={item} start={scene?.start || 0} end={scene?.end || 0}/><Field label="Source volume"><input type="range" min="0" max="2" step="0.01" value={timeline.volume} onChange={event => change({ volume: Number(event.target.value) })}/></Field><label className="toggle"><input type="checkbox" checked={timeline.normalize} onChange={event => change({ normalize: event.target.checked })}/>Normalize source audio</label><Field label="Background music"><select value={timeline.musicId} onChange={event => change({ musicId: event.target.value })}><option value="">No background music</option>{media.filter(item => item.kind === 'audio').map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></Field><Field label="Music volume"><input type="range" min="0" max="1" step="0.01" value={timeline.musicVolume} onChange={event => change({ musicVolume: Number(event.target.value) })}/></Field><label className="toggle"><input type="checkbox" checked={!!timeline.musicDuck} onChange={event => change({ musicDuck: event.target.checked })}/>Lower music automatically during source speech and loud action</label><button className="button" onClick={() => action('/api/music/generate', {}, 'Generating a lo-fi loop. Select it from Background music when ready.')}>Generate lo-fi music</button><div className="info-box">Upload your licensed music or sound effect in Import Video, then select it here. Audio loops to fill the compilation.</div></>}
    {tab === 'Export' && <><CanvasOptions compact/><div className="form-grid"><Field label="Frame rate"><select value={timeline.fps} onChange={event => change({ fps: Number(event.target.value) })}><option value="0">Match source FPS</option><option value="30">30 FPS</option><option value="60">60 FPS</option></select></Field><Field label="Bitrate (Mbps)"><input type="number" min="0" max="80" disabled={!timeline.quality || timeline.quality === 'lossless'} value={timeline.bitrate} onChange={event => change({ bitrate: Number(event.target.value) })}/></Field></div><p className="fine-print">Lossless mode ignores bitrate limits and preserves the rendered frames and audio. Original source canvas and Match source FPS prevent automatic downscaling. High/Standard modes trade quality for smaller files.</p><Field label="Edited export quality"><select value={timeline.quality || 'lossless'} onChange={event => change({ quality: event.target.value as 'lossless' | 'high' | 'standard', ...(event.target.value === 'lossless' ? { encoder: 'cpu', bitrate: 0 } : {}) })}><option value="lossless">Lossless edited video and audio - largest files</option><option value="high">High quality ? larger files</option><option value="standard">Standard quality ? smaller files</option></select></Field><Field label="Encoder"><select value={timeline.encoder} disabled={!timeline.quality || timeline.quality === 'lossless'} onChange={event => change({ encoder: event.target.value })}><option value="cpu">CPU · H.264</option><option value="nvenc">NVIDIA NVENC · requires supported GPU</option></select></Field><div className="info-box">Lossless: H.264 CRF 0 video, AAC default playback audio, and a preserved FLAC lossless audio track in MP4. High/Standard: H.264 + AAC for wider player support. Finished exports include SRT and VTT downloads.</div><button className="button primary wide" disabled={!timeline.clips.length || deliveryBusy} onClick={() => prepareDownload('edited')}>Render timeline <ArrowDownToLine size={15}/></button>{timeline.clips.length === 1 && timeline.clips[0].sourceId && <><p className="fine-print">For unchanged source quality, copy this range at its native resolution and frame rate. Effects, canvas changes, and burned-in captions are excluded. The start aligns to the preceding keyframe.</p><button className="button wide" disabled={deliveryBusy} onClick={() => prepareDownload('original')}>Download original-quality clip</button></>}</>}
  </section></div></>;
}
function Compilations({ highlights, chosen, setChosen, timeline, action }: any) {
  const [title, setTitle] = useState('My best gaming moments');
  const [target, setTarget] = useState(20);
  const [category, setCategory] = useState('All');
  const available = (highlights as Highlight[]).filter(item => category === 'All' || item.category === category);
  const selected = (highlights as Highlight[]).filter(item => chosen.includes(item.id));
  const duration = selected.reduce((sum, item) => sum + item.end - item.start, 0);
  return <div className="automation-grid"><section className="panel"><div className="panel-heading"><Layers3 size={19}/><h2>Build your compilation</h2></div><Field label="Video title"><input value={title} onChange={event => setTitle(event.target.value)}/></Field><div className="form-grid"><Field label="Target duration"><select value={target} onChange={event => setTarget(Number(event.target.value))}>{[20,25,30].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></Field><Field label="Category"><select value={category} onChange={event => setCategory(event.target.value)}>{['All', ...new Set((highlights as Highlight[]).map(item => item.category))].map(value => <option key={value}>{value}</option>)}</select></Field></div><div className="row spaced"><span className="muted">{chosen.length} selected · {time(duration)} footage</span><button className="link-button" onClick={() => setChosen(available.map(item => item.id))}>Select matching</button></div><div className="compilation-list">{available.map(item => <div className="compilation-item" key={item.id}><input type="checkbox" checked={chosen.includes(item.id)} onChange={() => setChosen(chosen.includes(item.id) ? chosen.filter(id => id !== item.id) : [...chosen, item.id])}/><img src={`/thumb/${item.id}`} alt=""/><span><strong>{item.title}</strong><small>{item.category} · {time(item.end - item.start)}</small></span><b>{item.score}</b><video className="compilation-range-preview" controls preload="none" src={`/media/${item.sourceId}#t=${item.start},${item.end}`} poster={`/thumb/${item.id}`} onLoadedMetadata={event => { event.currentTarget.currentTime = item.start; }} onPlay={event => { if (event.currentTarget.currentTime < item.start || event.currentTarget.currentTime >= item.end) event.currentTarget.currentTime = item.start; }} onTimeUpdate={event => { if (event.currentTarget.currentTime >= item.end) event.currentTarget.pause(); }}/></div>)}</div>{!available.length && <Empty icon={Layers3} title="Analyze a recording first" text="Detected highlights can be combined here."/>}<div className="info-box">Clips are arranged by recording and source time. Duplicate or overlapping ranges are skipped. The export uses available footage up to your target duration.</div></section><section className="panel"><div className="panel-heading"><Film size={19}/><h2>Compilation style</h2></div><PresetPicker/><CanvasOptions compact/><Field label="Transitions"><select value={timeline.transition} onChange={event => useEditor.getState().change({ transition: event.target.value })}><option value="none">Direct cuts</option><option value="fade">Smooth crossfades</option></select></Field><button className="button primary wide big" disabled={!chosen.length} onClick={() => action('/api/compilation', { highlights: chosen, targetMinutes: target, title, options: timeline }, 'Compilation queued. Available highlights will be combined into one MP4.')}><Layers3 size={17}/> Create compilation</button></section></div>;
}
function ProjectList({ projects, onOpen }: { projects: Project[]; onOpen: (project: Project) => void }) {
  return projects.length ? <div className="project-list">{projects.map(project => <div key={project.id}><button className="project-row" onClick={() => onOpen(project)}><div className="project-icon"><Clapperboard size={22}/></div><span><strong>{project.title}</strong><small>{project.timeline.clips.length} scenes · {project.timeline.ratio} · Saved {new Date(project.updatedAt).toLocaleString()}</small></span><ChevronRight size={18}/></button><DeleteProject id={project.id} title={project.title}/></div>)}</div> : <Empty icon={FolderOpen} title="Make room for your next story" text="Save an editing timeline to keep your clips, style, captions, and audio settings together."/>;
}
function Queue({ jobs, action }: { jobs: Job[]; action: any }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? jobs.slice(0, 30) : jobs.filter(job => ['running', 'queued', 'error'].includes(job.status)).slice(0, 5);
  return <section className="panel queue"><div className="section-title"><h2><Activity size={17}/>Processing queue</h2><button className="link-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show active' : 'Show recent jobs'}</button></div>{!visible.length && <p className="muted">All processing jobs are complete.</p>}{visible.map(job => <div className="job" key={job.id}><div className="job-icon">{job.status === 'running' ? <LoaderCircle className="spin" size={18}/> : job.status === 'done' ? <Check size={18}/> : <Clock3 size={18}/>}</div><div className="job-body"><div className="job-top"><strong>{job.label}</strong><span>{job.status === 'running' ? `${Math.round(job.progress)}%` : job.status}</span></div><small>{job.outputWarning || job.stage}</small>{job.status === 'running' && <progress max={100} value={job.progress}/>}<details><summary>Details</summary><pre>{job.error || job.log || job.stage}</pre></details></div>{['running', 'queued'].includes(job.status) && <button className="icon-button" aria-label="Cancel job" onClick={() => action(`/api/cancel/${job.id}`, {}, 'Cancellation requested.')}><X size={16}/></button>}{['error', 'cancelled'].includes(job.status) && <button className="button small" onClick={() => action(`/api/retry/${job.id}`, {}, 'Job queued for retry.')}>Retry</button>}</div>)}</section>;
}
function Settings({ health, stats }: any) {
  return <div className="automation-grid"><OutputSettings/><SemanticSettings/><SpeechSettings/><YouTubeAccount/><section className="panel"><div className="panel-heading"><Gauge size={19}/><h2>Engine status</h2></div>{['ffmpeg', 'ffprobe', 'yt-dlp', 'python'].map(tool => <div className="setting-row" key={tool}><span>{tool === 'python' ? 'Local AI · Faster-Whisper / OpenCV' : tool}</span><span className={health?.[tool] ? 'ready' : 'muted'}>{health?.[tool] ? 'Ready' : 'Unavailable'}</span></div>)}<div className="setting-row"><span>Media storage</span><span>{bytes(stats?.storage)}</span></div><div className="setting-row"><span>Available disk space</span><span>{stats?.free ? bytes(stats.free) : 'Unavailable'}</span></div><div className="info-box">Models are cached locally. CPU processing is available. Choose NVIDIA NVENC in the editor if your hardware supports it.</div><h3>Cached speech models</h3>{health?.models?.length ? health.models.map(name => <p className="muted" key={name}>{name.replace('models--Systran--faster-whisper-', '')}</p>) : <p className="muted">Downloaded on first transcription.</p>}</section><section className="panel"><div className="panel-heading"><Sparkles size={19}/><h2>Analysis capabilities</h2></div><p className="muted">All analysis modes measure visual motion, scene changes, and audio energy. Available transcripts add speech activity to ranking. Loudness contributes only when visual or speech signals are present.</p><div className="setting-row"><span>Fast</span><span>1 visual sample / 2 seconds</span></div><div className="setting-row"><span>Balanced</span><span>1 visual sample / second</span></div><div className="setting-row"><span>Detailed</span><span>2 visual samples / second</span></div><div className="info-box">Game-specific kills, chases, mission events, semantic scene understanding, need additional trained models. Face/speaker/body framing is available in the editor; it uses a bundled face detector and motion cues. Current scores describe audiovisual activity and require review.</div><p className="fine-print">Projects, imports, job history, and analysis are stored on this computer. Interrupted jobs can be retried. Active processing starts again from saved transcription and completed analysis where available.</p></section></div>;
}
const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={client}><App/></QueryClientProvider></React.StrictMode>);
