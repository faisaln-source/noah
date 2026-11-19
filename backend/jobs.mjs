import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mirrorOutputs } from './output.mjs';
import { ROOT, DATA, put, get, all } from './store.mjs';

export const events = new EventEmitter();
const handlers = new Map();
const children = new Map();
const active = new Set();
export function binary(name) {
  if (name === 'python') return process.env.PYTHON_PATH || (fs.existsSync(path.join(ROOT, 'tools/python/python.exe')) ? path.join(ROOT, 'tools/python/python.exe') : 'python3');
  const local = path.join(ROOT, 'tools', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
  return fs.existsSync(local) ? local : name;
}
export function update(job, changes = {}) {
  if (get('jobs', job.id)?.cancelled) job.cancelled = true;
  Object.assign(job, changes, { updatedAt: Date.now() });
  put('jobs', job);
  events.emit('update', job);
}
export function checkCancelled(job) {
  if (job && get('jobs', job.id)?.cancelled) throw new Error('Cancelled');
}
export function run(name, args, job, options = {}) {
  return new Promise((resolve, reject) => {
    try { checkCancelled(job); } catch (error) { reject(error); return; }
    const child = spawn(binary(name), args, { cwd: DATA, windowsHide: true, ...options });
    const timeout = options.timeoutMs ? setTimeout(() => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else child.kill('SIGTERM');
    }, options.timeoutMs) : null;
    if (job) children.set(job.id, child);
    let stdout = '';
    let stderr = '';
    let pending = '';
    let lastUpdate = 0;
    child.stdout.on('data', chunk => {
      stdout = (stdout + chunk).slice(-4000000);
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        options.onLine?.(line);
        if (job && name === 'python') {
          try {
            const report = JSON.parse(line);
            if (report.progress !== undefined && Date.now() - lastUpdate > 300) {
              update(job, { progress: report.progress, stage: report.message });
              lastUpdate = Date.now();
            }
          } catch { /* Python dependency messages are preserved in logs. */ }
        }
      }
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-12000);
      if (job && Date.now() - lastUpdate > 800) {
        update(job, { log: stderr.slice(-3000) });
        lastUpdate = Date.now();
      }
    });
    child.on('error', error => { if (timeout) clearTimeout(timeout); reject(error); });
    child.on('close', code => {
      if (timeout) clearTimeout(timeout);
      if (job) children.delete(job.id);
      if (code === 0) resolve(stdout);
      else reject(new Error(get('jobs', job?.id || '')?.cancelled ? 'Cancelled' : `${name} failed. ${stderr.slice(-2400)} ${stdout.slice(-600)}`));
    });
  });
}
export function register(type, handler) { handlers.set(type, handler); }
export function enqueue(type, payload, label) {
  const job = put('jobs', { id: randomUUID(), type, payload, label, outputFolder: get('settings', 'output-folder')?.folder || '', status: 'queued', progress: 0, stage: 'Waiting', createdAt: Date.now() });
  events.emit('update', job);
  queueMicrotask(drain);
  return job;
}
export function cancel(id) {
  const job = get('jobs', id);
  if (!job || !['running', 'queued'].includes(job.status)) return;
  update(job, { cancelled: true, status: job.status === 'queued' ? 'cancelled' : 'running', stage: 'Cancelling' });
  const child = children.get(id);
  if (child && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
  else child?.kill('SIGTERM');
}
export function finishRecording(id) {
  const job = get('jobs', id);
  const child = children.get(id);
  if (job?.status !== 'running' || job.phase !== 'record' || !child || path.basename(child.spawnfile).toLowerCase() !== path.basename(binary('ffmpeg')).toLowerCase()) {
    throw new Error('The live recording is not ready to finish yet.');
  }
  child.stdin.write('q\n');
  update(job, { stage: 'Finishing recording for preview' });
}
export async function drain() {
  const queued = all('jobs').reverse().filter(item => item.status === 'queued');
  const laneFor = item => item.type === 'live-clip' ? 'live-capture' : ['render', 'review-export', 'original-export', 'editor-original'].includes(item.type) ? 'export' : item.type === 'buffered-clip' || item.payload?.manualClip ? 'interactive-clip' : 'processing';
  for (const lane of ['processing', 'live-capture', 'interactive-clip', 'export']) {
    if (active.has(lane)) continue;
    const job = queued.find(item => laneFor(item) === lane);
    if (!job) continue;
    active.add(lane);
    executeJob(job, lane);
  }
}
async function executeJob(job, lane) {
  update(job, { status: 'running', stage: 'Starting', progress: 0 });
  try {
    const handler = handlers.get(job.type);
    if (!handler) throw new Error('Unknown job type');
    let result = await handler(job.payload, job);
    checkCancelled(job);
    try { result = await mirrorOutputs(result, job); } catch (error) { job.outputWarning = `Saved in app library, but output folder copy failed: ${error.message}`; }
    checkCancelled(job);
    update(job, { status: 'done', progress: 100, stage: job.outputWarning ? 'Complete; output folder copy needs attention' : 'Complete', log: job.outputWarning || job.log, result });
  } catch (error) {
    const cancelled = get('jobs', job.id)?.cancelled;
    update(job, { status: cancelled ? 'cancelled' : 'error', error: error.message, stage: cancelled ? 'Cancelled' : 'Failed' });
  } finally {
    active.delete(lane);
    queueMicrotask(drain);
  }
}
export function recoverJobs() {
  for (const job of all('jobs')) {
    if (job.status === 'running') update(job, { status: 'error', error: 'Processing was interrupted by a server restart. Retry to resume from saved analysis and transcription.', stage: 'Interrupted' });
  }
  drain();
}
