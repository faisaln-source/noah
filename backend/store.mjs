import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
for (const directory of ['', 'work', 'uploads', 'models']) fs.mkdirSync(path.join(DATA, directory), { recursive: true });
export const db = new DatabaseSync(path.join(DATA, 'clipforge.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY(collection, id)
  );`);
const putRecord = db.prepare('INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value');
export function put(collection, value) {
  putRecord.run(collection, value.id, JSON.stringify(value));
  return value;
}
export function get(collection, id) {
  const row = db.prepare('SELECT value FROM records WHERE collection=? AND id=?').get(collection, id);
  return row ? JSON.parse(row.value) : undefined;
}
export function all(collection) {
  return db.prepare('SELECT value FROM records WHERE collection=? ORDER BY rowid DESC').all(collection).map(row => JSON.parse(row.value));
}
export function remove(collection, id) {
  db.prepare('DELETE FROM records WHERE collection=? AND id=?').run(collection, id);
}
export function numeric(value, min, max, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`Invalid ${label}. Expected ${min} to ${max}.`);
  return result;
}
export function required(collection, id) {
  const value = get(collection, id);
  if (!value) throw new Error(`${collection} item not found`);
  return value;
}
// Import media created by the first version without changing its identifiers.
if (!get('settings', 'migration-v1')) {
  const file = path.join(DATA, 'library.json');
  if (fs.existsSync(file)) {
    for (const item of JSON.parse(fs.readFileSync(file, 'utf8'))) put('media', item);
  }
  put('settings', { id: 'migration-v1', completedAt: Date.now() });
}
