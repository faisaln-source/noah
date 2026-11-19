import FileSize from './FileSize';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEditor } from './store';
import FileActions from './FileActions';
import type { Media } from './types';

export type DeliveryRequest = { id: number; mode: 'edited' | 'original' };
export default function EditorDelivery({ request, onBusyChange }: { request: DeliveryRequest | null; onBusyChange: (busy: boolean) => void }) {
  const { timeline } = useEditor();
  const [jobId, setJobId] = useState(() => localStorage.getItem('clipforge-editor-download-job') || '');
  const [starting, setStarting] = useState(false);
  const [preparedFor, setPreparedFor] = useState(() => localStorage.getItem('clipforge-editor-download-signature') || '');
  const [error, setError] = useState('');
  const handled = useRef(0);
  const { data: job, refetch, error: jobError } = useQuery<any>({ queryKey: ['editor-download', jobId], enabled: !!jobId,
    queryFn: async () => { const response = await fetch(`/api/jobs/${jobId}`); const result = await response.json(); if (!response.ok) throw Error(result.error); return result; },
    refetchInterval: query => ['queued', 'running'].includes(query.state.data?.status) ? 1000 : false });
  const outputs: Media[] = job?.status === 'done' ? (job.result.exports || [job.result]).filter((item: any) => item?.id) : [];
  const duration = timeline.clips.reduce((sum, clip) => sum + (clip.type === 'title' ? clip.duration || 2 : (clip.end - clip.start) / timeline.speed), 0);
  async function start(mode: 'edited' | 'original') {
    if (starting || ['running', 'queued'].includes(job?.status)) return;
    setStarting(true); setError('');
    try {
      const current = useEditor.getState().timeline;
      const response = await fetch(mode === 'edited' ? '/api/export' : '/api/editor/original', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setJobId(result.id); localStorage.setItem('clipforge-editor-download-job', result.id); setPreparedFor(JSON.stringify(current)); localStorage.setItem('clipforge-editor-download-signature', JSON.stringify(current));
    } catch (error) { setError((error as Error).message); }
    finally { setStarting(false); }
  }
  useEffect(() => { if (request && request.id !== handled.current) { handled.current = request.id; start(request.mode); } }, [request?.id]);
  const busy = starting || ['running', 'queued'].includes(job?.status);
  useEffect(() => onBusyChange(busy), [busy]);
  return <section className="panel editor-delivery" aria-label="Full quality downloads"><div className="section-title"><h2>Download your complete video</h2><strong>{duration.toFixed(1)} seconds · {timeline.clips.length} scenes</strong></div>
    <p className="fine-print">Edited download includes the entire timeline and your effects. Source-quality downloads copy each footage range unchanged, with no effects or title cards. Neither button downloads a reduced preview.</p>
    <div className="row"><button className="button primary" disabled={busy || !timeline.clips.length} onClick={() => start('edited')}>Prepare full-quality edited download</button><button className="button" disabled={busy || !timeline.clips.some(clip => clip.sourceId)} onClick={() => start('original')}>Prepare source-quality downloads</button></div>
    {(error || jobError) && <p className="validation-error" role="alert">{error || (jobError as Error)?.message}</p>}
    {job && <div className="delivery-progress"><p aria-live="polite">{job.status === 'done' ? 'Your full-quality files are ready to download below.' : job.stage}</p>{busy && <progress max="100" value={job.progress || 0}/>}<p className="validation-error">{job.error}</p>{['running', 'queued'].includes(job.status) && <button className="button small" onClick={async () => { await fetch(`/api/cancel/${job.id}`, { method: 'POST' }); refetch(); }}>Cancel download preparation</button>}{['error', 'cancelled'].includes(job.status) && <button className="button" onClick={async () => { const response = await fetch(`/api/retry/${job.id}`, { method: 'POST' }); const result = await response.json(); if (response.ok) { setJobId(result.id); localStorage.setItem('clipforge-editor-download-job', result.id); } else setError(result.error); }}>Retry download</button>}</div>}
    {!!outputs.length && preparedFor !== JSON.stringify(timeline) && <p className="fine-print">These files belong to an earlier prepared version. Prepare another download to include your current changes.</p>}
    {outputs.map(item => <article className="delivery-file" key={item.id}><strong>{item.title}</strong><p>{item.width} × {item.height} · {item.fps?.toFixed(2)} FPS · {item.duration.toFixed(1)} seconds · {item.quality === 'original' ? 'Original streams' : item.quality === 'lossless-edited' ? 'Lossless video + lossless audio master; AAC playback track' : 'Edited output'}</p><p><FileSize size={item.size}/></p><details><summary>Watch completed file</summary><video controls playsInline preload="metadata" src={`/media/${item.id}`}/></details><a className="button primary" href={`/media/${item.id}?download=1`}>Download full-quality MP4</a><FileActions item={item}/></article>)}
  </section>;
}
