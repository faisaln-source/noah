import {createContext,useContext,useState,type ReactNode} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useEditor} from './store';
import type {Media} from './types';
const Selection=createContext<{selected:string[];toggle:(id:string)=>void;busy:boolean}|null>(null);
export function SelectMedia({item}:{item:Media}){
  const state=useContext(Selection);
  if(!state)return null;
  return <label className="toggle media-selection"><input type="checkbox" aria-label={`Select ${item.title}`} disabled={state.busy} checked={state.selected.includes(item.id)} onChange={()=>state.toggle(item.id)}/>Select video</label>;
}
export default function BulkDelete({items,children}:{items:Media[];children:ReactNode}){
  const query=useQueryClient();const [selected,setSelected]=useState<string[]>([]);const [confirm,setConfirm]=useState(false);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const ids=items.map(item=>item.id);const chosen=selected.filter(id=>ids.includes(id));const all=!!ids.length && chosen.length===ids.length;
  async function remove(){
    setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/files/bulk-trash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:chosen,confirm:true})});const result=await response.json();if(!response.ok)throw new Error(result.error);
      const deleted:string[]=result.trashed;const state=useEditor.getState();
      state.change({clips:state.timeline.clips.filter(clip=>!deleted.includes(clip.sourceId || '')),...(deleted.includes(state.timeline.musicId)?{musicId:''}:{})});
      setSelected(previous=>previous.filter(id=>!deleted.includes(id)));setConfirm(false);
      setMessage(`${deleted.length} moved to trash.${result.failed.length?` ${result.failed.length} could not be deleted. `+result.failed.map((failure:any)=>`${items.find(item=>item.id===failure.id)?.title || failure.id}: ${failure.error}`).join(' '):' Restore them in Settings if needed.'}`);
      for(const key of ['media','stats','highlights','trash'])void query.invalidateQueries({queryKey:[key]});
    }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
  }
  return <Selection.Provider value={{selected:chosen,busy,toggle:id=>setSelected(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])}}><section aria-label="Bulk video deletion"><div className="toolbar"><label className="toggle"><input type="checkbox" checked={all} disabled={!ids.length || busy} onChange={()=>setSelected(all?[]:ids)}/>Select all</label><span>{chosen.length} selected</span><button className="button small" disabled={!chosen.length || busy} onClick={()=>setSelected([])}>Clear selection</button><button className="button" disabled={!chosen.length || busy} onClick={()=>setConfirm(true)}>Delete selected ({chosen.length})</button></div>{message && <p role="status" className="info-box">{message}</p>}{confirm && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="Delete selected videos"><h2>Move {chosen.length} videos to trash?</h2><p>Original files and saved copies outside the library are preserved. Files used by saved projects or active jobs will be skipped and reported.</p><p>Restore deleted files in Settings.</p><button className="button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><button className="button primary" disabled={busy} onClick={remove}>{busy?'Moving to trash...':'Move selected to trash'}</button></section></div>}{children}</section></Selection.Provider>;
}
