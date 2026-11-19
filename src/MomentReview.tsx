import FileSize from './FileSize';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Check, Film, Play, Plus, Scissors, Trash2 } from 'lucide-react';
import type { Highlight, Job, Media, Options } from './types';

export type ReviewOptions = Partial<Options> & { outputKind?: string; targetMinutes?: number; transcribe?: boolean };
export type EditRange = (source: Media, start?: number, end?: number, options?: Partial<Options>) => void;
type Range = { id: string; start: number; end: number; title: string; reason?: string; score?: number; eventTime?: number; origin: 'detected' | 'manual' };
type ManualRange = { id: string; start: number; end: number; title: string };
type Props = { source: Media; highlights: Highlight[]; manualRanges?: ManualRange[]; options: ReviewOptions; reviewId: string; action: any; onEdit: EditRange; onExports: () => void };
export function timestamp(value: number) {
  const milliseconds = Math.round(Math.max(0, value) * 1000);
  const seconds = Math.floor(milliseconds / 1000);
  const base = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  return milliseconds % 1000 ? `${base}.${String(milliseconds % 1000).padStart(3, '0')}` : base;
}
export function parseTimestamp(value: string) {
  const parts = value.trim().split(':');
  if (parts.length > 3 || parts.some(part => !/^\d+(\.\d+)?$/.test(part))) throw new Error('Enter seconds or HH:MM:SS.');
  return parts.reduce((total, value) => total * 60 + Number(value), 0);
}
function TimeInput({ value, onCommit, onValidation, label }: { value: number; onCommit: (value: number) => boolean; onValidation: (error: string) => void; label: string }) {
  const [draft, setDraft] = useState(timestamp(value));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(timestamp(value)); }, [value]);
  return <label className="field"><span>{label}</span><input value={draft} aria-invalid={!!error} onChange={event => { setDraft(event.target.value); setError(''); }} onBlur={() => { try { if (!onCommit(parseTimestamp(draft))) throw new Error('Keep start before end and inside the imported recording.'); setError(''); onValidation(''); } catch (error) { setError((error as Error).message); onValidation((error as Error).message); } }}/>{error && <small className="validation-error">{error}</small>}</label>;
}
function RangePreview({ source, range, ratio, onViewed }: { source: Media; range: Range; ratio?: string; onViewed: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let frame = 0;
    const player = video.current;
    const check = () => {
      if (player && !player.paused && player.currentTime >= range.end) { player.pause(); player.currentTime = range.end; }
      if (player && !player.paused) frame = requestAnimationFrame(check);
    };
    const start = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(check); };
    player?.addEventListener('play', start);
    return () => { cancelAnimationFrame(frame); player?.removeEventListener('play', start); };
  }, [source.proxy, source.id, range.start, range.end]);
  return <div className={`moment-player ${['9:16', '3:4'].includes(ratio || '') ? 'portrait' : ''}`}>
    <video ref={video} style={{ aspectRatio: (ratio || '16:9').replace(':', ' / ') }} key={`${source.proxy || source.id}:${range.start}:${range.end}`} controls preload="none" playsInline
      poster={`/thumb/${range.origin === 'detected' ? range.id : source.id}`} src={`/media/${source.id}${source.proxy && source.proxyQuality === 'full-lossless' ? '?proxy=1' : ''}#t=${range.start},${range.end}`}
      onLoadedMetadata={event => { event.currentTarget.currentTime = range.start; }}
      onPlay={event => { if (event.currentTarget.currentTime < range.start || event.currentTarget.currentTime >= range.end - .05) event.currentTarget.currentTime = range.start; onViewed(); }}
      onSeeking={event => { if (event.currentTarget.currentTime < range.start) event.currentTarget.currentTime = range.start; if (event.currentTarget.currentTime > range.end) event.currentTarget.currentTime = range.end; }}
      onError={() => setError(true)}/>
    {error && <p className="validation-error">This codec needs a browser preview. Use Create browser preview below.</p>}
  </div>;
}
export default function MomentReview({ source, highlights, manualRanges = [], options, reviewId, action, onEdit, onExports }: Props) {
  const storageKey = `clipforge-review:v2:${reviewId}`;
  const initial = useRef<{ ranges: Range[]; selected: string[]; exportJobId?: string } | null>(null);
  if (!initial.current) {
    try { initial.current = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* Use fresh detected candidates. */ }
    if (!initial.current || !Array.isArray(initial.current.ranges)) initial.current = { ranges: [
      ...highlights.filter(item => typeof item.prominence === 'number').map(item => ({ ...item, origin: 'detected' as const })),
      ...manualRanges.map(item => ({ ...item, origin: 'manual' as const }))
    ], selected: [] };
  }
  const [ranges, setRanges] = useState<Range[]>(initial.current.ranges);
  const [manualOpen, setManualOpen] = useState(initial.current.ranges.length === 0);
  const [selected, setSelected] = useState<string[]>(initial.current.selected || []);
  const [viewed, setViewed] = useState<string[]>([]);
  const [sort, setSort] = useState('time');
  const [dualFormat, setDualFormat] = useState(false);
  const {data:ratings = [], refetch:refreshRatings} = useQuery<any[]>({queryKey:['ratings'],queryFn:async()=>(await fetch('/api/ratings')).json()});
  const [error, setError] = useState('');
  const [manualStart, setManualStart] = useState(timestamp(source.sourceStart || 0));
  const [manualEnd, setManualEnd] = useState(timestamp((source.sourceStart || 0) + Math.min(source.duration, options.outputKind === 'long' ? (options.targetMinutes || 20) * 60 : 30)));
  const [exportJobId, setExportJobId] = useState(initial.current.exportJobId || '');
  const [currentTime, setCurrentTime] = useState(0);
  const sourcePlayer = useRef<HTMLVideoElement>(null);
  const { data: jobs = [] } = useQuery<Job[]>({ queryKey: ['jobs'], queryFn: async () => (await fetch('/api/jobs')).json(), refetchInterval: exportJobId ? 2000 : false });
  const exportJob = jobs.find(item => item.id === exportJobId);
  const exported: Media[] = exportJob?.result?.exports || [];
  const offset = source.sourceStart || 0;
  const selectedRanges = ranges.filter(range => selected.includes(range.id));
  const duration = selectedRanges.reduce((total, range) => total + range.end - range.start, 0);
  const invalidShort = ['9:16', '3:4'].includes(options.ratio || '') && selectedRanges.some(range => range.end - range.start > 120.01);
  const sorted = [...ranges].sort((a, b) => sort === 'score' ? (b.score || 0) - (a.score || 0) : sort === 'duration' ? (b.end - b.start) - (a.end - a.start) : a.start - b.start);
  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify({ ranges, selected, exportJobId })); }, [ranges, selected, exportJobId, storageKey]);
  function updateRange(id: string, changes: Partial<Range>) {
    const updated = ranges.map(range => range.id === id ? { ...range, ...changes } : range);
    const item = updated.find(range => range.id === id)!;
    if (item.start < 0 || item.end > source.duration + .05 || item.end <= item.start) { setError('Keep start before end and inside the imported recording.'); return false; }
    setRanges(updated); setError(''); return true;
  }
  function addManual(event: React.FormEvent) {
    event.preventDefault();
    try {
      const start = parseTimestamp(manualStart) - offset;
      const end = parseTimestamp(manualEnd) - offset;
      if (start < 0 || end > source.duration + .05 || end <= start) throw new Error('Enter a start and end inside the imported recording.');
      if (['9:16', '3:4'].includes(options.ratio || '') && end - start > 120.01) throw new Error('Short clips can be at most two minutes. Choose long form for longer ranges.');
      const range: Range = { id: crypto.randomUUID(), start, end, title: `Manual moment ${timestamp(start + offset)}`, origin: 'manual' };
      setRanges([...ranges, range]); setError('');
    } catch (error) { setError((error as Error).message); }
  }
  async function exportOriginalSelected() {
    const job = await action('/api/review/original', { sourceId: source.id, ranges: selectedRanges }, 'Original video and audio are being copied without re-encoding.');
    if (job) setExportJobId(job.id);
  }
  async function exportSelected() {
    const job = await action('/api/review/export', { sourceId: source.id, ranges: selectedRanges,
      options: { ...options, captions: options.transcribe !== false }, outputKind: options.outputKind || 'short', targetMinutes: options.targetMinutes || 20,
      transcribe: options.transcribe !== false, dualFormat }, 'Only your selected timestamp ranges are queued for editing and MP4 export.');
    if (job) setExportJobId(job.id);
  }
  const activity = source.analysis?.activity || [];
  const points = activity.map(point => `${point.time / Math.max(1, source.duration) * 1000},${100 - point.score}`).join(' ');
  return <section className="moment-review">
    <div className="section-title"><h2>Review every moment</h2><span>{ranges.length} candidates · {viewed.length} previewed</span></div>
    <p className="fine-print">Detected ranges follow prominent audiovisual peaks with context before and after. Preview any candidate, adjust its times, or add your own range. Select the moments you want to edit or export.</p>
    {highlights.some(item => typeof item.prominence !== 'number') && <div className="info-box">This recording has older activity rankings. Run detection again to generate candidates with measured peak prominence, or add manual ranges below.</div>}
    {activity.length > 0 && <div className="activity-chart"><svg viewBox="0 0 1000 110" role="img" aria-label="Measured audiovisual activity across the recording" preserveAspectRatio="none"><line x1="0" x2="1000" y1={100 - (source.analysis?.threshold || 20)} y2={100 - (source.analysis?.threshold || 20)} stroke="#8b5caa" strokeDasharray="5 5"/><polyline points={points} fill="none" stroke="#b58aee" strokeWidth="2"/>{ranges.filter(range => range.origin === 'detected').map(range => <circle key={range.id} cx={(range.eventTime ?? range.start) / Math.max(1, source.duration) * 1000} cy="103" r="4" fill="#6ad6d2"/>)}</svg><div><span>{timestamp(offset)}</span><span>Measured activity and detection threshold</span><span>{timestamp(offset + source.duration)}</span></div></div>}
    <details className="manual-range-panel" open={manualOpen} onToggle={event => setManualOpen(event.currentTarget.open)}><summary>Add timestamps manually</summary><div className="manual-source-preview"><video ref={sourcePlayer} src={`/media/${source.id}${source.proxy && source.proxyQuality === 'full-lossless' ? '?proxy=1' : ''}`} preload="none" controls poster={`/thumb/${source.id}`} onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)}/><div><h3>{source.title}</h3><p>{timestamp(offset)} – {timestamp(offset + source.duration)}</p><div className="row"><button className="button small" onClick={() => setManualStart(timestamp(currentTime + offset))}>Set in at playhead</button><button className="button small" onClick={() => setManualEnd(timestamp(currentTime + offset))}>Set out at playhead</button></div></div></div><form className="manual-range-form" onSubmit={addManual}><label className="field"><span>Start · HH:MM:SS or seconds</span><input value={manualStart} onChange={event => setManualStart(event.target.value)}/></label><label className="field"><span>End · HH:MM:SS or seconds</span><input value={manualEnd} onChange={event => setManualEnd(event.target.value)}/></label><button className="button" type="submit"><Plus size={14}/>Add range to review</button></form>{!!source.transcript?.segments?.length && <details><summary>Choose timestamps from transcript</summary><div className="transcript-editor">{source.transcript.segments.map((line,index)=><div key={index}><p>{timestamp(line.start+offset)} {line.text}</p><div className="row"><button className="button small" onClick={()=>{setManualStart(timestamp(line.start+offset));if(sourcePlayer.current)sourcePlayer.current.currentTime=line.start;}}>Start at this phrase</button><button className="button small" onClick={()=>setManualEnd(timestamp(line.end+offset))}>End after this phrase</button></div></div>)}</div></details>}</details>
    {error && <div className="link-error" role="alert">{error}</div>}
    <div className="toolbar moment-toolbar"><div className="row"><select value={sort} onChange={event => setSort(event.target.value)}><option value="time">Source order</option><option value="score">Peak score</option><option value="duration">Longest first</option></select><button className="button small" onClick={() => setSelected(ranges.map(range => range.id))}>Select all</button><button className="button small" onClick={() => setSelected([])}>Clear selection</button></div><span className="muted">{selected.length} selected · {timestamp(duration)} available</span></div>
    {!ranges.length && <div className="empty"><Play size={25}/><h3>No prominent peaks found</h3><p>Add manual timestamp ranges above. Uniform activity and quiet footage can return no candidates.</p></div>}
    <div className="moment-grid">{sorted.map(range => <article className={`moment-card ${selected.includes(range.id) ? 'selected' : ''}`} key={range.id}><div className="moment-card-heading"><label className="toggle"><input type="checkbox" checked={selected.includes(range.id)} onChange={() => setSelected(selected.includes(range.id) ? selected.filter(id => id !== range.id) : [...selected, range.id])}/>{range.origin === 'manual' ? 'Manual timestamp' : `Detected peak · ${range.score}/100`}</label>{viewed.includes(range.id) && <span className="ready"><Check size={12}/>Previewed</span>}</div><RangePreview source={source} range={range} ratio={options.ratio} onViewed={() => setViewed(previous => previous.includes(range.id) ? previous : [...previous, range.id])}/><div className="moment-card-body"><input className="moment-title" aria-label="Moment title" value={range.title} onChange={event => updateRange(range.id, { title: event.target.value })}/><div className="form-grid"><TimeInput value={range.start + offset} label="Start" onValidation={setError} onCommit={value => updateRange(range.id, { start: value - offset })}/><TimeInput value={range.end + offset} label="End" onValidation={setError} onCommit={value => updateRange(range.id, { end: value - offset })}/></div><div className="range-nudges">{(['start', 'end'] as const).map(edge => <span key={edge}>{[-5, -1, 1, 5].map(delta => <button className="button small" key={delta} aria-label={`${edge} ${delta > 0 ? '+' : ''}${delta} seconds`} onClick={() => updateRange(range.id, { [edge]: range[edge] + delta })}>{edge} {delta > 0 ? '+' : ''}{delta}s</button>)}</span>)}</div><p className="moment-duration">Duration {timestamp(range.end - range.start)} · Source range preview</p>{range.reason && <p className="moment-reason">{range.reason}</p>}<div className="row">{['good','bad'].map(rating=><button key={rating} className="button small" aria-pressed={ratings.some(item=>item.sourceId===source.id && item.start===range.start && item.end===range.end && item.rating===rating)} onClick={async()=>{await action('/api/ratings',{sourceId:source.id,start:range.start,end:range.end,title:range.title,rating},'Rating saved for local semantic review.');void refreshRatings();}}>{rating === 'good' ? 'Good moment' : 'Weak moment'}</button>)}</div><div className="row"><button className="button small" onClick={() => onEdit(source, range.start, range.end, { ...options, title: range.title })}><Scissors size={13}/>Edit this range</button><button className="icon-button" aria-label="Remove range" onClick={() => { setRanges(ranges.filter(item => item.id !== range.id)); setSelected(selected.filter(id => id !== range.id)); setError(''); }}><Trash2 size={14}/></button></div></div></article>)}</div>
    <div className="info-box"><strong>Original-quality download</strong><p>Copies the source video and audio without re-encoding, keeping native resolution and frame rate. Uses the original canvas with no effects or burned-in subtitles. The start may move to the preceding keyframe; the exported clip shows the actual start.</p><button className="button primary" disabled={!selected.length || !!error || ['running', 'queued'].includes(exportJob?.status || '')} onClick={exportOriginalSelected}>Download original-quality clips</button></div>
    {options.outputKind !== 'long' && <label className="toggle"><input type="checkbox" checked={dualFormat} onChange={event => setDualFormat(event.target.checked)}/>Export both 9:16 and 16:9 for every selected moment</label>}<div className="review-export-bar"><div><strong>{options.outputKind === 'long' ? `Long-form target ${options.targetMinutes || 20} minutes` : `Short-form · ${options.ratio || '9:16'}`}</strong><p>{options.outputKind === 'long' ? `${timestamp(duration)} of selected footage is available. Overlapping ranges are skipped and footage is used up to the target.` : 'Each selected range becomes its own edited MP4.'}</p>{invalidShort && <p className="validation-error">Trim selected short-form ranges to two minutes or less.</p>}</div><button className="button primary" disabled={!selected.length || invalidShort || !!error || ['running', 'queued'].includes(exportJob?.status || '')} onClick={exportSelected}><ArrowDownToLine size={16}/>{options.outputKind === 'long' ? 'Create reviewed long video' : 'Export selected moments'}</button></div>
    {exportJob && <div className="link-progress"><h3>{exportJob.status === 'done' ? 'Reviewed exports ready' : exportJob.stage}</h3>{exportJob.status === 'running' && <progress value={exportJob.progress} max={100}/>}<p>{exportJob.error}</p>{exported.map(item => <div className="link-output" key={item.id}><Film size={18}/><div><strong>{item.title}</strong><small>{item.width} × {item.height} · {timestamp(item.duration)}</small><small><FileSize size={item.size}/></small></div><video className="rendered-clip-preview" controls preload="none" src={`/media/${item.id}`} poster={`/thumb/${item.id}`}/><a className="button primary small" href={`/media/${item.id}?download=1`}>Download MP4</a></div>)}{!!exported.length && <button className="link-button spaced" onClick={onExports}>Open all exports</button>}</div>}
    <button className="link-button spaced" onClick={() => action('/api/proxy', { sourceId: source.id }, 'Creating a browser-compatible preview for every range.')}>Create browser preview for this recording</button>
  </section>;
}
