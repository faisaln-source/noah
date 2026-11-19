import FileSize from './FileSize';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useEditor } from './store';
import FileActions from './FileActions';

export default function EditorModes({ action, sceneIndex, onApplied }: { action: any; sceneIndex: number; onApplied: (index: number) => void }) {
  const { timeline, change } = useEditor();
  const applyHandler = useRef(onApplied); applyHandler.current = onApplied;
  const [mode, setMode] = useState('manual');
  const [scope, setScope] = useState('timeline');
  const [previewHost, setPreviewHost] = useState<HTMLElement | null>(null);
  useEffect(() => setPreviewHost(document.getElementById('editor-rendered-preview')), []);
  const [autoId, setAutoId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [refresh, setRefresh] = useState(false);
  const [pending, setPending] = useState<any>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const session = useRef(crypto.randomUUID());
  const submitted = useRef('');
  const applied = useRef('');
  const activePreview = useRef('');
  const actionRef = useRef(action); actionRef.current = action;
  const version = useRef(0);
  const { data: jobs = [] } = useQuery<any[]>({ queryKey: ['jobs'], queryFn: async () => (await fetch('/api/jobs')).json(), refetchInterval: autoId || previewId ? 1000 : false });
  const automatic = jobs.find(job => job.id === autoId);
  const preview = jobs.find(job => job.id === previewId);
  const signature = JSON.stringify(timeline);
  const busy = ['running', 'queued'].includes(automatic?.status);
  useEffect(() => {
    if (automatic?.status !== 'done' || applied.current === automatic.id) return;
    applied.current = automatic.id;
    if (JSON.stringify(useEditor.getState().timeline) === submitted.current) { change(automatic.result.timeline); applyHandler.current(automatic.result.firstFootageIndex ?? 0); setScope('timeline'); renderPreview(true); }
    else setPending(automatic.result.timeline);
    setNotes(automatic.result.notes || []);
  }, [automatic?.status, automatic?.id, change]);
  async function runAutomatic() {
    setError(''); setPending(null); if (activePreview.current) await fetch(`/api/cancel/${activePreview.current}`, { method: 'POST' }); submitted.current = JSON.stringify(useEditor.getState().timeline);
    try {
      const job = await actionRef.current('/api/editor/auto', JSON.parse(submitted.current), 'Automatic editing started for the selected footage.');
      if (job?.id) setAutoId(job.id);
    } catch (error) { setError((error as Error).message); }
  }
  async function renderPreview(forceTimeline = false) {
    const generation = ++version.current;
    setError('');
    try {
      if (activePreview.current) await fetch(`/api/cancel/${activePreview.current}`, { method: 'POST' });
      const response = await fetch('/api/editor/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...useEditor.getState().timeline, previewSession: session.current, previewSceneIndex: !forceTimeline && scope === 'scene' ? sceneIndex : undefined }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (generation !== version.current) { await fetch(`/api/cancel/${result.id}`, { method: 'POST' }); return; }
      activePreview.current = result.id; setPreviewId(result.id);
    } catch (error) { setError((error as Error).message); }
  }
  useEffect(() => {
    if (!refresh || !timeline.clips.length) return;
    const timeout = setTimeout(() => renderPreview(), 1800);
    return () => clearTimeout(timeout);
  }, [refresh, signature, scope, sceneIndex]);
  useEffect(() => () => { version.current++; if (activePreview.current) fetch(`/api/cancel/${activePreview.current}`, { method: 'POST', keepalive: true }).catch(() => {}); }, []);
  return <section className="panel editor-mode-panel">
    <div className="section-title"><h2>Editing mode</h2><div className="row"><button className={`button ${mode === 'auto' ? 'primary' : ''}`} aria-pressed={mode === 'auto'} onClick={() => setMode('auto')}>AI automatic edit</button><button className={`button ${mode === 'manual' ? 'primary' : ''}`} aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>Manual edit</button></div></div>
    {mode === 'auto' ? <><p>Keep the complete footage and apply the options you choose. An intro card is optional; it never replaces your video. Preview and download show the full timeline by default.</p><div className="form-grid"><label className="field"><span>AI color direction</span><select value={timeline.aiColor || 'preset'} onChange={event => change({ aiColor: event.target.value })}><option value="preset">Selected preset</option><option value="vibrant">Vibrant gameplay</option><option value="cinematic">Cinematic contrast</option></select></label><label className="field"><span>AI motion</span><select value={timeline.aiMotion || 'preset'} onChange={event => change({ aiMotion: event.target.value })}><option value="preset">Selected preset</option><option value="gentle">Gentle - no shake or zoom</option><option value="punchy">Punchy - zoom and shake</option></select></label><label className="field"><span>AI playback pace</span><select value={timeline.aiPace ?? timeline.speed} onChange={event => change({ aiPace: Number(event.target.value) })}>{[.5,.75,1,1.25,1.5,2].map(value => <option value={value} key={value}>{value}x</option>)}</select></label></div>{[['aiIntro', 'Add a two-second intro card', false], ['aiHeading', 'Add a heading overlay', true], ['aiCaptions', 'Generate speech captions', true], ['aiNormalize', 'Normalize speech audio', true], ['aiRemoveSilence', 'Remove silent sections', false]].map(([key, label, fallback]) => <label className="toggle" key={String(key)}><input type="checkbox" checked={timeline[String(key)] ?? fallback} onChange={event => change({ [String(key)]: event.target.checked })}/>{label}</label>)}<button className="button primary" disabled={busy || !timeline.clips.some(clip => clip.sourceId)} onClick={runAutomatic}>Apply AI automatic edit</button>{automatic && <p aria-live="polite">{automatic.stage}{automatic.error && `: ${automatic.error}`}</p>}{notes.map(note => <p className="fine-print" key={note}>{note}</p>)}{pending && <button className="button" onClick={() => { change(pending); applyHandler.current(pending.clips.findIndex((clip: any) => clip.type !== 'title')); setScope('timeline'); renderPreview(true); setPending(null); }}>Apply generated edit to current timeline</button>}</> : <p className="fine-print">Change the controls below to see visual edits immediately, including when paused. Live color and motion are approximations; the rendered preview uses the export pipeline.</p>}
    <label className="field"><span>Rendered preview scope</span><select value={scope} onChange={event => setScope(event.target.value)}><option value="scene">Selected scene</option><option value="timeline">Complete timeline (all scenes and transitions)</option></select></label><div className="row spaced"><button className="button" disabled={!timeline.clips.length} onClick={() => renderPreview()}>Render exact preview</button><label className="toggle"><input type="checkbox" checked={refresh} onChange={event => setRefresh(event.target.checked)}/>Auto-refresh rendered preview</label></div>
    <p className="fine-print">Rendered previews keep the complete timeline, selected resolution and source frame rate, with lossless edited video and audio. Full-quality rendering can take longer. Download below saves exactly this full-quality file; the live canvas updates immediately while you wait.</p>
    {error && <p className="validation-error" role="alert">{error}</p>}
    {preview && previewHost && createPortal(<div className="exact-preview"><p aria-live="polite">{preview.status === 'done' ? 'Rendered preview ready' : preview.stage}{preview.error && `: ${preview.error}`}</p>{preview.status === 'done' && <video key={preview.id} controls autoPlay muted playsInline preload="metadata" src={`/media/${preview.result.id}`}/>} {preview.status === 'done' && <><p>{preview.result.width} x {preview.result.height} ? {preview.result.fps?.toFixed(2)} FPS ? {preview.result.duration.toFixed(1)} seconds</p><p><FileSize size={preview.result.size}/></p><a className="button primary" href={`/media/${preview.result.id}?download=1`}>Download full-quality preview MP4</a><FileActions item={preview.result}/></>}</div>, previewHost)}
  </section>;
}
