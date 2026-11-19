import { Router } from 'express';
import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { DATA, put, required, numeric, remove } from './store.mjs';
import { addMedia } from './media.mjs';

export const uploads = Router();
const locks = new Set();
const videoExtensions = ['.mp4', '.mov', '.webm', '.mkv', '.m4v'];
const audioExtensions = ['.mp3', '.wav', '.m4a', '.ogg', '.flac'];
export function rights(body) {
  if (body.rightsConfirmed !== true) throw new Error('Confirm that you own this media or have permission to reuse it.');
}
uploads.post('/uploads', (req, res) => {
  rights(req.body);
  const ext = path.extname(String(req.body.name || '')).toLowerCase();
  if (![...videoExtensions, ...audioExtensions].includes(ext)) throw new Error('Unsupported media format');
  const size = numeric(req.body.size, 1, 1024 ** 4, 'file size');
  const upload = put('uploads', { id: randomUUID(), name: String(req.body.name).slice(0, 180), size, ext, createdAt: Date.now(), rightsConfirmedAt: Date.now() });
  res.json({ ...upload, offset: 0 });
});
uploads.get('/uploads/:id', async (req, res) => {
  const upload = required('uploads', req.params.id);
  const offset = (await fs.stat(path.join(DATA, 'uploads', `${upload.id}.part`)).catch(() => ({ size: 0 }))).size;
  res.json({ ...upload, offset });
});
uploads.patch('/uploads/:id', async (req, res) => {
  const upload = required('uploads', req.params.id);
  if (upload.mediaId) return res.json({ offset: upload.size, mediaId: upload.mediaId });
  if (locks.has(upload.id)) return res.status(409).json({ error: 'Upload chunk already in progress' });
  locks.add(upload.id);
  const file = path.join(DATA, 'uploads', `${upload.id}.part`);
  const offset = (await fs.stat(file).catch(() => ({ size: 0 }))).size;
  try {
    if (Number(req.headers['upload-offset']) !== offset) return res.status(409).json({ error: 'Offset mismatch', offset });
    let received = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > 16 * 1024 ** 2 || offset + received > upload.size) callback(new Error('Chunk exceeds upload size'));
      else callback(null, chunk);
    } });
    await pipeline(req, limit, createWriteStream(file, { flags: 'a' }));
    res.json({ offset: offset + received });
  } catch (error) {
    await fs.truncate(file, offset).catch(() => {});
    throw error;
  } finally { locks.delete(upload.id); }
});
uploads.post('/uploads/:id/complete', async (req, res) => {
  const upload = required('uploads', req.params.id);
  if (upload.mediaId) return res.json(required('media', upload.mediaId));
  if (locks.has(upload.id)) throw new Error('Upload is still in progress');
  locks.add(upload.id);
  try {
    const part = path.join(DATA, 'uploads', `${upload.id}.part`);
    const file = path.join(DATA, `${upload.id}${upload.ext}`);
    if ((await fs.stat(file).catch(() => ({ size: 0 }))).size !== upload.size) {
      if ((await fs.stat(part)).size !== upload.size) throw new Error('Upload is incomplete');
      await fs.rename(part, file);
    }
    const media = await addMedia(file, upload.name, audioExtensions.includes(upload.ext) ? 'audio' : 'upload', { rightsConfirmedAt: upload.rightsConfirmedAt });
    put('uploads', { ...upload, mediaId: media.id });
    res.json(media);
  } finally { locks.delete(upload.id); }
});
uploads.delete('/uploads/:id', async (req, res) => {
  const upload = required('uploads', req.params.id);
  if (locks.has(upload.id)) throw new Error('Pause the upload before cancelling');
  await fs.unlink(path.join(DATA, 'uploads', `${upload.id}.part`)).catch(() => {});
  remove('uploads', upload.id);
  res.json({ ok: true });
});
uploads.post('/upload', async (req, res) => {
  if (req.headers['x-rights-confirmed'] !== 'true') throw new Error('Confirm media rights using X-Rights-Confirmed: true');
  const name = String(req.query.name || 'video.mp4');
  const ext = path.extname(name).toLowerCase();
  if (!videoExtensions.includes(ext)) throw new Error('Unsupported video format');
  const file = path.join(DATA, `${randomUUID()}${ext}`);
  try { await pipeline(req, createWriteStream(file)); res.json(await addMedia(file, name, 'upload', { rightsConfirmedAt: Date.now() })); }
  catch (error) { await fs.unlink(file).catch(() => {}); throw error; }
});
