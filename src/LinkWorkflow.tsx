import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, LoaderCircle, WandSparkles } from 'lucide-react';
import type { Job, Media } from './types';
import MomentReview, { type EditRange, type ReviewOptions } from './MomentReview';
import SourcePlayer from './SourcePlayer';
import { gtaCaptionTheme } from './captionTheme';

type Detection = { title: string; live: boolean; upcoming: boolean; duration: number | null; platform: string; videoId?: string };
type Props = { action: (route: string, body: unknown, success?: string) => Promise<any>; onEdit: EditRange; onExports: () => void; existingSource?: Media };
function readPreferences(): Record<string, any> {
  try { return JSON.parse(localStorage.getItem('clipforge-workflow-preferences') || '{}'); }
  catch { return {}; }
}
export default function LinkWorkflow({ action, onEdit, onExports, existingSource }: Props) {
  const [saved] = useState(readPreferences);
  const [url, setUrl] = useState('');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [rights, setRights] = useState(false);
  const [duration, setDuration] = useState(saved.duration ?? 1800);
  const [clipDuration, setClipDuration] = useState(saved.clipDuration ?? 60);
  const [start, setStart] = useState(saved.start ?? 0);
  const [outputKind, setOutputKind] = useState(saved.outputKind ?? 'short');
  const [shortRatio, setShortRatio] = useState(saved.shortRatio ?? '9:16');
  const [targetMinutes, setTargetMinutes] = useState(saved.targetMinutes ?? 20);
  const [exportResolution, setExportResolution] = useState(saved.exportResolution ?? 1080);
  const [preset, setPreset] = useState(saved.preset ?? 'viral');
  const [subtitleStyle, setSubtitleStyle] = useState(saved.subtitleStyle ?? 'gta6');
  const [transcribe, setTranscribe] = useState(saved.transcribe ?? true);
  const [inputMode, setInputMode] = useState(saved.inputMode ?? 'full');
  const [detectionMode, setDetectionMode] = useState(saved.detectionMode ?? 'auto');
  const [submitting, setSubmitting] = useState(false);
  const [manualReady, setManualReady] = useState(false);
  const storageKey = existingSource ? `clipforge-analysis-job:${existingSource.id}` : 'clipforge-link-job';
  const [jobId, setJobId] = useState(() => localStorage.getItem(storageKey) || '');
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ['jobs'], queryFn: async () => (await fetch('/api/jobs')).json(), refetchInterval: 2000 });
  const { data: media = [] } = useQuery<Media[]>({ queryKey: ['media'], queryFn: async () => (await fetch('/api/library')).json(), refetchInterval: jobId ? 3000 : false });
  const job = jobs.find(item => item.id === jobId) as (Job & { sourceId?: string; phase?: string; payload?: { sourceId?: string; url?: string } }) | undefined;
  const source = existingSource || media.find(item => item.id === (job?.result?.sourceId || job?.sourceId));
  const ratio = outputKind === 'short' ? shortRatio : '16:9';
  const options: ReviewOptions = { ...(subtitleStyle === 'gta6' ? gtaCaptionTheme : { captionStyle: subtitleStyle }), ratio, preset, resolution: exportResolution, transcribe, captions: transcribe, outputKind, targetMinutes };
  const ready = manualReady || job?.status === 'done';
  const highlights = detectionMode === 'manual' ? [] : job?.result?.highlights || source?.analysis?.highlights || [];
  useEffect(() => {
    localStorage.setItem('clipforge-workflow-preferences', JSON.stringify({ subtitleStyle, exportResolution, duration, clipDuration, start, outputKind, shortRatio, targetMinutes, preset, transcribe, inputMode, detectionMode }));
  }, [subtitleStyle, exportResolution, duration, clipDuration, start, outputKind, shortRatio, targetMinutes, preset, transcribe, inputMode, detectionMode]);
  useEffect(() => {
    setJobId(localStorage.getItem(storageKey) || '');
    setManualReady(false);
  }, [storageKey]);
  useEffect(() => {
    setDetection(null); setDetectError(''); setDetecting(false);
    if (existingSource || !url.trim()) return;
    try { const parsed = new URL(url.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) return; } catch { return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setDetecting(true);
      try {
        const response = await fetch('/api/inspect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }), signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Detection failed');
        setDetection(result);
      } catch (error) { if (!controller.signal.aborted) setDetectError((error as Error).message); }
      finally { if (!controller.signal.aborted) setDetecting(false); }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [url, existingSource?.id]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!existingSource && !rights) { setDetectError('Confirm your permission to use this video below.'); return; }
    if (existingSource && detectionMode === 'manual') { setManualReady(true); return; }
    setSubmitting(true);
    try {
      const payload = { url: url.trim(), sourceId: existingSource?.id, inputMode, start, duration,
        clipDuration: outputKind === 'short' ? clipDuration : 120, maxClips: 200, detectionMode,
        ratio, preset, resolution: exportResolution, transcribe, rightsConfirmed: true, reviewFirst: true };
      const result = await action(existingSource ? '/api/analyze' : '/api/process-link', payload,
        'Import and moment detection started. Every candidate will be available for preview and timestamp review before export.');
      if (result?.id) { setJobId(result.id); localStorage.setItem(storageKey, result.id); setManualReady(false); }
    } finally { setSubmitting(false); }
  }
  return <section className="panel link-workflow">
    <div className="panel-heading"><WandSparkles size={20}/><h2>Find moments, preview, then choose your clips</h2></div>
    <form onSubmit={submit}>
      {existingSource ? <div className="link-detected"><Check size={17}/><div><strong>{existingSource.title}</strong><small>Imported recording · {Math.round(existingSource.duration / 60)} minutes</small></div></div> : <label className="field"><span>YouTube, live stream, or supported video link</span><input type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste your video or live link here"/></label>}
      {detecting && <p className="detection"><LoaderCircle size={14} className="spin"/>Detecting video or live stream…</p>}
      {detection && <div className="link-detected"><Check size={17}/><div><strong>{detection.title}</strong><small>{detection.platform} · {detection.upcoming ? 'Scheduled stream' : detection.live ? 'LIVE · records from now' : `Video${detection.duration ? ` · ${Math.round(detection.duration / 60)} minutes` : ''}`}</small></div></div>}
      {detectError && <div className="link-error" role="alert">{detectError}</div>}
      {!existingSource && url.trim() && <SourcePlayer key={url.trim()} url={url.trim()} detection={detection} rights={rights}
        ratio={ratio} preset={preset} clipDuration={clipDuration} targetMinutes={targetMinutes} outputKind={outputKind}
        transcribe={transcribe} job={job} action={action} onJob={next => { setJobId(next.id); if ((next as any).payload?.autoAnalyze) setDetectionMode('auto'); localStorage.setItem(storageKey, next.id); setManualReady(false); }}/>} 
      <div className="form-grid"><label className="field"><span>How to find moments</span><select value={detectionMode} onChange={event => { setDetectionMode(event.target.value); setManualReady(false); }}><option value="auto">Detect prominent audiovisual peaks</option><option value="manual">Set timestamps manually</option></select></label><label className="field"><span>Video format</span><select value={outputKind === 'long' ? 'long' : shortRatio} onChange={event => {
          if (event.target.value === 'long') setOutputKind('long');
          else { setOutputKind('short'); setShortRatio(event.target.value); }
        }}><option value="9:16">9:16 - Shorts</option><option value="3:4">3:4 - Shorts</option><option value="long">16:9 - Long form - 20 to 30 minutes</option></select></label>
        {outputKind === 'short' ? <label className="field"><span>Maximum short-clip length</span><select value={clipDuration} onChange={event => setClipDuration(Number(event.target.value))}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="90">1 minute 30 seconds</option><option value="120">2 minutes</option></select></label> : <label className="field"><span>Long-form target duration</span><select value={targetMinutes} onChange={event => setTargetMinutes(Number(event.target.value))}>{[20,25,30].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label>}
        <label className="field"><span>Edited export resolution</span><select value={exportResolution} onChange={event => setExportResolution(Number(event.target.value))}>{[720,1080,1440,2160].map(value => <option key={value} value={value}>{value === 2160 ? '2160p / 4K' : `${value}p`}</option>)}</select></label>
        <label className="field"><span>Editing style for selected moments</span><select value={preset} onChange={event => setPreset(event.target.value)}><option value="viral">Viral Gaming</option><option value="cinematic">Cinematic</option><option value="funny">Funny Moments</option><option value="action">Action Highlights</option><option value="clean">Clean Gameplay</option></select></label>
      </div>
      {!existingSource && <><div className="form-grid">{!detection?.live && <label className="field"><span>Footage to inspect</span><select value={inputMode} onChange={event => setInputMode(event.target.value)}><option value="full">Entire video</option><option value="range">A time section</option></select></label>}{!detection?.live && inputMode === 'range' && <label className="field"><span>Source start (seconds)</span><input type="number" min="0" value={start} onChange={event => setStart(Number(event.target.value))}/></label>}{(detection?.live || inputMode === 'range' || !detection) && <label className="field"><span>{detection?.live ? 'Record the live stream for (minutes)' : 'Section / live recording duration (minutes)'}</span><input type="number" min="1" max="360" value={duration / 60} onChange={event => setDuration(Number(event.target.value) * 60)}/></label>}</div><label className="rights spaced"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} required/><span>I own this media or have permission to record, edit, and reuse it.</span></label></>}
      <label className="field"><span>Subtitle theme</span><select value={subtitleStyle} onChange={event => setSubtitleStyle(event.target.value)}><option value="gta6">GTA VI neon - word-by-word</option><option value="pop">Pop captions</option><option value="karaoke">Karaoke highlight</option><option value="classic">Classic subtitles</option></select></label><label className="toggle"><input type="checkbox" checked={transcribe} onChange={event => setTranscribe(event.target.checked)}/>Transcribe speech for ranking and subtitles</label>
      <button className="button primary wide big" disabled={submitting || detection?.upcoming || ['running', 'queued'].includes(job?.status || '')}>{submitting ? <LoaderCircle className="spin" size={17}/> : <WandSparkles size={17}/>} {detectionMode === 'manual' ? 'Open timestamp review' : 'Detect moments for preview'}</button>
      <p className="fine-print">Peak detection returns qualifying events with context. The selected short duration is a maximum; actual ranges follow the event. Long-form selections are combined up to your target using available footage.</p>
      {ready && <p className="fine-print">Run detection again after changing the duration cap. Adjust individual reviewed ranges directly below.</p>}
    </form>
    {job && <div className="link-progress"><div className="section-title"><h3>{job.status === 'done' ? 'Ready to review' : job.status === 'error' ? 'Processing needs attention' : job.stage}</h3><span>{job.status}</span></div>{['running', 'queued'].includes(job.status) && <progress value={job.progress} max={100}/>}<p>{job.stage}</p>{job.error && <div className="link-error">{job.error}</div>}<div className="row spaced">{['running', 'queued'].includes(job.status) && <button className="button small" onClick={() => action(`/api/cancel/${job.id}`, {}, 'Cancellation requested.')}>Cancel</button>}{['error', 'cancelled'].includes(job.status) && <button className="button small" onClick={async () => { const retried = await action(`/api/retry/${job.id}`, {}, 'Retry started.'); if (retried) { setJobId(retried.id); localStorage.setItem(storageKey, retried.id); } }}>Retry</button>}</div></div>}
    {ready && source && <button className="button wide" onClick={async () => {
      const next = await action('/api/analyze', { sourceId: source.id, clipDuration: outputKind === 'short' ? clipDuration : 120, maxClips: 200, transcribe, mode: 'balanced' }, 'Analyzing the imported recording for prominent moments.');
      if (next?.id) { setJobId(next.id); if ((next as any).payload?.autoAnalyze) setDetectionMode('auto'); localStorage.setItem(storageKey, next.id); setManualReady(false); }
    }}>Re-analyze this imported recording</button>}
    {ready && source && <MomentReview key={`${source.id}:${manualReady ? 'manual' : jobId}`} source={source} highlights={highlights} manualRanges={job?.result?.manualRanges || []}
      reviewId={`${source.id}:${manualReady ? 'manual' : jobId}`} options={options} action={action} onEdit={onEdit} onExports={onExports}/>}
  </section>;
}
