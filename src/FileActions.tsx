import FileSize from './FileSize';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Media } from './types';
import { useEditor } from './store';

async function request(route: string, method = 'GET', body?: unknown) {
  const response = await fetch(route, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'File operation failed');
  return result;
}
function invalidate(query: ReturnType<typeof useQueryClient>) {
  for (const key of ['media', 'stats', 'highlights', 'projects', 'trash']) query.invalidateQueries({ queryKey: [key] });
}
export default function FileActions({ item }: { item: Media }) {
  const query = useQueryClient();
  const [repairId,setRepairId]=useState('');
  const {data:repair} = useQuery<any>({queryKey:['audio-repair',repairId],enabled:!!repairId,queryFn:()=>request(`/api/jobs/${repairId}`),refetchInterval:query=>['queued','running'].includes(query.state.data?.status)?1000:false});
  const [info, setInfo] = useState<any>(null);
  const [showInfo,setShowInfo]=useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function inspect(){setBusy(true);setMessage('');try{setInfo(await request(`/api/files/${item.id}`));setShowInfo(true);}catch(error){setMessage((error as Error).message);}finally{setBusy(false);}}
  async function explore() {
    setMessage('');
    try { const result = await request(`/api/files/${item.id}/reveal`, 'POST', {}); setMessage(result.missing ? `File missing from disk: ${result.path}. Opened its library folder. Re-import the source or export the video again to restore it.` : `Library location: ${result.path}`); }
    catch (error) { setMessage((error as Error).message); }
  }
  async function saveAs() {
    setMessage('');
    const extension = item.file?.match(/\.[a-z0-9]{1,8}$/i)?.[0] || (item.kind === 'audio' ? '.m4a' : '.mp4');
    let name = item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120).replace(/[.\s]+$/, '') || 'Noah video';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
    const filename = name.toLowerCase().endsWith(extension.toLowerCase()) ? name : name + extension;
    const picker = (window as any).showSaveFilePicker;
    if (!picker) {
      const link = document.createElement('a'); link.href = `/media/${item.id}?download=1`; link.download = filename; link.click();
      setMessage('Your browser controls the save location. Enable its “Ask where to save each file” setting to choose a folder.'); return;
    }
    setBusy(true);
    let writable: any;
    try {
      // Invoke the native chooser during the click's user activation, before awaiting network calls.
      const handle = await picker.call(window, { suggestedName: filename });
      setMessage('Saving a copy...');
      const response = await fetch(`/media/${item.id}`);
      if (!response.ok || !response.body) throw new Error('The video could not be read for saving.');
      writable = await handle.createWritable();
      await response.body.pipeTo(writable);
      setMessage(`Saved a copy as ${handle.name}. Video quality is unchanged.`);
    } catch (error) {
      if (writable) await writable.abort().catch(() => {});
      setMessage((error as Error).name === 'AbortError' ? 'Save cancelled.' : (error as Error).message);
    } finally { setBusy(false); }
  }
  async function askDelete() {
    setMessage(''); setBusy(true);
    try { setInfo(await request(`/api/files/${item.id}`)); setConfirm(true); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try {
      await request(`/api/files/${item.id}`, 'DELETE');
      const editor = useEditor.getState();
      if (editor.timeline.clips.some(clip => clip.sourceId === item.id) || editor.timeline.musicId === item.id) editor.change({ clips: editor.timeline.clips.filter(clip => clip.sourceId !== item.id), ...(editor.timeline.musicId === item.id ? { musicId: '' } : {}) });
      setConfirm(false); invalidate(query);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  const blocked = info?.projects?.length || info?.jobs?.length;
  return <div className="file-actions" onClick={event => event.stopPropagation()}>
    <div className="row spaced"><button type="button" className="button small" disabled={busy} onClick={inspect}>Show info</button><button type="button" className="button small" onClick={explore}>Show in folder</button><button type="button" className="button small" disabled={busy} onClick={saveAs}>Save as…</button><button type="button" className="button small" disabled={busy} onClick={askDelete}>Delete video</button></div>
    {['export','preview'].includes(item.kind) && item.audioCodec === 'flac' && <button className="button small" disabled={['queued','running'].includes(repair?.status)} onClick={async()=>{try{const job=await request('/api/audio-compatible','POST',{mediaId:item.id});setRepairId(job.id);}catch(error){setMessage((error as Error).message);}}}>Fix playback audio</button>}
    {repair && <p className="fine-print" aria-live="polite">{repair.status === 'done' ? <><FileSize size={repair.result.size}/>{' '}<a className="button small" href={`/media/${repair.result.id}?download=1`}>Download repaired MP4</a></> : repair.error || repair.stage}</p>}
    {message && <p className="fine-print file-message" aria-live="polite">{message}</p>}
    {showInfo && info && createPortal(<div className="modal-backdrop" onClick={()=>setShowInfo(false)}><section className="modal file-modal" role="dialog" aria-modal="true" aria-label="Video information" onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==='Escape')setShowInfo(false);}}><h2>{info.media.title}</h2><p><FileSize size={info.media.size}/></p><p>{info.media.width || '-'} x {info.media.height || '-'} pixels / {info.media.fps?.toFixed(2) || '-'} FPS / {info.media.duration?.toFixed(2)} seconds</p><p>Video codec: {info.media.videoCodec || 'No video'}. Audio codec: {info.media.audioCodec || 'No audio'}.</p><p>Quality: {info.media.quality || 'Imported source'}</p><p>Library file: {info.exists?'Available':'Missing from disk'}</p><p className="file-message">{info.path}</p>{info.media.savedCopyPath && <p className="file-message">Saved export copy: {info.media.savedCopyPath}</p>}<p>{info.projects.length} saved project references / {info.jobs.length} active jobs</p><div className="row"><button className="button" onClick={explore}>Show in folder</button><button className="button" onClick={async()=>{try{await navigator.clipboard.writeText(info.path);setMessage('File path copied.');}catch{setMessage('Clipboard unavailable. Select and copy the path shown above.');}}}>Copy file path</button><button className="button primary" autoFocus onClick={()=>setShowInfo(false)}>Close info</button></div>{message && <p aria-live="polite">{message}</p>}</section></div>,document.body)}
    {confirm && createPortal(<div className="modal-backdrop"><section className="modal file-modal" role="dialog" aria-modal="true" aria-label="Delete video"><h2>Delete “{item.title}”?</h2><p>This moves the app’s library copy and its preview/subtitle files to app trash. Your original uploaded file and copies saved elsewhere are preserved. Restore it in Settings, or permanently delete it there to reclaim space.</p><p className="file-message">{info.path}</p>{info.projects.map((project: any) => <p key={project.id}>Used by saved project: {project.title}. Remove its scene or delete the saved project first.</p>)}{info.jobs.map((job: any) => <p key={job.id}>In use by: {job.label}. Wait for or cancel that job first.</p>)}{useEditor.getState().timeline.clips.some(clip => clip.sourceId === item.id) && <p>This video will also be removed from the current unsaved timeline.</p>}{message && <p className="validation-error">{message}</p>}<div className="row"><button type="button" className="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button><button type="button" className="button primary" disabled={busy || !!blocked} onClick={remove}>Move to trash</button></div></section></div>, document.body)}
  </div>;
}
export function TrashPanel() {
  const query = useQueryClient();
  const { data: trash = [] } = useQuery<any[]>({ queryKey: ['trash'], queryFn: () => request('/api/trash') });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  async function act(id: string, permanent: boolean, title: string) {
    if (permanent && !window.confirm(`Permanently delete “${title}” from app trash? This cannot be undone.`)) return;
    setBusy(id); setMessage('');
    try { await request(`/api/trash/${id}${permanent ? '' : '/restore'}`, permanent ? 'DELETE' : 'POST', permanent ? { confirm: true } : {}); invalidate(query); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(''); }
  }
  async function emptyTrash() {
    const ids=trash.map(item=>item.id);
    if(!ids.length || !window.confirm(`Permanently delete all ${ids.length} items currently in Trash? This cannot be undone. Original files and saved copies outside the app are preserved.`))return;
    setBusy('all');setMessage('');
    try{const result=await request('/api/trash','DELETE',{confirm:true,ids});setMessage(`${result.deleted.length} permanently deleted.${result.failed.length?' Some items could not be deleted: '+result.failed.map((item:any)=>item.error).join(' '):''}`);invalidate(query);}
    catch(error){setMessage((error as Error).message);}finally{setBusy('');}
  }
  return <section className="panel trash-panel"><h2>Deleted videos</h2><button className="button" disabled={!trash.length || !!busy} onClick={emptyTrash}>Delete all permanently ({trash.length})</button><p className="fine-print">App trash retains files until permanently deleted. Saved copies outside this app are independent.</p>{message && <p className="validation-error">{message}</p>}{!trash.length && <p className="muted">Trash is empty.</p>}{trash.map(item => <div className="trash-row" key={item.id}><strong>{item.title}</strong><div className="row"><button className="button small" disabled={!!busy} onClick={() => act(item.id, false, item.title)}>Restore</button><button className="button small" disabled={!!busy} onClick={() => act(item.id, true, item.title)}>Delete permanently</button></div></div>)}</section>;
}
export function DeleteProject({ id, title }: { id: string; title: string }) {
  const query = useQueryClient(); const [message, setMessage] = useState('');
  return <div><button className="button small" onClick={async () => {
    if (!window.confirm(`Delete saved project “${title}”? Video files and exports will be kept.`)) return;
    try { await request(`/api/projects/${id}`, 'DELETE', { confirm: true }); invalidate(query); }
    catch (error) { setMessage((error as Error).message); }
  }}>Delete project</button>{message && <p className="validation-error">{message}</p>}</div>;
}
