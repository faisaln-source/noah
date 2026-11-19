import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DATA, put } from './store.mjs';

export async function validateOutputFolder(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Enter an absolute output folder path');
  const folder = await fs.realpath(value);
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('Output folder must be an existing directory');
  await fs.access(folder, fs.constants.W_OK);
  return folder;
}
export async function mirrorOutputs(result, job) {
  const folder = job.outputFolder;
  if (!folder) return result;
  const items = result?.exports || (result?.kind === 'export' ? [result] : []);
  if (!items.length) return result;
  const destination = path.join(folder, job.id);
  await fs.mkdir(destination, { recursive: true });
  for (const item of items) {
    const name = `${item.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100)}-${item.id}`;
    for (const [key, ext] of [['file', '.mp4'], ['srt', '.srt'], ['vtt', '.vtt']]) {
      if (!item[key]) continue;
      await fs.copyFile(path.join(DATA, path.basename(item[key])), path.join(destination, name + ext), fs.constants.COPYFILE_EXCL);
    }
    item.savedCopyPath = path.join(destination, name + '.mp4');
    put('media', item);
  }
  return result;
}
