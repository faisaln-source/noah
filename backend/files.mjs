import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA, all, get, put, remove, required } from './store.mjs';

export const files = Router();
const locks = new Set();
const trashRoot = path.join(DATA, 'trash');
await fs.mkdir(trashRoot, { recursive: true });
function localFile(name) {
  if (!name || path.basename(name) !== name) throw new Error('Invalid library file path');
  const file = path.resolve(DATA, name);
  if (path.dirname(file) !== DATA) throw new Error('File is outside the media library');
  return file;
}
function uses(value, id) {
  if (typeof value === 'string') return value === id || value.endsWith(`/media/${id}`);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(item => uses(item, id));
}
files.use((req, _res, next) => {
  if (['POST', 'PUT'].includes(req.method)) {
    for (const id of locks) if (uses(req.body, id)) throw new Error('Wait for the file operation to finish before using this video.');
  }
  next();
});
function dependencies(id) {
  return {
    projects: all('projects').filter(item => uses(item.timeline, id)).map(item => ({ id: item.id, title: item.title })),
    jobs: all('jobs').filter(item => ['running', 'queued'].includes(item.status) && (item.sourceId === id || uses(item.payload, id))).map(item => ({ id: item.id, label: item.label || item.type })),
  };
}
function ownedFiles(media) {
  const highlights = all('highlights').filter(item => item.sourceId === media.id);
  const names = [media.file, media.proxy, media.thumbnail, media.srt, media.vtt, ...highlights.map(item => item.thumbnail)].filter(Boolean);
  const others = all('media').filter(item => item.id !== media.id);
  return [...new Set(names)].filter(name => !others.some(item => [item.file, item.proxy, item.thumbnail, item.srt, item.vtt].includes(name)));
}
files.get('/files/:id', async (req, res) => {
  const media = required('media', req.params.id);
  const file=localFile(media.file);const stat=await fs.stat(file).catch(()=>null);
  res.json({ path:file,media:{...media,size:stat?.size ?? media.size},exists:!!stat,...dependencies(media.id),files:ownedFiles(media) });
});
files.post('/files/:id/reveal', async (req, res) => {
  const media = required('media', req.params.id);
  const file = localFile(media.file);
  const missing=await fs.access(file).then(()=>false,error=>{if(error.code==='ENOENT')return true;throw error;});
  const folder=path.dirname(file);
  await fs.access(folder);
  if (process.env.CLIPFORGE_DISABLE_NATIVE_UI === '1') return res.json({ path: file, folder, missing, launched: false, testMode: true });
  if(process.platform==='win32'){
    // Pass paths as data, and explicitly launch the interactive Explorer window
    // visibly even though the ClipForge server itself runs hidden.
    const script=`$ErrorActionPreference="Stop"; $target=[Console]::In.ReadToEnd() | ConvertFrom-Json; $arguments=if($target.missing){'/n,"' + $target.folder + '"'}else{'/n,/select,"' + $target.path + '"'}; Start-Process -FilePath explorer.exe -WindowStyle Normal -ArgumentList $arguments`;
    await new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','ignore','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(error || 'Explorer could not launch')));child.stdin.end(JSON.stringify({path:file,folder,missing}));});
  }else{
    const command=process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='darwin' && !missing?['-R',file]:[folder];
    await new Promise((resolve,reject)=>{const child=spawn(command,args,{detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
  }
  res.json({ path: file, folder, missing, launched: true });
});
async function trashMedia(id) {
  if (locks.has(id)) throw new Error('A file operation is already in progress');
  locks.add(id);
  try {
    const media = required('media', id);
    const refs = dependencies(id);
    if (refs.jobs.length) throw new Error('Wait for or cancel the jobs using this video before deleting it.');
    if (refs.projects.length) throw new Error(`Saved projects use this video: ${refs.projects.map(item => item.title).join(', ')}. Remove those scenes or delete those saved projects first.`);
    const names = ownedFiles(media);
    // Validate every source path before moving any file.
    for (const name of names) localFile(name);
    const folder = path.join(trashRoot, id);
    if (!/^[0-9a-f-]{36}$/.test(id) || path.dirname(folder) !== trashRoot) throw new Error('Invalid media identifier');
    await fs.mkdir(folder, { recursive: true });
    const moved = [];
    try {
      for (const name of names) {
        try { await fs.rename(localFile(name), path.join(folder, name)); moved.push(name); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    } catch (error) {
      for (const name of moved.reverse()) await fs.rename(path.join(folder, name), localFile(name));
      throw error;
    }
    const highlights = all('highlights').filter(item => item.sourceId === id);
    put('trash', { id, media, files: moved, highlights, deletedAt: Date.now() });
    remove('media', id);
    for (const item of highlights) remove('highlights', item.id);
    return { trashed: true, id };
  } finally { locks.delete(id); }
}
files.delete('/files/:id', async (req,res) => res.json(await trashMedia(req.params.id)));
files.post('/files/bulk-trash', async (req,res) => {
  if(req.body.confirm !== true)throw new Error('Confirm moving the selected files to trash');
  if(!Array.isArray(req.body.ids) || !req.body.ids.length || req.body.ids.length>1000 || req.body.ids.some(id=>typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id)))throw new Error('Select 1 to 1000 media files');
  const trashed=[],failed=[];
  for(const id of [...new Set(req.body.ids)]){try{await trashMedia(id);trashed.push(id);}catch(error){failed.push({id,error:error.message});}}
  res.json({trashed,failed});
});
files.get('/trash', (_req, res) => res.json(all('trash').map(item => ({ id: item.id, title: item.media.title, deletedAt: item.deletedAt, size: item.media.size }))));
files.post('/trash/:id/restore', async (req, res) => {
  const entry = required('trash', req.params.id);
  if (locks.has(entry.id)) throw new Error('A file operation is already in progress');
  locks.add(entry.id);
  const moved = [];
  const folder = path.resolve(trashRoot, entry.id);
  try {
    if (path.dirname(folder) !== trashRoot || !/^[0-9a-f-]{36}$/.test(entry.id)) throw new Error('Invalid trash path');
    for (const name of entry.files) {
      await fs.access(localFile(name)).then(() => { throw new Error('An existing file would be overwritten.'); }, error => { if (error.code !== 'ENOENT') throw error; });
    }
    try {
      for (const name of entry.files) { await fs.rename(path.join(folder, name), localFile(name)); moved.push(name); }
    } catch (error) {
      for (const name of moved.reverse()) await fs.rename(localFile(name), path.join(folder, name));
      throw error;
    }
    put('media', entry.media);
    for (const item of entry.highlights) put('highlights', item);
    remove('trash', entry.id);
    await fs.rmdir(folder).catch(() => {});
    res.json({ restored: true });
  } finally { locks.delete(entry.id); }
});
async function permanentlyDeleteTrash(id) {
  const entry = required('trash', id);
  if (locks.has(entry.id)) throw new Error('A file operation is already in progress');
  const folder = path.resolve(trashRoot, entry.id);
  if (path.dirname(folder) !== trashRoot || !/^[0-9a-f-]{36}$/.test(entry.id)) throw new Error('Invalid trash path');
  locks.add(entry.id);
  try {
    for (const name of entry.files) localFile(name);
    for (const name of entry.files) await fs.unlink(path.join(folder, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(folder).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; });
    remove('trash', entry.id);
    for (const upload of all('uploads').filter(item => item.mediaId === entry.id)) remove('uploads', upload.id);
    return {deleted:true};
  } finally { locks.delete(entry.id); }
}
files.delete('/trash/:id',async(req,res)=>{if(req.body?.confirm!==true)throw new Error('Confirm permanent deletion.');res.json(await permanentlyDeleteTrash(req.params.id));});
files.delete('/trash',async(req,res)=>{
  if(req.body?.confirm!==true)throw new Error('Confirm permanently deleting all selected trash.');
  const ids=req.body.ids;
  if(!Array.isArray(ids) || !ids.length || ids.length>1000 || ids.some(id=>typeof id!=='string' || !/^[0-9a-f-]{36}$/.test(id)))throw new Error('Choose 1 to 1000 trash items');
  const deleted=[],failed=[];
  for(const id of [...new Set(ids)]){try{await permanentlyDeleteTrash(id);deleted.push(id);}catch(error){failed.push({id,error:error.message});}}
  res.json({deleted,failed});
});
files.delete('/projects/:id', (req, res) => {
  required('projects', req.params.id);
  if (req.body?.confirm !== true) throw new Error('Confirm deletion of the saved project.');
  remove('projects', req.params.id);
  res.json({ deleted: true });
});
