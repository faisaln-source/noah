import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA } from './store.mjs';
import { addMedia, probe } from './media.mjs';
import { checkCancelled, update } from './jobs.mjs';

const extensions = new Set(['.mp4','.mkv','.mov','.webm','.m4v','.mp3','.wav','.m4a','.ogg','.flac']);
export async function importLocalPath(payload, job) {
  if (payload.rightsConfirmed !== true) throw new Error('Confirm media rights before importing');
  if (!path.isAbsolute(payload.path || '')) throw new Error('Enter an absolute file or folder path');
  const input = await fs.realpath(payload.path);
  const stat = await fs.stat(input);
  const candidates = stat.isDirectory() ? (await fs.readdir(input,{withFileTypes:true})).filter(entry=>entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())).map(entry=>path.join(input,entry.name)).sort() : [input];
  if (!candidates.length || candidates.length > 100) throw new Error('Choose a media file or a folder containing 1 to 100 supported files (no subfolders)');
  const imported = [];
  for (const [index,file] of candidates.entries()) {
    checkCancelled(job);
    update(job,{stage:`Importing local file ${index + 1} of ${candidates.length}`});
    const ext = path.extname(file).toLowerCase();
    if (!extensions.has(ext)) throw new Error('Unsupported media format');
    const info = await probe(file);
    const kind = info.streams.some(stream=>stream.codec_type==='video') ? 'video' : 'audio';
    if (!info.streams.some(stream=>['audio','video'].includes(stream.codec_type))) throw new Error('File has no playable media');
    const destination = path.join(DATA,randomUUID()+ext);
    await fs.copyFile(file,destination,fs.constants.COPYFILE_EXCL);
    try { imported.push(await addMedia(destination,path.basename(file),kind,{originalPath:file})); }
    catch(error) { await fs.unlink(destination).catch(()=>{});throw error; }
    update(job,{importedIds:imported.map(item=>item.id),progress:(index+1)/candidates.length*100});
  }
  return {imported};
}
