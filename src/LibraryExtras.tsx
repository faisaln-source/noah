import { useEffect, useState } from 'react';
import type { Media } from './types';

export function OutputSettings() {
  const [folder, setFolder] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { fetch('/api/output-folder').then(response => response.json()).then(value => setFolder(value.folder || '')); }, []);
  return <section className="panel"><h2>Preferred export folder</h2><p>Finished MP4s and subtitle files are copied here in a separate folder for each job. Library deletion keeps these saved copies. Leave blank to use only the app library and Save As.</p><label className="field"><span>Existing output folder (absolute path)</span><input value={folder} onChange={event => setFolder(event.target.value)}/></label><button className="button" onClick={async () => { try { const response = await fetch('/api/output-folder', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({folder}) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setFolder(value.folder); setMessage('Saved. Applies to newly queued jobs.'); } catch(error) { setMessage((error as Error).message); } }}>Remember output folder</button><p role="status">{message}</p></section>;
}
export function BatchCaptions({media, action}: {media: Media[]; action: any}) {
  const [selected, setSelected] = useState<string[]>([]);
  return <details className="panel"><summary>Batch caption finished clips</summary><p>Keep each clip's complete duration and native canvas. Speech recognition and GTA VI subtitles run locally; edited exports use lossless encoding.</p>{media.filter(item => item.kind !== 'audio').map(item => <label key={item.id} className="toggle"><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(event.target.checked ? [...selected,item.id] : selected.filter(id => id !== item.id))}/>{item.title}</label>)}<button className="button" disabled={!selected.length} onClick={() => action('/api/batch-captions', {sourceIds:selected}, 'Batch captioning queued. Finished files appear in Exports.')}>Caption selected full clips</button></details>;
}

export function LocalPathImport({action}:{action:any}) {
  const [path,setPath] = useState('');
  const [rights,setRights] = useState(false);
  return <details className="panel"><summary>Import a local file or folder</summary><p>Import up to 100 supported videos and audio files from one folder. ClipForge creates library copies and keeps the originals in place.</p><label className="field"><span>Absolute file or folder path</span><input value={path} onChange={event=>setPath(event.target.value)}/></label><label className="toggle"><input type="checkbox" checked={rights} onChange={event=>setRights(event.target.checked)}/>I own these files or have permission to reuse them</label><button className="button" disabled={!rights || !path} onClick={()=>action('/api/import-path',{path,rightsConfirmed:true},'Local import queued. Files appear in the media library as they complete.')}>Import file or folder</button></details>;
}
