import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('live capture starts during processing and each lane preserves its queue', async () => {
  const root = path.resolve('data');
  const directory = path.join(root, randomUUID());
  process.env.DATA_DIR = directory;
  const { register, enqueue } = await import('../backend/jobs.mjs');
  const { get, db } = await import('../backend/store.mjs');
  const releases = new Map();
  const started = [];
  const handler = async payload => {
    started.push(payload.name);
    await new Promise(resolve => releases.set(payload.name, resolve));
    return { name: payload.name };
  };
  register('processing-test', handler);
  register('live-clip', handler);
  register('buffered-clip', handler);
  register('render', handler);
  const waitFor = async predicate => {
    for (let index = 0; index < 100; index++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Queue did not reach the expected state');
  };
  try {
    const jobs = [
      enqueue('processing-test', { name: 'export1' }),
      enqueue('processing-test', { name: 'export2' }),
      enqueue('live-clip', { name: 'live1' }),
      enqueue('live-clip', { name: 'live2' }),
    ];
    await waitFor(() => started.length === 2);
    assert.deepEqual(started, ['export1', 'live1']);
    const download = enqueue('render', { name: 'full-quality-download' });
    jobs.push(download);
    await waitFor(() => started.includes('full-quality-download'));
    assert.equal(get('jobs', jobs[0].id).status, 'running');
    releases.get('full-quality-download')();
    const interactive = enqueue('buffered-clip', { name: 'watched-range' });
    jobs.push(interactive);
    await waitFor(() => started.includes('watched-range'));
    assert.equal(get('jobs', jobs[0].id).status, 'running');
    releases.get('watched-range')();
    releases.get('live1')();
    await waitFor(() => started.includes('live2'));
    assert.equal(get('jobs', jobs[0].id).status, 'running');
    assert.equal(get('jobs', jobs[1].id).status, 'queued');
    releases.get('live2')();
    releases.get('export1')();
    await waitFor(() => started.includes('export2'));
    releases.get('export2')();
    await waitFor(() => jobs.every(job => get('jobs', job.id).status === 'done'));
  } finally {
    for (const release of releases.values()) release();
    db.close();
    assert.equal(path.dirname(directory), root);
    assert.match(path.basename(directory), /^[0-9a-f-]{36}$/);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
