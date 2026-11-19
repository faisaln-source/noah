import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = path.resolve('.');
const base = 'http://127.0.0.1:3104';
const workspace = path.join(root, 'data', `e2e-${randomUUID()}`);
const artifacts = path.join(root, 'test-results', 'studio-artifacts');
let server: ChildProcess;
let context: BrowserContext;
let page: Page;
let source: any;
let music: any;
let serverLog = '';
const runtimeErrors: string[] = [];
const passes: string[] = [];
const downloads: string[] = [];
let gpuStatus = 'Not checked';
const fixture = path.join(workspace, 'Gameplay fixture.mp4');
const longFixture = path.join(workspace, 'Long silent fixture.mp4');

function command(name: string, args: string[]) {
  const result = spawnSync(path.join(root, 'tools', `${name}.exe`), args, { windowsHide: true, encoding: 'utf8' });
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  return result.stdout;
}
async function api(route: string, body?: any, method = 'POST') {
  const response = await fetch(base + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  expect(response.ok, JSON.stringify(result)).toBeTruthy();
  return result;
}
async function waitJob(id: string) {
  let result: any;
  await expect.poll(async () => {
    const job = (await api('/api/jobs')).find((item: any) => item.id === id);
    if (job?.status === 'error') throw new Error(job.error);
    result = job?.result;
    return job?.status;
  }, { timeout: 150000, intervals: [250, 500, 1000] }).toBe('done');
  return result;
}
async function nav(name: string) {
  await page.locator('aside nav').getByRole('button', { name }).click();
  await expect(page.locator('main h1')).toHaveText(name === 'Dashboard' ? 'Great moments deserve an audience.' : name);
}
async function playback(video: Locator, start = 0, end?: number) {
  await video.scrollIntoViewIfNeeded();
  await video.evaluate(async (element: HTMLVideoElement) => { element.muted = true; await Promise.race([element.play(), new Promise((_, reject) => setTimeout(() => reject(new Error('Video play remained pending for 20 seconds')), 20000))]); });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 15000 }).toBeGreaterThan(start + .15);
  expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBeGreaterThan(0);
  if (end !== undefined) {
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused), { timeout: 15000 }).toBe(true);
    expect(await video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeLessThanOrEqual(end + .12);
  } else await video.evaluate((element: HTMLVideoElement) => element.pause());
}
async function uploadThroughUI(file: string) {
  await nav('Import Video');
  const panel = page.locator('.import-layout > section').first();
  await panel.getByRole('checkbox').check();
  await panel.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('status')).toContainText(`${path.basename(file)} imported.`, { timeout: 30000 });
  return (await api('/api/library')).find((item: any) => item.title === path.basename(file));
}
async function startServer() {
  server = spawn(process.execPath, ['server.mjs'], { cwd: root, windowsHide: true, env: { ...process.env, PORT: '3104', CLIPFORGE_DISABLE_NATIVE_UI: '1', DATA_DIR: workspace, MODEL_CACHE: path.join(root, 'data/models') } });
  server.stdout?.on('data', chunk => { serverLog += chunk; });
  server.stderr?.on('data', chunk => { serverLog += chunk; });
  await expect.poll(async () => { try { return (await fetch(base + '/api/version')).status; } catch { return 0; } }, { timeout: 20000 }).toBe(200);
}
async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const closed = new Promise(resolve => server.once('close', resolve));
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  else server.kill('SIGTERM');
  await closed;
}
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(artifacts, { recursive: true });
  command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30', '-i', path.join(root, 'data/test-speech.wav'), '-vf', "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='lt(t,3)+between(t,8,11)+gt(t,16)'", '-af', 'apad', '-t', '18', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture]);
  command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=1', '-t', '130', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', longFixture]);
  await startServer();
  context = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.goto(base);
});
test.afterEach(async ({}, info) => {
  if (info.status === 'passed') passes.push(info.title);
  else if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
});
test.afterAll(async () => {
  await fs.writeFile(path.join(artifacts, 'summary.json'), JSON.stringify({ passed: passes, runtimeErrors, downloads, gpuStatus, serverLog }, null, 2));
  if (context) { await context.tracing.stop({ path: path.join(artifacts, 'trace.zip') }); await context.close(); }
  await stopServer();
  expect(path.dirname(workspace)).toBe(path.join(root, 'data'));
  expect(path.basename(workspace)).toMatch(/^e2e-[0-9a-f-]{36}$/);
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('navigation, real engine health, and mobile layout', async () => {
  await page.goto(base);
  for (const name of ['Dashboard', 'Import Video', 'AI Highlights', 'Auto Editor', 'Video Editor', 'Compilations', 'My Projects', 'Exports', 'Settings']) await nav(name);
  await expect(page.locator('.setting-row').filter({ hasText: 'Faster-Whisper' })).toContainText('Ready');
  const health = await api('/api/health');
  expect(health.ffmpeg && health.ffprobe && health['yt-dlp'] && health.python).toBe(true);
  await nav('Dashboard');
  await page.screenshot({ path: path.join(artifacts, 'dashboard.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Dashboard', 'Import Video', 'Video Editor', 'Settings']) {
    await nav(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `Overflow on ${name}`).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: path.join(artifacts, 'mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect(runtimeErrors).toEqual([]);
});

test('video and music upload through the browser', async () => {
  await nav('Import Video');
  const panel = page.locator('.import-layout > section').first();
  await panel.locator('input[type=file]').setInputFiles(fixture);
  await expect(page.getByRole('status')).toContainText('Confirm your media rights');
  source = await uploadThroughUI(fixture);
  expect(source.width).toBe(640);
  const audio = path.join(workspace, 'Licensed music.wav');
  await fs.copyFile(path.join(root, 'data/test-speech.wav'), audio);
  music = await uploadThroughUI(audio);
  expect(music.kind).toBe('audio');
  await expect(page.locator('.media-card').filter({ hasText: source.title }).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
});

test('paste a link, choose 3:4, add and preview every manual range, retain review after reload', async () => {
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${source.id}`);
  await expect(page.locator('.link-detected')).toBeVisible({ timeout: 30000 });
  await page.getByLabel('How to find moments').selectOption('manual');
  await page.getByLabel('Video format').selectOption('3:4');
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
  await page.getByRole('button', { name: 'Open timestamp review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review every moment' })).toBeVisible({ timeout: 30000 });
  const manual = page.locator('.manual-range-form');
  for (const [start, end] of [['00:00:01', '00:00:03'], ['5', '8'], ['10', '12']]) {
    await manual.getByLabel(/Start/).fill(start);
    await manual.getByLabel(/End/).fill(end);
    await manual.getByRole('button', { name: 'Add range to review' }).click();
  }
  await expect(page.locator('.moment-card')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Export selected moments' })).toBeDisabled();
  for (const [index, range] of [[1, 3], [5, 8], [10, 12]].entries()) await playback(page.locator('.moment-player video').nth(index), range[0], range[1]);
  await expect(page.getByText('3 candidates · 3 previewed')).toBeVisible();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'review.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('.moment-card')).toHaveCount(3);
  await expect(page.getByLabel('Video format')).toHaveValue('3:4');
  await expect(page.locator('.moment-card input[type=checkbox]:checked')).toHaveCount(3);
});

test('reviewed 3:4 exports play and each MP4 downloads with correct codecs and timing', async () => {
  await page.getByRole('button', { name: 'Export selected moments' }).click();
  await expect(page.getByRole('heading', { name: 'Reviewed exports ready' })).toBeVisible({ timeout: 120000 });
  const outputs = page.locator('.moment-review .link-output');
  await expect(outputs).toHaveCount(3);
  for (let index = 0; index < 3; index++) {
    await playback(outputs.nth(index).locator('video'));
    const downloadEvent = page.waitForEvent('download');
    await outputs.nth(index).getByRole('link', { name: 'Download MP4' }).click();
    const download = await downloadEvent;
    const destination = path.join(workspace, `download-${index}.mp4`);
    await download.saveAs(destination);
    const info = JSON.parse(command('ffprobe', ['-v', 'quiet', '-show_streams', '-show_format', '-of', 'json', destination]));
    const video = info.streams.find((stream: any) => stream.codec_type === 'video');
    const audio = info.streams.find((stream: any) => stream.codec_type === 'audio');
    expect([video.width, video.height, video.codec_name, audio.codec_name]).toEqual([1080, 1440, 'h264', 'aac']);
    expect(Math.abs(Number(info.format.duration) - [2, 3, 2][index])).toBeLessThan(.2);
    expect(Math.abs(Number(video.start_time) - Number(audio.start_time))).toBeLessThan(.1);
    downloads.push(download.suggestedFilename());
  }
});

test('automatic peak detection has previews for every candidate and waits for selection', async () => {
  await nav('Auto Editor');
  await page.locator('.source-select').selectOption({ value: source.id });
  await page.getByLabel('How to find moments').selectOption('auto');
  await page.getByLabel('Transcribe speech for ranking and subtitles').check();
  await page.getByRole('button', { name: 'Detect moments for preview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ready to review', exact: true })).toBeVisible({ timeout: 90000 });
  const updated = (await api('/api/library')).find((item: any) => item.id === source.id);
  expect(updated.analysis.highlights.length).toBeGreaterThan(0);
  await expect(page.locator('.moment-player video')).toHaveCount(updated.analysis.highlights.length);
  await expect(page.locator('.moment-card input[type=checkbox]:checked')).toHaveCount(0);
  for (let index = 0; index < updated.analysis.highlights.length; index++) await playback(page.locator('.moment-player video').nth(index));
  await nav('AI Highlights');
  await expect(page.locator('.moment-player video')).toHaveCount(updated.analysis.highlights.length);
});

test('editor trim, split, reorder, undo, redo, title, captions, audio, save and reopen', async () => {
  await page.locator('.moment-card').first().getByRole('button', { name: 'Edit this range' }).click();
  await expect(page.locator('main h1')).toHaveText('Video Editor');
  await page.getByLabel('Project title').fill('Browser verified project');
  await page.getByLabel('In point (seconds)').fill('1');
  await page.getByLabel('Out point (seconds)').fill('5');
  const preview = page.locator('#root .video-stage video');
  await preview.evaluate(async (element: HTMLVideoElement) => { element.load(); await new Promise<void>(resolve => { if (element.readyState >= 1) resolve(); else element.addEventListener('loadedmetadata', () => resolve(), { once: true }); }); element.currentTime = 3; });
  await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.currentTime)).toBe(3);
  await page.getByTitle('Split at playhead', { exact: true }).click();
  await expect(page.locator('.scene-block')).toHaveCount(2);
  await page.getByTitle('Undo', { exact: true }).click();
  await expect(page.locator('.scene-block')).toHaveCount(1);
  await page.getByTitle('Redo', { exact: true }).click();
  await expect(page.locator('.scene-block')).toHaveCount(2);
  await page.locator('.scene-block').nth(1).dragTo(page.locator('.scene-block').nth(0));
  await expect(page.locator('.scene-block').first()).toContainText('0:03');
  await page.getByRole('button', { name: 'Title', exact: true }).click();
  await page.locator('.scene-block').last().click();
  await page.getByLabel('Title card text').fill('Browser title card');
  await page.getByLabel('Duration').fill('1');
  await page.locator('.scene-block').first().click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await expect(page.locator('.caption-edit')).not.toHaveCount(0);
  await page.locator('.caption-edit textarea').first().fill('Verified editable caption');
  await page.getByRole('button', { name: 'Save transcript', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Transcript saved');
  await page.getByLabel('Style').selectOption('karaoke');
  await page.getByLabel('Position').selectOption('top');
  await page.getByLabel('Font').selectOption('Arial');
  await page.getByLabel('Size (output pixels)').fill('42');
  await page.getByLabel('Caption color').fill('#ffdd00');
  const sourceSrt = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download source SRT' }).click();
  expect((await sourceSrt).suggestedFilename()).toMatch(/\.srt$/);
  await page.getByRole('button', { name: 'Audio', exact: true }).click();
  await page.getByLabel('Background music').selectOption(music.id);
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await page.getByLabel('Color effect').selectOption('warm');
  await page.getByLabel('Camera shake').check();
  await page.getByLabel('Playback speed').selectOption('1.25');
  await page.getByLabel('Scene transitions').selectOption('fade');
  await page.getByLabel('Text overlay').fill('Browser overlay');
  await page.getByLabel('Optional watermark').fill('Test creator');
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Canvas ratio').selectOption('3:4');
  await page.getByLabel('Resolution').selectOption('720');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Frame rate').selectOption('60');
  await page.getByLabel('Edited export quality').selectOption('high');
  await page.getByLabel('Bitrate (Mbps)').fill('3');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Project saved');
  await page.screenshot({ path: path.join(artifacts, 'editor.png'), fullPage: true });
  await page.reload();
  await nav('My Projects');
  await page.locator('.project-row').filter({ hasText: 'Browser verified project' }).click();
  await expect(page.locator('.scene-block')).toHaveCount(3);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByLabel('Frame rate')).toHaveValue('60');
  const request = page.waitForResponse(response => response.url().endsWith('/api/export') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Render timeline', exact: true }).click();
  const job = await (await request).json();
  const output = await waitJob(job.id);
  expect([output.width, output.height]).toEqual([720, 960]);
  const info = JSON.parse(command('ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', path.join(workspace, output.file)]));
  expect(info.streams[0].r_frame_rate).toBe('60/1');
});

test('custom canvas ratio can be entered and rendered', async () => {
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Canvas ratio').selectOption('custom');
  await expect(page.getByLabel('Custom width:height')).toBeVisible();
  await page.getByLabel('Custom width:height').fill('5:4');
  await page.getByRole('button', { name: 'Save project', exact: true }).click();
  const saved = (await api('/api/projects')).find((item: any) => item.title === 'Browser verified project');
  expect(saved.timeline.ratio).toBe('5:4');
});

test('compilation selection, previews and export use reviewed source footage', async () => {
  await nav('Compilations');
  await expect(page.locator('.compilation-range-preview')).not.toHaveCount(0);
  await page.getByRole('button', { name: 'Select matching', exact: true }).click();
  await page.getByLabel('Video title').fill('Browser compilation');
  await page.getByLabel('Target duration').selectOption('20');
  await page.getByLabel('Canvas ratio').selectOption('16:9');
  await page.getByLabel('Resolution').selectOption('720');
  const response = page.waitForResponse(response => response.url().endsWith('/api/compilation') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create compilation', exact: true }).click();
  const job = await (await response).json();
  expect((await waitJob(job.id)).kind).toBe('export');
  await nav('Exports');
  const card = page.locator('.media-card').filter({ hasText: 'Browser compilation' });
  await expect(card).toBeVisible({ timeout: 20000 });
  await playback(card.locator('video'));
  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await downloadEvent).suggestedFilename()).toMatch(/Browser compilation.*\.mp4$/);
  for (const format of ['SRT', 'VTT']) {
    const event = page.waitForEvent('download');
    await card.getByRole('link', { name: format, exact: true }).click();
    expect((await event).suggestedFilename().toLowerCase()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
  }
});

test('all ratios, presets, export resolutions, and error validation produce real media', async () => {
  for (const [ratio, width, height] of [['9:16', 360, 640], ['3:4', 360, 480], ['16:9', 640, 360], ['1:1', 360, 360], ['4:5', 360, 450], ['5:4', 450, 360]] as const) {
    const result = await waitJob((await api('/api/export', { sourceId: source.id, start: 4, end: 4.5, ratio, resolution: 360, preset: 'clean' })).id);
    expect([result.width, result.height]).toEqual([width, height]);
  }
  const hashes = [];
  for (const preset of ['clean', 'viral', 'cinematic', 'funny', 'action']) {
    const result = await waitJob((await api('/api/export', { sourceId: source.id, start: 4, end: 5, ratio: '16:9', resolution: 360, preset })).id);
    hashes.push(command('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', path.join(workspace, result.file), '-frames:v', '1', '-f', 'hash', '-hash', 'md5', '-']).trim());
  }
  expect(new Set(hashes).size).toBe(5);
  for (const resolution of [720, 1080, 1440, 2160]) {
    const result = await waitJob((await api('/api/export', { sourceId: source.id, start: 4, end: 4.25, ratio: '16:9', resolution, preset: 'clean' })).id);
    expect(result.height).toBe(resolution);
  }
  const large = await uploadThroughUI(longFixture);
  for (const ratio of ['9:16', '3:4']) {
    const response = await fetch(base + '/api/review/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: large.id, ranges: [{ start: 0, end: 121 }], options: { ratio } }) });
    expect(response.status).toBe(400);
  }
  expect(runtimeErrors).toEqual([]);
});

test('server restart preserves projects and media and reconnects the browser', async () => {
  const before = await api('/api/stats');
  await stopServer();
  await startServer();
  await page.reload();
  await nav('My Projects');
  await expect(page.locator('.project-row').filter({ hasText: 'Browser verified project' })).toBeVisible();
  const after = await api('/api/stats');
  expect(after.imported).toBe(before.imported);
  expect(after.exports).toBe(before.exports);
  expect(runtimeErrors).toEqual([]);
});

test('uploads pause, resume after reload, and cancel incomplete files', async () => {
  const large = path.join(workspace, 'Resumable fixture.mp4');
  await fs.writeFile(large, Buffer.concat([await fs.readFile(fixture), Buffer.alloc(25 * 1024 * 1024)]));
  await nav('Import Video');
  let panel = page.locator('.import-layout > section').first();
  await panel.getByRole('checkbox').check();
  await page.route('**/api/uploads/*', async route => {
    if (route.request().method() === 'PATCH') await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await panel.locator('input[type=file]').setInputFiles(large);
  await expect(panel.locator('.upload-status')).toBeVisible();
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Upload paused');
  const uploadId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('clipforge-upload:Resumable fixture.mp4:'))!;
    return localStorage.getItem(key)!;
  });
  const checkpoint = await api(`/api/uploads/${uploadId}`);
  expect(checkpoint.offset).toBeGreaterThan(0);
  expect(checkpoint.offset).toBeLessThan(checkpoint.size);
  await page.reload();
  await nav('Import Video');
  panel = page.locator('.import-layout > section').first();
  await panel.getByRole('checkbox').check();
  const chunk = page.waitForRequest(request => request.method() === 'PATCH' && request.url().endsWith(uploadId));
  await panel.locator('input[type=file]').setInputFiles(large);
  expect((await chunk).headers()['upload-offset']).toBe(String(checkpoint.offset));
  await expect(page.getByRole('status')).toContainText('Resumable fixture.mp4 imported.', { timeout: 30000 });
  const cancelFile = path.join(workspace, 'Cancelled fixture.mp4');
  await fs.copyFile(large, cancelFile);
  await panel.locator('input[type=file]').setInputFiles(cancelFile);
  await expect(panel.locator('.upload-status')).toBeVisible();
  await panel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Upload paused');
  await panel.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Upload cancelled');
  await expect(panel.locator('.upload-status')).toHaveCount(0);
  await page.unroute('**/api/uploads/*');
});

test('subtitle import, invalid timestamp handling, and mobile layouts with media', async () => {
  await nav('My Projects');
  await page.locator('.project-row').filter({ hasText: 'Browser verified project' }).click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  const srt = '1\n00:00:01,000 --> 00:00:04,000\nImported browser caption\n';
  await page.locator('input[type=file][accept=".srt"]').setInputFiles({ name: 'captions.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.locator('.caption-edit textarea').first()).toHaveValue('Imported browser caption');
  await page.getByRole('button', { name: 'Save transcript', exact: true }).click();
  const refreshed = (await api('/api/library')).find((item: any) => item.id === source.id);
  expect(refreshed.transcript.segments[0].text).toBe('Imported browser caption');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Video Editor', 'AI Highlights', 'Compilations', 'Exports']) {
    await nav(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `Loaded media overflow on ${name}`).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nav('Auto Editor');
  await page.locator('.source-select').selectOption({ value: source.id });
  await page.getByLabel('How to find moments').selectOption('manual');
  await page.getByLabel('Video format').selectOption('3:4');
  await page.getByRole('button', { name: 'Open timestamp review', exact: true }).click();
  const form = page.locator('.manual-range-form');
  await form.getByLabel(/Start/).fill('1');
  await form.getByLabel(/End/).fill('3');
  await form.getByRole('button', { name: 'Add range to review' }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const end = page.locator('.moment-card').first().getByRole('textbox',{name:/^End/});
  await end.fill('0');
  await end.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Keep start before end');
  await expect(page.getByRole('button', { name: 'Export selected moments' })).toBeDisabled();
  await end.fill('4');
  await end.press('Tab');
  await expect(page.getByRole('button', { name: 'Export selected moments' })).toBeEnabled();
});

test('failed jobs retry successfully and queued and active jobs cancel through the UI', async () => {
  const stored = (await api('/api/library')).find((item: any) => item.id === source.id);
  const mediaFile = path.join(workspace, stored.file);
  await fs.rename(mediaFile, `${mediaFile}.missing`);
  let failed: any;
  try {
    failed = await api('/api/proxy', { sourceId: source.id });
    await expect.poll(async () => (await api('/api/jobs')).find((item: any) => item.id === failed.id)?.status).toBe('error');
  } finally { await fs.rename(`${mediaFile}.missing`, mediaFile); }
  await nav('Exports');
  const row = page.locator('.job').filter({ hasText: 'Create browser preview' }).filter({ hasText: 'Failed' }).first();
  await expect(row).toBeVisible();
  const retried = page.waitForResponse(response => response.url().endsWith(`/api/retry/${failed.id}`));
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  const retriedJob = await (await retried).json();
  expect((await waitJob(retriedJob.id)).proxy).toMatch(/proxy\.mp4$/);
  const large = (await api('/api/library')).find((item: any) => item.title === path.basename(longFixture));
  const running = await api('/api/export', { sourceId: large.id, start: 0, end: 120, ratio: '16:9', resolution: 1440, fps: 60, preset: 'viral', shake: true, title: 'Cancellation target' });
  const queued = await api('/api/export', { sourceId: source.id, start: 0, end: 1, ratio: '16:9', resolution: 720, preset: 'clean', title: 'Queued cancellation target' });
  const queuedRow = page.locator('.job').filter({ hasText: 'Queued cancellation target' }).filter({ hasText: 'queued' });
  await expect(queuedRow).toBeVisible();
  await queuedRow.getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect.poll(async () => (await api('/api/jobs')).find((item: any) => item.id === queued.id)?.status).toBe('cancelled');
  const activeRow = page.locator('.job').filter({ hasText: 'Cancellation target' });
  await activeRow.getByRole('button', { name: 'Cancel job', exact: true }).click();
  await expect.poll(async () => (await api('/api/jobs')).find((item: any) => item.id === running.id)?.status).toBe('cancelled');
});

test('NVENC encoding or a clear hardware error and CPU export recovery', async () => {
  const gpu = await api('/api/export', { sourceId: source.id, start: 4, end: 4.5, ratio: '16:9', resolution: 720, preset: 'clean', encoder: 'nvenc', quality: 'high' });
  let current: any;
  await expect.poll(async () => { current = (await api('/api/jobs')).find((item: any) => item.id === gpu.id); return ['done', 'error'].includes(current?.status); }, { timeout: 30000 }).toBe(true);
  if (current.status === 'done') gpuStatus = 'NVENC rendered successfully';
  else {
    expect(current.error).toMatch(/cuda|nvenc|driver|device|OpenEncodeSession/i);
    gpuStatus = 'NVENC unavailable on this machine; hardware error verified';
  }
  const cpu = await waitJob((await api('/api/export', { sourceId: source.id, start: 4, end: 4.5, ratio: '16:9', resolution: 720, preset: 'clean', encoder: 'cpu' })).id);
  expect(cpu.kind).toBe('export');
});

for (const [name, url, live] of [
  ['YouTube video', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', false],
  ['YouTube live stream', 'https://www.youtube.com/watch?v=M3HKLzjvKPc', true]
] as const) {
  test(`online browser workflow for ${name}`, async () => {
    test.skip(process.env.E2E_ONLINE !== '1', 'Set E2E_ONLINE=1 to exercise public external videos.');
    await nav('Dashboard');
    await page.getByLabel('YouTube, live stream, or supported video link').fill(url);
    await expect(page.locator('.link-detected')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.link-detected')).toContainText(live ? 'LIVE' : 'Video');
    await page.getByLabel('How to find moments').selectOption('manual');
    await page.getByLabel('Video format').selectOption('3:4');
    if (!live) await page.getByLabel('Footage to inspect').selectOption('range');
    await page.getByLabel(live ? 'Record the live stream for (minutes)' : 'Section / live recording duration (minutes)').fill('1');
    await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
    await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
    const imported = page.waitForResponse(response => response.url().endsWith('/api/process-link') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Open timestamp review', exact: true }).click();
    const job = await (await imported).json();
    const review = await waitJob(job.id);
    expect(review.reviewRequired).toBe(true);
    expect(review.exports).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Review every moment' })).toBeVisible();
    const form = page.locator('.manual-range-form');
    await form.getByLabel(/Start/).fill('0');
    await form.getByLabel(/End/).fill('2');
    await form.getByRole('button', { name: 'Add range to review' }).click();
    await playback(page.locator('.moment-player video').last(), 0, 2);
    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await page.getByRole('button', { name: 'Export selected moments' }).click();
    await expect(page.getByRole('heading', { name: 'Reviewed exports ready' })).toBeVisible({ timeout: 90000 });
    await playback(page.locator('.rendered-clip-preview').last());
    const downloadEvent = page.waitForEvent('download');
    await page.locator('.moment-review').getByRole('link', { name: 'Download MP4', exact: true }).last().click();
    const download = await downloadEvent;
    const destination = path.join(workspace, `${live ? 'live' : 'video'}-online.mp4`);
    await download.saveAs(destination);
    const info = JSON.parse(command('ffprobe', ['-v', 'quiet', '-show_streams', '-of', 'json', destination]));
    expect([info.streams[0].width, info.streams[0].height]).toEqual([1080, 1440]);
    downloads.push(`${name}: ${download.suggestedFilename()}`);
  });
}

test('pasted source plays immediately and the player prepares the exact chosen range', async () => {
  const item = source || await uploadThroughUI(fixture);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  const player = page.locator('.source-player');
  await expect(player.locator('video')).toBeVisible();
  await playback(player.locator('video'));
  await page.getByLabel('Video format').selectOption('3:4');
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
  await player.getByLabel(/Clip start/).fill('4');
  await player.getByLabel(/Clip end/).fill('6');
  await player.getByRole('button', { name: 'Preview selected range', exact: true }).click();
  await playback(player.locator('video'), 4, 6);
  const response = page.waitForResponse(response => response.url().endsWith('/api/process-link') && response.request().method() === 'POST');
  await player.getByRole('button', { name: 'Prepare selected clip', exact: true }).click();
  const message = await response;
  expect(message.request().postDataJSON()).toMatchObject({ manualClip: true, start: 4, duration: 2, ratio: '3:4' });
  const result = await waitJob((await message.json()).id);
  expect(result.manualRanges).toHaveLength(1);
  expect(result.manualRanges[0].end).toBe(2);
  await expect(page.locator('.moment-card')).toHaveCount(1);
  await expect(page.locator('.moment-card').getByRole('textbox',{name:'Start',exact:true})).toHaveValue('00:00:04');
  await expect(page.locator('.moment-card').getByRole('textbox',{name:/^End/})).toHaveValue('00:00:06');
});

test('streamed playback starts without importing and releases its session on navigation', async () => {
  const item = source || await uploadThroughUI(fixture);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  const response = page.waitForResponse(response => response.url().endsWith('/api/playback') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Use streamed player', exact: true }).click();
  const message = await response;
  const session = await message.json();
  expect(message.ok(), JSON.stringify(session)).toBe(true);
  const video = page.locator('.source-player video');
  await playback(video);
  const manifest = await fetch(base + session.url);
  expect(manifest.headers.get('content-type')).toContain('mpegurl');
  expect(await manifest.text()).toContain('#EXTINF:');
  await nav('Settings');
  await expect.poll(async () => (await fetch(`${base}/api/playback/${session.id}/keepalive`, { method: 'POST' })).status).toBe(404);
});

test('YouTube live viewing and finishing a user-sized recording before its timer', async () => {
  test.skip(process.env.E2E_ONLINE !== '1', 'Requires a public live source.');
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill('https://www.youtube.com/watch?v=M3HKLzjvKPc');
  await expect(page.locator('.source-player-screen')).toBeVisible();
  await expect(page.locator('.link-detected')).toContainText('LIVE', { timeout: 60000 });
  await expect(page.locator('.source-player .player-status')).toContainText('Playing', { timeout: 60000 });
  await page.getByLabel('Video format').selectOption('3:4');
  await page.getByLabel('Maximum short-clip length').selectOption('120');
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
  const response = page.waitForResponse(response => response.url().endsWith('/api/process-link') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Record next 120 seconds', exact: true }).click();
  const job = await (await response).json();
  await expect.poll(async () => {
    const current = (await api('/api/jobs')).find((item: any) => item.id === job.id);
    return current?.phase === 'record' && current.progress > 0;
  }, { timeout: 60000 }).toBe(true);
  await page.getByRole('button', { name: 'Finish recording now', exact: true }).click();
  const result = await waitJob(job.id);
  const recorded = (await api('/api/library')).find((item: any) => item.id === result.sourceId);
  expect(recorded.duration).toBeGreaterThan(0);
  expect(recorded.duration).toBeLessThan(120);
  expect(result.manualRanges).toHaveLength(1);
  await expect(page.locator('.moment-player video')).toHaveCount(1);
  await playback(page.locator('.moment-player video'));
});


test('watching controls rewind and mark a range; buffered segments produce an exact MP4', async () => {
  const item = source || await uploadThroughUI(fixture);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  const player = page.locator('.source-player');
  const video = player.locator('video');
  await playback(video);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 12; });
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(12, 0);
  await player.getByRole('button', { name: 'Back 10 seconds', exact: true }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeCloseTo(2, 0);
  await page.waitForTimeout(150);
  await player.getByRole('button', { name: 'Mark clip start', exact: true }).click();
  await expect(player.getByLabel(/Clip start/)).toHaveValue('00:00:02');
  await player.getByRole('button', { name: 'Forward 5 seconds', exact: true }).click();
  await page.waitForTimeout(150);
  await player.getByRole('button', { name: 'Mark clip end', exact: true }).click();
  await expect(player.getByLabel(/Clip end/)).toHaveValue('00:00:07');
  await player.getByRole('button', { name: 'Preview selected range', exact: true }).click();
  await playback(video, 2, 7);
  const response = page.waitForResponse(response => response.url().endsWith('/api/playback') && response.request().method() === 'POST');
  await player.getByRole('button', { name: 'Use streamed player', exact: true }).click();
  const session = await (await response).json();
  await playback(video);
  await expect.poll(async () => {
    const text = await (await fetch(base + session.url)).text();
    return [...text.matchAll(/#EXTINF:([\d.]+)/g)].reduce((sum, match) => sum + Number(match[1]), 0);
  }, { timeout: 30000 }).toBeGreaterThanOrEqual(8);
  const denied = await fetch(`${base}/api/playback/${session.id}/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: 2, end: 7, ratio: '3:4' }) });
  expect(denied.ok).toBe(false);
  const outOfBuffer = await fetch(`${base}/api/playback/${session.id}/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: 100, end: 110, ratio: '3:4', rightsConfirmed: true }) });
  expect(outOfBuffer.ok).toBe(false);
  const queued = await api(`/api/playback/${session.id}/clip`, { start: 2, end: 7, ratio: '3:4', rightsConfirmed: true });
  await nav('Settings'); // Snapshot remains usable after the viewing session is released.
  const result = await waitJob(queued.id);
  const clip = (await api('/api/library')).find((entry: any) => entry.id === result.sourceId);
  expect(clip.duration).toBeGreaterThanOrEqual(5);
  expect(result.manualRanges[0].end - result.manualRanges[0].start).toBeCloseTo(5, 1);
  expect(command('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path.join(workspace, clip.file)])).toContain('h264');
});


test('live rewind marks and prepares a previously watched moment', async () => {
  test.skip(process.env.E2E_ONLINE !== '1', 'Requires a public live source.');
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill('https://www.youtube.com/watch?v=M3HKLzjvKPc');
  await expect(page.locator('.link-detected')).toContainText('LIVE', { timeout: 60000 });
  const player = page.locator('.source-player');
  await player.getByRole('button', { name: 'Enable rewind & clipping', exact: true }).click();
  const video = player.locator('video');
  await playback(video);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.seekable.length ? element.seekable.end(element.seekable.length - 1) : 0), { timeout: 45000 }).toBeGreaterThan(10);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 8; });
  await player.getByRole('button', { name: 'Back 5 seconds', exact: true }).click();
  await page.waitForTimeout(200);
  await player.getByRole('button', { name: 'Mark clip start', exact: true }).click();
  await expect(player.getByLabel(/Clip start/)).toHaveValue('00:00:03');
  await player.getByRole('button', { name: 'Forward 5 seconds', exact: true }).click();
  await page.waitForTimeout(200);
  await player.getByRole('button', { name: 'Mark clip end', exact: true }).click();
  await expect(player.getByLabel(/Clip end/)).toHaveValue('00:00:08');
  await player.getByRole('button', { name: 'Preview selected range', exact: true }).click();
  await playback(video, 3, 8);
  await page.getByLabel('Video format').selectOption('3:4');
  await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
  const response = page.waitForResponse(response => /\/api\/playback\/[^/]+\/clip$/.test(response.url()));
  await player.getByRole('button', { name: 'Prepare selected clip', exact: true }).click();
  const message = await response;
  expect(message.ok(), await message.text()).toBe(true);
  const result = await waitJob((await message.json()).id);
  expect(result.manualRanges[0].end - result.manualRanges[0].start).toBeCloseTo(5, 1);
  const clip = (await api('/api/library')).find((entry: any) => entry.id === result.sourceId);
  expect(clip.duration).toBeGreaterThanOrEqual(4.9);
  expect(clip.captureQuality).toBe('source-copy');
  await playback(page.locator('.moment-player video'));
});

test('blocked YouTube controls recover into playable streamed video', async () => {
  test.skip(process.env.E2E_ONLINE !== '1', 'Requires public video access.');
  await page.reload();
  await nav('Dashboard');
  await page.route('https://www.youtube.com/iframe_api', route => route.abort());
  try {
    await page.getByLabel('YouTube, live stream, or supported video link').fill(process.env.E2E_VIDEO_URL || 'https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    const player = page.locator('.source-player');
    await expect(player).toHaveAttribute('data-player-mode', 'stream', { timeout: 30000 });
    await playback(player.locator('video'));
    await player.locator('video').evaluate((element: HTMLVideoElement) => element.play());
    await expect(player.locator('.player-status')).toContainText('Playing');
  } finally {
    if (!page.isClosed()) await page.unroute('https://www.youtube.com/iframe_api');
  }
});


test('original-quality download retains native 720p60, identical decoded frames and audio packets through the rewind buffer', async () => {
  const qualityFixture = path.join(workspace, 'Native 720p60.mp4');
  command('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=60', '-f', 'lavfi', '-i', 'sine=f=440:r=48000', '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-g', '60', '-c:a', 'aac', qualityFixture]);
  const item = await uploadThroughUI(qualityFixture);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  const response = page.waitForResponse(response => response.url().endsWith('/api/playback') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Use streamed player', exact: true }).click();
  const session = await (await response).json();
  const preview = page.locator('.source-player video');
  await playback(preview);
  expect(await preview.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(960);
  await expect.poll(async () => {
    const response = await fetch(`${base}/api/playback/${session.id}/clip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: 2, end: 5, rightsConfirmed: true, ratio: '16:9' }) });
    if (!response.ok) return null;
    const result = await waitJob((await response.json()).id);
    return result;
  }, { timeout: 30000, intervals: [1000] }).not.toBeNull();
  const recorded = (await api('/api/library')).find((entry: any) => entry.sourceUrl === `${base}/media/${item.id}` && entry.captureQuality === 'source-copy');
  expect(recorded.width).toBe(1280);
  expect(recorded.height).toBe(720);
  expect(recorded.fps).toBe(60);
  const packetHashes = (file: string, stream: string) => JSON.parse(command('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_packets', '-show_entries', 'packet=data_hash', '-show_data_hash', 'sha256', '-of', 'json', file])).packets.map((packet: any) => packet.data_hash);
  const frameHashes = (file: string) => command('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-an', '-fps_mode', 'passthrough', '-f', 'framemd5', '-']).split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split(',').at(-1)?.trim());
  const originalFrames = new Set(frameHashes(qualityFixture));
  const originalAudio = new Set(packetHashes(qualityFixture, 'a:0'));
  const assertOriginalPackets = (file: string) => {
    const frames = frameHashes(file);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every(hash => originalFrames.has(hash)), 'Decoded video pixels must match source frames exactly').toBe(true);
    const audio = packetHashes(file, 'a:0');
    expect(audio.length).toBeGreaterThan(0);
    expect(audio.every((hash: string) => originalAudio.has(hash)), 'Encoded AAC packets must remain unchanged').toBe(true);
  };
  assertOriginalPackets(path.join(workspace, recorded.file));
  // A fractional start verifies that original copying reports its keyframe-aligned boundary.
  await nav('AI Highlights');
  await page.locator('.source-select').selectOption({ value: recorded.id });
  const manual = page.locator('.manual-range-form');
  await manual.getByLabel(/Start/).fill(String(recorded.sourceStart + .4));
  await manual.getByLabel(/End/).fill(String(recorded.sourceStart + 2.5));
  await manual.getByRole('button', { name: 'Add range to review' }).click();
  await page.getByLabel('Moment title').fill('Unchanged original');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const originalResponse = page.waitForResponse(response => response.url().endsWith('/api/review/original') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Download original-quality clips', exact: true }).click();
  const job = await (await originalResponse).json();
  const result = await waitJob(job.id);
  const original = result.exports[0];
  expect(original.quality).toBe('original');
  expect(original.actualStart).toBeLessThanOrEqual(.4);
  expect(original.width).toBe(1280);
  expect(original.height).toBe(720);
  expect(original.fps).toBe(60);
  assertOriginalPackets(path.join(workspace, original.file));
  await nav('Exports');
  const card = page.locator('.media-card').filter({ has: page.getByRole('heading', { name: 'Unchanged original', exact: true }) });
  await playback(card.locator('video'));
  const download = page.waitForEvent('download');
  await card.getByRole('link', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mp4$/);
});


test('manual live preview updates instantly; AI edits titles and captions; rendered preview matches the edited timeline', async () => {
  const editingFixture = path.join(workspace, 'Editing preview fixture.mp4');
  await fs.copyFile(fixture, editingFixture);
  const item = await uploadThroughUI(editingFixture);
  await nav('Import Video');
  await page.locator('.media-card').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manual edit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Auto-refresh rendered preview').uncheck();
  const video = page.locator('.edit-live-canvas video');
  await playback(video);
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 4; });
  await page.getByLabel('Color effect').selectOption('mono');
  await expect.poll(() => video.evaluate(element => getComputedStyle(element).filter)).toContain('grayscale(1)');
  await page.getByLabel('Motion zoom', { exact: true }).uncheck();
  await page.getByLabel('Camera shake', { exact: true }).check();
  await expect.poll(() => video.evaluate(element => element.style.transform)).toContain('scale(1.04)');
  await page.getByLabel('Text overlay', { exact: true }).fill('Visible while editing');
  await expect(page.locator('.edit-live-heading')).toHaveText('Visible while editing');
  await page.getByLabel('Optional watermark').fill('Live creator');
  await expect(page.locator('.edit-live-watermark')).toHaveText('Live creator');
  await page.getByLabel('Playback speed').selectOption('1.5');
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(1.5);
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Canvas ratio').selectOption('3:4');
  await expect.poll(async () => { const box = await page.locator('.edit-live-canvas').boundingBox(); return box!.width / box!.height; }).toBeCloseTo(.75, 1);
  await page.getByRole('button', { name: 'AI automatic edit', exact: true }).click();
  await page.getByLabel('Add a two-second intro card').check();
  const response = page.waitForResponse(response => response.url().endsWith('/api/editor/auto') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Apply AI automatic edit', exact: true }).click();
  const automatic = await waitJob((await (await response).json()).id);
  expect(automatic.timeline.clips[0].type).toBe('title');
  expect(automatic.timeline.overlay.length).toBeGreaterThan(0);
  expect(automatic.timeline.subtitles).toContain('-->');
  await expect(page.locator('.scene-block')).toHaveCount(2);
  await expect(page.getByLabel('Project title')).toHaveValue(automatic.timeline.title);
  await page.locator('.scene-block').last().click();
  await page.getByRole('button', { name: 'Manual edit', exact: true }).click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await expect(page.getByLabel('Automatic captions (editable SRT)')).toHaveValue(automatic.timeline.subtitles);
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await page.getByLabel('Text overlay').fill('AI edit, 100% manually adjusted');
  await expect(page.locator('.edit-live-heading')).toHaveText('AI edit, 100% manually adjusted');
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/preview') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Render exact preview', exact: true }).click();
  const rendered = await waitJob((await (await previewResponse).json()).id);
  expect([rendered.width, rendered.height]).toEqual([360, 480]);
  expect(rendered.subtitleCount).toBeGreaterThan(0);
  expect((await api('/api/library')).some((entry: any) => entry.id === rendered.id)).toBe(false);
  await playback(page.locator('.exact-preview video'));
  await page.getByLabel('Auto-refresh rendered preview').check();
  const refreshResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/preview') && response.request().method() === 'POST');
  await page.getByLabel('Text overlay').fill('Automatic preview refresh');
  const refreshed = await waitJob((await (await refreshResponse).json()).id);
  expect(refreshed.id).not.toBe(rendered.id);
  await expect(page.locator('.edit-live-heading')).toHaveText('Automatic preview refresh');
  await page.getByLabel('Auto-refresh rendered preview').uncheck();
  await page.screenshot({ path: path.join(artifacts, 'live-edit-preview.png'), fullPage: true });
});


test('file controls save unchanged bytes, reveal the library path, protect references, trash, restore and permanently delete', async () => {
  const file = path.join(workspace, 'Managed video fixture.mp4');
  await fs.copyFile(fixture, file);
  const item = await uploadThroughUI(file);
  await nav('Import Video');
  const card = page.locator('.media-card').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) });
  const revealResponse = page.waitForResponse(response => response.url().endsWith(`/api/files/${item.id}/reveal`));
  await card.getByRole('button', { name: 'Show in folder', exact: true }).click();
  const revealed = await (await revealResponse).json();
  expect(revealed.testMode).toBe(true);
  expect(path.dirname(revealed.path)).toBe(workspace);
  expect(await fs.stat(revealed.path)).toBeTruthy();
  await page.evaluate(() => {
    (window as any).__savedBytes = [];
    (window as any).showSaveFilePicker = async (options: any) => ({ name: options.suggestedName, createWritable: async () => new WritableStream({ write(chunk) { for (const byte of chunk) (window as any).__savedBytes.push(byte); } }) });
  });
  await card.getByRole('button', { name: /^Save as/ }).click();
  await expect(card.locator('.file-message')).toContainText('Saved a copy');
  const saved = Buffer.from(await page.evaluate(() => (window as any).__savedBytes));
  expect(saved.equals(await fs.readFile(revealed.path))).toBe(true);
  await page.evaluate(() => { (window as any).showSaveFilePicker = undefined; });
  const downloaded = page.waitForEvent('download');
  await card.getByRole('button', { name: /^Save as/ }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.mp4$/);
  const project = await api('/api/projects', { title: 'Protected managed video', timeline: { ratio: '16:9', clips: [{ id: randomUUID(), sourceId: item.id, start: 0, end: 2 }] } });
  await card.getByRole('button', { name: 'Delete video', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete video', exact: true });
  await expect(dialog).toContainText('Protected managed video');
  await expect(dialog.getByRole('button', { name: 'Move to trash', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const denied = await fetch(`${base}/api/files/${item.id}`, { method: 'DELETE' });
  expect(denied.ok).toBe(false);
  await page.reload();
  await nav('My Projects');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.project-list>div').filter({ hasText: 'Protected managed video' }).getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect.poll(async () => (await api('/api/projects')).some((entry: any) => entry.id === project.id)).toBe(false);
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path.join(workspace, 'clipforge.sqlite'));
  const busyJob = { id: randomUUID(), type: 'proxy', status: 'running', label: 'Active file user', payload: { sourceId: item.id } };
  db.prepare('INSERT INTO records VALUES (?, ?, ?)').run('jobs', busyJob.id, JSON.stringify(busyJob));
  const inUse = await fetch(`${base}/api/files/${item.id}`, { method: 'DELETE' });
  expect(inUse.ok).toBe(false);
  expect((await inUse.json()).error).toContain('jobs using this video');
  db.prepare('DELETE FROM records WHERE collection=? AND id=?').run('jobs', busyJob.id);
  db.close();
  await nav('Import Video');
  await card.getByRole('button', { name: 'Delete video', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await fetch(`${base}/media/${item.id}`)).ok).toBe(false);
  await nav('Settings');
  const trashed = page.locator('.trash-row').filter({ hasText: item.title });
  await expect(trashed).toBeVisible();
  await trashed.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(trashed).toHaveCount(0);
  await nav('Import Video');
  await expect(card).toBeVisible();
  expect((await fs.readFile(revealed.path)).equals(saved)).toBe(true);
  await card.getByRole('button', { name: 'Delete video', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move to trash', exact: true }).click();
  await nav('Settings');
  const entry = (await api('/api/trash')).find((entry: any) => entry.id === item.id);
  expect(entry).toBeTruthy();
  const unconfirmed = await fetch(`${base}/api/trash/${item.id}`, { method: 'DELETE' });
  expect(unconfirmed.ok).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await trashed.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await expect(trashed).toHaveCount(0);
  expect(await fs.stat(path.join(workspace, 'trash', item.id)).then(() => true, () => false)).toBe(false);
  expect(await fs.stat(file).then(() => true, () => false)).toBe(true); // Original uploaded file is independent.
});


test('GTA VI speech subtitles retain word timing, animate in preview, and burn into MP4 with the bundled font', async () => {
  const file = path.join(workspace, 'Neon speech fixture.mp4');
  await fs.copyFile(fixture, file);
  const item = await uploadThroughUI(file);
  await nav('Import Video');
  await page.locator('.media-card').filter({ has: page.getByRole('heading', { name: item.title, exact: true }) }).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Auto-refresh rendered preview').uncheck();
  await page.getByLabel('Out point (seconds)').fill('12');
  await page.getByLabel('Playback speed').selectOption('1.25');
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Canvas ratio').selectOption('3:4');
  await page.getByLabel('Resolution').selectOption('720');
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  const speechResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/captions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Generate GTA VI subtitles', exact: true }).click();
  const generated = await waitJob((await (await speechResponse).json()).id);
  expect(generated.wordCount).toBeGreaterThan(2);
  const words = generated.captionSegments.flatMap((line: any) => line.words || []);
  expect(words.every((word: any) => word.start >= 0 && word.end <= 9.61)).toBe(true);
  await expect(page.getByLabel('Style')).toHaveValue('gta6');
  await expect(page.getByLabel('Font')).toHaveValue('Anton');
  await expect(page.getByLabel('Subtitle animation')).toHaveValue('word-pop');
  await expect(page.getByLabel('Automatic captions (editable SRT)')).toHaveValue(generated.subtitles);
  const video = page.locator('.edit-live-canvas video');
  const word = words[0];
  const next = words.find((candidate: any) => candidate.text !== word.text);
  await video.evaluate((element: HTMLVideoElement, point: number) => { element.pause(); element.currentTime = point; }, (word.start + word.end) / 2 * 1.25);
  await expect(page.locator('.neon-word')).toHaveText(word.text);
  await expect(page.locator('.neon-word')).toHaveCSS('animation-name', 'neonWordPop');
  await video.evaluate((element: HTMLVideoElement, point: number) => { element.pause(); element.currentTime = point; }, (next.start + next.end) / 2 * 1.25);
  await expect(page.locator('.neon-word')).toHaveText(next.text);
  await page.getByLabel('Subtitle animation').selectOption('highlight');
  await expect(page.locator('.caption-gta6 [data-active="true"]')).toHaveText(next.text + ' ');
  await page.getByLabel('Subtitle animation').selectOption('word-pop');
  const font = await fetch(`${base}/fonts/Anton-Regular.ttf`);
  expect(font.ok).toBe(true);
  expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(100000);
  const response = page.waitForResponse(response => response.url().endsWith('/api/editor/preview') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Render exact preview', exact: true }).click();
  const rendered = await waitJob((await (await response).json()).id);
  expect(rendered.timeline.options.captionSegments[0].words.length).toBeGreaterThan(0);
  await playback(page.locator('.exact-preview video'));
  const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/export') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const output = await waitJob((await (await exportResponse).json()).id);
  expect([output.width, output.height]).toEqual([720, 960]);
  expect(output.timeline.options.captionStyle).toBe('gta6');
  expect(output.subtitleCount).toBeGreaterThan(0);
  const midpoint = (word.start + word.end) / 2;
  const image = path.join(artifacts, 'gta-vi-subtitles.png');
  command('ffmpeg', ['-y', '-v', 'error', '-ss', String(midpoint), '-i', path.join(workspace, output.file), '-frames:v', '1', image]);
  const plain = await waitJob((await api('/api/export', { ...output.timeline.options, clips: output.timeline.clips, captions: false })).id);
  const frameHash = (file: string) => command('ffmpeg', ['-v', 'error', '-ss', String(midpoint), '-i', path.join(workspace, file), '-frames:v', '1', '-f', 'md5', '-']);
  expect(frameHash(output.file)).not.toBe(frameHash(plain.file));
  const automatic = await waitJob((await api('/api/editor/auto', { ...output.timeline.options, clips: output.timeline.clips })).id);
  expect(automatic.timeline.captionStyle).toBe('gta6');
  expect(automatic.timeline.captionSegments[0].words.length).toBeGreaterThan(0);
});


test('57-second recording keeps full duration, source 720p60 and lossless frames through AI, preview and editor downloads', async () => {
  test.setTimeout(360000);
  const file = path.join(workspace, '57 second recorded gameplay.mp4');
  command('ffmpeg', ['-y','-v','error','-f','lavfi','-i','color=c=0x26548a:s=1280x720:r=60','-f','lavfi','-i','sine=f=440:r=48000','-vf',"drawgrid=w=40:h=40:t=1:c=0x66ccff,drawbox=x=900:y=400:w=300:h=250:color=red:t=fill:enable='gte(t,40)'",'-t','57','-c:v','libx264','-preset','ultrafast','-crf','14','-g','60','-c:a','aac',file]);
  const item = await uploadThroughUI(file);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox', { name: /I own this media/ }).check();
  const player = page.locator('.source-player');
  await player.getByLabel(/Clip start/).fill('0');
  await player.getByLabel(/Clip end/).fill('57');
  const prepare = page.waitForResponse(response => response.url().endsWith('/api/process-link') && response.request().method() === 'POST');
  await player.getByRole('button', { name: 'Prepare selected clip', exact: true }).click();
  await waitJob((await (await prepare).json()).id);
  await page.locator('.moment-card').first().getByRole('button', { name: 'Edit this range', exact: true }).click();
  await page.getByLabel('Auto-refresh rendered preview').uncheck();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await page.getByLabel('Canvas ratio').selectOption('source');
  await page.getByLabel('Frame rate').selectOption('0');
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await page.getByRole('button', { name: /Clean Gameplay/ }).click();
  await page.getByRole('button', { name: 'AI automatic edit', exact: true }).click();
  await page.getByLabel('Generate speech captions', { exact: true }).uncheck();
  await page.getByLabel('Add a heading overlay', { exact: true }).uncheck();
  await page.getByLabel('Normalize speech audio', { exact: true }).uncheck();
  await page.getByLabel('AI motion').selectOption('gentle');
  await expect(page.getByLabel('Add a two-second intro card')).not.toBeChecked();
  const automaticResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/auto') && response.request().method() === 'POST');
  const previewResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/preview') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Apply AI automatic edit', exact: true }).click();
  const automatic = await waitJob((await (await automaticResponse).json()).id);
  expect(automatic.footageSeconds).toBeCloseTo(57, 0);
  expect(automatic.titleSeconds).toBe(0);
  expect(automatic.timeline.clips).toHaveLength(1);
  expect(automatic.timeline.clips[0].end - automatic.timeline.clips[0].start).toBeCloseTo(57, 0);
  const preview = await waitJob((await (await previewResponse).json()).id);
  expect([preview.width, preview.height, preview.fps]).toEqual([1280,720,60]);
  expect(preview.duration).toBeGreaterThan(56.9);
  expect(preview.duration).toBeLessThan(57.2);
  expect(preview.quality).toBe('lossless-edited');
  await playback(page.locator('.exact-preview video'));
  expect(await page.locator('.exact-preview video').evaluate((element: HTMLVideoElement) => (element as any).webkitAudioDecodedByteCount)).toBeGreaterThan(0);
  const previewDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download full-quality preview MP4', exact: true }).click();
  await (await previewDownload).saveAs(path.join(artifacts,'57-second-preview.mp4'));
  const reference = path.join(workspace, (await api('/api/library')).find((entry: any) => entry.id === automatic.timeline.clips[0].sourceId).file);
  const hash = (video: string, point: string) => command('ffmpeg',['-v','error','-ss',point,'-i',video,'-map','0:v:0','-an','-frames:v','1','-pix_fmt','yuv420p','-f','md5','-']);
  expect(hash(path.join(workspace,preview.file),'50')).toBe(hash(reference,'50'));
  const exportResponse = page.waitForResponse(response => response.url().endsWith('/api/export') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Export video', exact: true }).click();
  const output = await waitJob((await (await exportResponse).json()).id);
  expect([output.width,output.height,output.fps]).toEqual([1280,720,60]);
  expect(output.duration).toBeGreaterThan(56.9);
  await expect(page.locator('.delivery-file')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('.delivery-file').getByRole('link', { name: 'Download full-quality MP4', exact: true }).click();
  await (await download).saveAs(path.join(artifacts,'57-second-edited.mp4'));
  expect(hash(path.join(workspace,output.file),'50')).toBe(hash(reference,'50'));
  const originalResponse = page.waitForResponse(response => response.url().endsWith('/api/editor/original') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Prepare source-quality downloads', exact: true }).click();
  const originals = await waitJob((await (await originalResponse).json()).id);
  expect(originals.exports[0].quality).toBe('original');
  expect(originals.exports[0].duration).toBeGreaterThan(56.9);
  await expect(page.locator('.delivery-file')).toContainText('Original streams');
  await page.reload();
  await nav('Video Editor');
  await expect(page.locator('.delivery-file')).toContainText('Original streams');

});


test('advanced manual controls update live transforms and render rotation, mirror, color and sharpening', async () => {
  const file = path.join(workspace,'Advanced editing fixture.mp4');
  await fs.copyFile(fixture,file);
  const item = await uploadThroughUI(file);
  await nav('Import Video');
  await page.locator('.media-card').filter({ has: page.getByRole('heading',{ name:item.title,exact:true }) }).getByRole('button',{name:'Edit',exact:true}).click();
  await page.getByLabel('Auto-refresh rendered preview').uncheck();
  const video=page.locator('.edit-live-canvas video');
  await playback(video);
  await video.evaluate((element:HTMLVideoElement)=>{element.currentTime=4;});
  async function slider(label:string,value:string) {
    await page.getByLabel(label,{exact:true}).evaluate((element:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);
  }
  await slider('Brightness','0.2');await slider('Contrast','1.3');await slider('Saturation','1.5');await slider('Sharpen','0.5');
  await expect.poll(()=>video.evaluate(element=>getComputedStyle(element).filter)).toContain('brightness(1.2)');
  await page.getByLabel('Rotation').selectOption('90');
  await page.getByLabel('Mirror horizontally',{exact:true}).check();
  await page.getByLabel('Vignette',{exact:true}).check();
  await expect.poll(()=>video.evaluate(element=>element.style.transform)).toContain('rotate(90deg)');
  await expect(page.locator('.live-vignette')).toBeVisible();
  const response=page.waitForResponse(response=>response.url().endsWith('/api/editor/preview')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Render exact preview',exact:true}).click();
  const result=await waitJob((await(await response).json()).id);
  expect([result.width,result.height,result.fps]).toEqual([360,640,30]);
  expect(result.timeline.options).toMatchObject({rotation:90,mirror:true,vignette:true,brightness:.2,contrast:1.3,saturation:1.5,sharpen:.5});
  await playback(page.locator('.exact-preview video'));
  await page.getByRole('button',{name:'Reset fine adjustments',exact:true}).click();
  await expect(page.getByLabel('Rotation')).toHaveValue('0');
  await expect(page.getByLabel('Brightness',{exact:true})).toHaveValue('0');
  await expect(page.getByLabel('Mirror horizontally',{exact:true})).not.toBeChecked();
  await expect(page.locator('.live-vignette')).toHaveCount(0);
});


test('legacy saved projects reopen at source dimensions and FPS with working lossless editor downloads', async () => {
  const file=path.join(workspace,'Legacy 720p60 recording.mp4');
  command('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=blue:s=1280x720:r=60','-t','1','-c:v','libx264','-preset','ultrafast',file]);
  const source=await uploadThroughUI(file);
  await api('/api/projects',{title:'Legacy quality settings',timeline:{title:'Legacy quality settings',quality:'high',encoder:'nvenc',bitrate:3,ratio:'16:9',resolution:360,fps:30,preset:'clean',effect:'none',zoom:false,fade:false,normalize:false,clips:[{id:randomUUID(),sourceId:source.id,start:0,end:1}]}});
  await page.reload();await nav('My Projects');
  await page.locator('.project-row').filter({hasText:'Legacy quality settings'}).click();
  await page.getByRole('button',{name:'Export',exact:true}).click();
  await expect(page.getByLabel('Edited export quality')).toHaveValue('lossless');
  await expect(page.getByLabel('Canvas ratio')).toHaveValue('source');
  await expect(page.getByLabel('Frame rate')).toHaveValue('0');
  await expect(page.getByLabel('Encoder')).toHaveValue('cpu');
  const response=page.waitForResponse(response=>response.url().endsWith('/api/export')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Export video',exact:true}).click();
  const output=await waitJob((await(await response).json()).id);
  expect([output.width,output.height,output.fps,output.quality]).toEqual([1280,720,60,'lossless-edited']);
  await expect(page.locator('.delivery-file').getByRole('link',{name:'Download full-quality MP4',exact:true})).toBeVisible();
});

test('Snap Ninja additions: blurred framing, face fallback, generated ducked music, progressive captions and dual exports', async () => {
  const item = await uploadThroughUI(fixture);
  const generated = await waitJob((await api('/api/music/generate', {})).id);
  expect(generated.kind).toBe('audio');
  expect(generated.duration).toBeGreaterThan(31);
  const segments = [{ start: 0, end: 3, text: 'One two three four five six', words: ['One','two','three','four','five','six'].map((text, index) => ({ text, start: index * .5, end: (index + 1) * .5 })) }];
  await api(`/api/transcript/${item.id}`, { segments }, 'PUT');
  const common = { title: 'Snap additions', qualityPolicyVersion: 2, sourceCanvas: false, quality: 'lossless', ratio: '3:4', resolution: 360, fps: 0, preset: 'clean', effect: 'none', fit: 'blur', captions: true, captionStyle: 'gta6', captionFont: 'Anton', captionSize: 36, captionAnimation: 'reveal', captionUppercase: false, captionMaxWords: 3, musicId: generated.id, musicVolume: .15, musicDuck: true, clips: [{ id: randomUUID(), sourceId: item.id, start: 0, end: 3 }] };
  await api('/api/projects', { title: 'Snap additions', timeline: common });
  await page.reload();
  await nav('My Projects');
  await page.locator('.project-row').filter({ hasText: 'Snap additions' }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.getByRole('combobox', {name:'Framing', exact:true})).toHaveValue('blur');
  await expect(page.locator('.edit-live-canvas video')).toHaveCount(2);
  const foreground = page.locator('.edit-live-canvas video[controls]');
  await playback(foreground);
  await page.getByRole('button', {name:'Captions',exact:true}).click();
  await expect(page.getByLabel('Words per caption')).toHaveValue('3');
  await expect(page.getByLabel('Subtitle animation')).toHaveValue('reveal');
  await foreground.evaluate((video: HTMLVideoElement) => { video.currentTime = 1.2; });
  await expect(page.locator('.preview-caption')).toContainText('One two three');
  const output = await waitJob((await api('/api/export', common)).id);
  expect([output.width,output.height,output.fps,output.quality]).toEqual([360,480,30,'lossless-edited']);
  const streams = JSON.parse(command('ffprobe',['-v','quiet','-show_streams','-of','json',path.join(workspace,output.file)])).streams;
  expect(streams.find((stream:any)=>stream.codec_type==='audio').codec_name).toBe('aac');
  await nav('Exports');
  await page.goto(`${base}/media/${output.id}`);
  await playback(page.locator('video'));
  await page.goto(base);
  const framed = await waitJob((await api('/api/export', {...common, fit:'auto-face', captions:false, musicId:''})).id);
  expect([framed.width,framed.height]).toEqual([360,480]);
  const dual = await waitJob((await api('/api/review/export', {sourceId:item.id,ranges:[{start:0,end:2,title:'Both formats'}],options:{preset:'clean',effect:'none',fit:'blur',resolution:360,fps:0,captions:false},transcribe:false,dualFormat:true})).id);
  expect(dual.exports.map((media:any)=>[media.width,media.height])).toEqual([[360,640],[640,360]]);
  expect(runtimeErrors).toEqual([]);
});

test('batch local folder import, remembered byte-identical exports, ratings and optional account guards', async () => {
  const inputFolder=path.join(workspace,'batch-input');const outputFolder=path.join(workspace,'saved-exports');
  await fs.mkdir(inputFolder);await fs.mkdir(outputFolder);
  await fs.copyFile(fixture,path.join(inputFolder,'Batch one.mp4'));
  await fs.copyFile(fixture,path.join(inputFolder,'Batch two.mp4'));
  await nav('Import Video');
  const panel=page.locator('details').filter({has:page.locator('summary',{hasText:'Import a local file or folder'})});
  await panel.locator('summary').click();
  await panel.getByLabel('Absolute file or folder path').fill(inputFolder);
  await panel.getByRole('checkbox').check();
  const importResponse=page.waitForResponse(response=>response.url().endsWith('/api/import-path')&&response.request().method()==='POST');
  await panel.getByRole('button',{name:'Import file or folder',exact:true}).click();
  const imported=await waitJob((await(await importResponse).json()).id);
  expect(imported.imported).toHaveLength(2);
  expect(await fs.readFile(path.join(workspace,imported.imported[0].file))).toEqual(await fs.readFile(fixture));
  await nav('Settings');
  await page.getByLabel('Existing output folder (absolute path)').fill(outputFolder);
  await page.getByRole('button',{name:'Remember output folder',exact:true}).click();
  await expect(page.getByText('Saved. Applies to newly queued jobs.',{exact:true})).toBeVisible();
  const item=imported.imported[0];
  await api(`/api/transcript/${item.id}`,{segments:[{start:0,end:2,text:'Batch caption fixture'}]},'PUT');
  const job=await api('/api/batch-captions',{sourceIds:[item.id]});
  await api('/api/output-folder',{folder:''});
  const batch=await waitJob(job.id);
  const output=batch.exports[0];
  expect([output.width,output.height,output.fps,output.quality]).toEqual([640,360,30,'lossless-edited']);
  expect(output.duration).toBeGreaterThan(17.9);
  expect(output.savedCopyPath.startsWith(path.join(outputFolder,job.id))).toBe(true);
  expect(await fs.readFile(output.savedCopyPath)).toEqual(await fs.readFile(path.join(workspace,output.file)));
  await api('/api/ratings',{sourceId:item.id,start:0,end:2,title:'Batch moment',rating:'good'});
  expect((await api('/api/ratings')).find((rating:any)=>rating.sourceId===item.id).rating).toBe('good');
  await page.reload();await nav('Settings');
  await expect(page.getByLabel('Existing output folder (absolute path)')).toHaveValue('');
  await expect(page.getByRole('heading',{name:'Optional local semantic review'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'YouTube account (optional)'})).toBeVisible();
  expect((await api('/api/youtube/status')).connected).toBe(false);
  const badCredentials=await fetch(base+'/api/youtube/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credentials:{apiKey:'not-oauth'}})});
  expect(badCredentials.status).toBe(400);
  const denied=await fetch(base+'/api/youtube/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mediaId:output.id,title:'Do not upload',privacy:'private',publishConfirmed:false})});
  expect(denied.status).toBe(400);
  await nav('Exports');
  await page.getByText('Publish a reviewed export to YouTube',{exact:true}).click();
  await expect(page.getByText('Connect your YouTube channel in Settings first.',{exact:true})).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('quick clipping shortcuts, timestamp nudges, feedback and dual-format controls work in the browser',async()=>{
  const file=path.join(workspace,'Quick clipping fixture.mp4');await fs.copyFile(fixture,file);
  const item=await uploadThroughUI(file);
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  await page.getByLabel('Video format').selectOption('3:4');
  await page.getByLabel('Edited export resolution').selectOption('720');
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox',{name:/I own this media/}).check();
  const player=page.locator('.source-player');const video=player.locator('video');
  await playback(video);
  await video.evaluate((element:HTMLVideoElement)=>{element.pause();element.currentTime=10;});
  await expect(player.getByText('Player time 00:00:10',{exact:true})).toBeVisible();
  await player.getByRole('button',{name:'Select last 30s',exact:true}).click();
  await expect(player.getByLabel(/Clip start/)).toHaveValue('00:00:00');
  await expect(player.getByLabel(/Clip end/)).toHaveValue('00:00:10');
  await page.locator('h1').click();await page.keyboard.press('i');
  await expect(player.getByLabel(/Clip start/)).toHaveValue('00:00:10');
  await video.evaluate((element:HTMLVideoElement)=>{element.currentTime=14;});
  await expect(player.getByText('Player time 00:00:14',{exact:true})).toBeVisible();
  await page.keyboard.press('o');
  await expect(player.getByLabel(/Clip end/)).toHaveValue('00:00:14');
  const response=page.waitForResponse(response=>response.url().endsWith('/api/process-link')&&response.request().method()==='POST');
  await page.keyboard.press('c');
  const job=await(await response).json();expect(job.payload).toMatchObject({start:10,duration:4});
  await waitJob(job.id);
  const card=page.locator('.moment-card');await expect(card).toHaveCount(1);
  await card.getByRole('button',{name:'start +1 seconds',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Start',exact:true})).toHaveValue('00:00:11');
  await card.getByRole('button',{name:'start -1 seconds',exact:true}).click();
  await expect(card.getByRole('textbox',{name:'Start',exact:true})).toHaveValue('00:00:10');
  await card.getByRole('button',{name:'Good moment',exact:true}).click();
  await expect(card.getByRole('button',{name:'Good moment',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Select all',exact:true}).click();
  await page.getByLabel('Export both 9:16 and 16:9 for every selected moment').check();
  const exported=page.waitForResponse(response=>response.url().endsWith('/api/review/export')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Export selected moments',exact:true}).click();
  const outputs=await waitJob((await(await exported).json()).id);
  expect(outputs.exports.map((item:any)=>[item.width,item.height])).toEqual([[720,1280],[1280,720]]);
  await page.screenshot({path:path.join(artifacts,'snap-ninja-controls.png'),fullPage:true});
  expect(runtimeErrors).toEqual([]);
});

test('edited downloads have audible compatible audio and legacy repair preserves video and lossless sound',async()=>{
  const item=await uploadThroughUI(fixture);
  const timeline={title:'Audible edited download',preset:'clean',effect:'warm',sourceCanvas:true,quality:'lossless',fps:0,captions:false,volume:1,normalize:false,clips:[{id:randomUUID(),sourceId:item.id,start:0,end:4}]};
  const output=await waitJob((await api('/api/export',timeline)).id);
  const outputFile=path.join(workspace,output.file);
  const streams=JSON.parse(command('ffprobe',['-v','quiet','-show_streams','-of','json',outputFile])).streams;
  const audio=streams.filter((stream:any)=>stream.codec_type==='audio');
  expect(audio.map((stream:any)=>stream.codec_name)).toEqual(['aac','flac']);
  expect(audio.map((stream:any)=>stream.disposition.default)).toEqual([1,0]);
  expect([output.width,output.height,output.fps]).toEqual([640,360,30]);
  const legacyId=randomUUID();const legacyName=`${legacyId}.mp4`;const legacyFile=path.join(workspace,legacyName);
  command('ffmpeg',['-y','-v','error','-i',outputFile,'-map','0:v:0','-map','0:a:1','-c','copy','-strict','-2',legacyFile]);
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path.join(workspace,'clipforge.sqlite'));
  db.prepare('INSERT INTO records VALUES (?, ?, ?)').run('media',legacyId,JSON.stringify({...output,id:legacyId,file:legacyName,title:'Legacy lossless sound',audioCodec:'flac',audioCompatibilityVersion:undefined}));db.close();
  await page.reload();await nav('Exports');
  const current=page.locator('.media-card').filter({hasText:'Audible edited download'});
  const player=current.locator('video');await player.scrollIntoViewIfNeeded();await page.locator('h1').click();
  const signal=await player.evaluate(async(element:HTMLVideoElement)=>{
    const context=new AudioContext();const input=context.createMediaElementSource(element);const analyser=context.createAnalyser();const gain=context.createGain();gain.gain.value=0;input.connect(analyser);analyser.connect(gain);gain.connect(context.destination);
    await context.resume();element.muted=false;await element.play();const values=new Float32Array(analyser.fftSize);let peak=0;
    for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,50));analyser.getFloatTimeDomainData(values);peak=Math.max(peak,Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length));}
    element.pause();await context.close();return peak;
  });
  expect(signal,'The browser must decode non-silent sound from the default MP4 track').toBeGreaterThan(.005);
  const downloaded=page.waitForEvent('download');await current.getByRole('link',{name:'Download',exact:true}).click();const saved=path.join(artifacts,'audible-edited-download.mp4');await(await downloaded).saveAs(saved);
  expect(await fs.readFile(saved)).toEqual(await fs.readFile(outputFile));
  const legacy=page.locator('.media-card').filter({hasText:'Legacy lossless sound'});
  const response=page.waitForResponse(response=>response.url().endsWith('/api/audio-compatible')&&response.request().method()==='POST');
  await legacy.getByRole('button',{name:'Fix playback audio',exact:true}).click();
  const repair=await waitJob((await(await response).json()).id);
  await expect(legacy.getByRole('link',{name:'Download repaired MP4',exact:true})).toBeVisible();
  const repairedFile=path.join(workspace,repair.file);
  function hashes(file:string,stream:string){return command('ffmpeg',['-v','error','-i',file,'-map',stream,'-c','copy','-f','hash','-hash','sha256','-']).trim();}
  expect(hashes(repairedFile,'0:v:0')).toBe(hashes(legacyFile,'0:v:0'));
  expect(hashes(repairedFile,'0:a:1')).toBe(hashes(legacyFile,'0:a:0'));
  expect(runtimeErrors).toEqual([]);
});

test('online full-history playback seeks and clips the current Kick broadcast before joining',async()=>{
  test.skip(process.env.E2E_DVR_ONLINE!=='1','Requires the current public Kick broadcast');
  await nav('Dashboard');
  await page.getByLabel('YouTube, live stream, or supported video link').fill('https://kick.com/slim');
  await expect(page.locator('.link-detected')).toContainText('LIVE',{timeout:60000});
  await page.getByLabel('Transcribe speech for ranking and subtitles').uncheck();
  await page.locator('.link-workflow').getByRole('checkbox',{name:/I own this media/}).check();
  const player=page.locator('.source-player');
  const response=page.waitForResponse(response=>response.url().endsWith('/api/dvr')&&response.request().method()==='POST');
  await player.getByRole('button',{name:'View full live history',exact:true}).click();
  const session=await(await response).json();
  expect(session.error).toBeUndefined();expect(session.start).toBe(0);expect(session.end).toBeGreaterThan(1800);expect(session.fromBeginning).toBe(true);
  const video=player.locator('video');await playback(video);
  await player.getByLabel('Seek in broadcast history').fill('00:30:00');
  await player.getByRole('button',{name:'Seek to timestamp',exact:true}).click();
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime),{timeout:30000}).toBeGreaterThan(1800);
  await player.getByRole('button',{name:'Go to beginning',exact:true}).click();
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.currentTime),{timeout:30000}).toBeLessThan(15);
  await player.getByLabel(/Clip start/).fill('2');await player.getByLabel(/Clip end/).fill('6');
  const prepared=page.waitForResponse(response=>/\/api\/dvr\/[^/]+\/clip$/.test(response.url())&&response.request().method()==='POST');
  await player.getByRole('button',{name:'Prepare selected clip',exact:true}).click();
  const result=await waitJob((await(await prepared).json()).id);
  expect(result.manualRanges[0]).toMatchObject({start:2,end:6});
  const source=(await api('/api/library')).find((item:any)=>item.id===result.sourceId);
  expect(source.captureQuality).toBe('source-copy');expect(source.sourceStart).toBe(0);
  expect(source.width).toBeGreaterThanOrEqual(1280);expect(source.hasAudio).toBe(true);
  await playback(page.locator('.moment-player video'),2,6);
  await page.screenshot({path:path.join(artifacts,'full-broadcast-history.png'),fullPage:true});
  const liveResponse=page.waitForResponse(response=>response.url().endsWith('/api/playback')&&response.request().method()==='POST');
  await player.getByRole('button',{name:'Go live',exact:true}).click();
  expect((await(await liveResponse).json()).error).toBeUndefined();
  await expect(player).toHaveAttribute('data-player-mode','stream');
  await playback(player.locator('video'));
  await nav('Settings');
  expect(runtimeErrors).toEqual([]);
});

test('streamer voice reduction previews and exports game audio, with an exact separate-track option',async()=>{
  const file=path.join(workspace,'Voice and game tracks.mp4');
  const game='aevalsrc=0.08*sin(2*PI*220*t)+0.05*sin(2*PI*880*t)|0.08*sin(2*PI*330*t)+0.05*sin(2*PI*1320*t):s=44100:d=3';
  command('ffmpeg',['-y','-v','error','-i',fixture,'-f','lavfi','-i',game,'-filter_complex','[0:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.7[voice];[voice][1:a]amix=inputs=2:duration=shortest:normalize=0[mix]','-map','0:v:0','-map','[mix]','-map','1:a:0','-t','3','-c:v','copy','-c:a','flac','-strict','-2','-metadata:s:a:0','handler_name=Streamer and game','-metadata:s:a:1','handler_name=Game only',file]);
  const item=await uploadThroughUI(file);
  const timeline={title:'Game audio without streamer',qualityPolicyVersion:2,sourceCanvas:true,quality:'lossless',fps:0,preset:'clean',effect:'none',volume:1,normalize:false,captions:false,fit:'contain',sourceAudioTrack:0,reduceStreamerVoice:true,voiceReductionStrength:1,clips:[{id:randomUUID(),sourceId:item.id,start:0,end:3}]};
  await api('/api/projects',{title:timeline.title,timeline});await page.reload();await nav('My Projects');await page.locator('.project-row').filter({hasText:timeline.title}).click();
  await page.getByRole('button',{name:'Audio',exact:true}).click();
  await expect(page.getByLabel('Source audio track').locator('option')).toHaveCount(2);
  await expect(page.getByLabel('Reduce streamer voice with local AI')).toBeChecked();
  const preview=page.waitForResponse(response=>response.url().endsWith('/api/voice/preview')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Preview voice reduction (up to 10 seconds)',exact:true}).click();
  const sample=await waitJob((await(await preview).json()).id);
  await expect(page.getByLabel('Voice-reduced listening sample')).toBeVisible();
  await page.getByLabel('Voice-reduced listening sample').evaluate(async(element:HTMLAudioElement)=>{element.muted=true;await element.play();});
  await expect.poll(()=>page.getByLabel('Voice-reduced listening sample').evaluate((element:HTMLAudioElement)=>element.currentTime)).toBeGreaterThan(.1);
  const exported=page.waitForResponse(response=>response.url().endsWith('/api/export')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Export video',exact:true}).click();
  const output=await waitJob((await(await exported).json()).id);
  expect(output.timeline.options.reduceStreamerVoice).toBe(true);
  expect([output.width,output.height,output.fps]).toEqual([640,360,30]);
  const reducedPcm=path.join(workspace,'reduced.pcm');const mixedPcm=path.join(workspace,'mixed.pcm');const gamePcm=path.join(workspace,'game.pcm');
  command('ffmpeg',['-y','-v','error','-i',path.join(workspace,output.file),'-map','0:a:1','-f','f32le',reducedPcm]);
  command('ffmpeg',['-y','-v','error','-i',file,'-map','0:a:0','-f','f32le',mixedPcm]);
  command('ffmpeg',['-y','-v','error','-i',file,'-map','0:a:1','-f','f32le',gamePcm]);
  const measure=spawnSync(path.join(root,'tools/python/python.exe'),['-c','import numpy as np,sys,json; reduced,mixed,game=[np.fromfile(p,dtype="<f4") for p in sys.argv[1:]]; n=min(len(reduced),len(mixed),len(game)); speech=mixed[:n]-game[:n]; gains=np.linalg.lstsq(np.column_stack([speech,game[:n]]),reduced[:n],rcond=None)[0]; print(json.dumps({"speechGain":float(gains[0]),"gameGain":float(gains[1])}))',reducedPcm,mixedPcm,gamePcm],{encoding:'utf8',windowsHide:true});
  expect(measure.status,measure.stderr).toBe(0);const gains=JSON.parse(measure.stdout);
  expect(Math.abs(gains.speechGain)).toBeLessThan(.35);expect(gains.gameGain).toBeGreaterThan(.6);
  await fs.writeFile(path.join(artifacts,'voice-separation-measurement.json'),JSON.stringify(gains,null,2));
  await page.getByLabel('Reduce streamer voice with local AI').uncheck();await page.getByLabel('Source audio track').selectOption('1');
  const exact=page.waitForResponse(response=>response.url().endsWith('/api/export')&&response.request().method()==='POST');await page.getByRole('button',{name:'Export video',exact:true}).click();
  const gameOnly=await waitJob((await(await exact).json()).id);const exactPcm=path.join(workspace,'game-track-export.pcm');
  command('ffmpeg',['-y','-v','error','-i',path.join(workspace,gameOnly.file),'-map','0:a:1','-f','f32le',exactPcm]);
  expect(await fs.readFile(exactPcm)).toEqual(await fs.readFile(gamePcm));
  function videoHash(item:any){return command('ffmpeg',['-v','error','-i',path.join(workspace,item.file),'-map','0:v:0','-c','copy','-f','hash','-hash','sha256','-']).trim();}
  expect(videoHash(output)).toBe(videoHash(gameOnly));
  expect((await api('/api/library')).some((item:any)=>item.id===sample.id)).toBe(false);
  expect(runtimeErrors).toEqual([]);
});

test('select all bulk deletion confirms once, protects project sources, and restores deleted files',async()=>{
  const firstFile=path.join(workspace,'Bulk protected.mp4');const secondFile=path.join(workspace,'Bulk removable.mp4');await fs.copyFile(fixture,firstFile);await fs.copyFile(fixture,secondFile);
  const first=await uploadThroughUI(firstFile);const second=await uploadThroughUI(secondFile);
  await api('/api/projects',{title:'Keep this source',timeline:{preset:'clean',effect:'none',sourceCanvas:true,clips:[{sourceId:first.id,start:0,end:1}]}});
  const bulk=page.getByRole('region',{name:'Bulk video deletion'});
  await bulk.getByLabel('Select all',{exact:true}).check();await expect(bulk.getByText('2 selected',{exact:true})).toBeVisible();
  await bulk.getByRole('button',{name:'Clear selection',exact:true}).click();await expect(bulk.getByText('0 selected',{exact:true})).toBeVisible();
  await bulk.getByLabel('Select all',{exact:true}).check();await bulk.getByRole('button',{name:'Delete selected (2)',exact:true}).click();
  await page.getByRole('dialog',{name:'Delete selected videos'}).getByRole('button',{name:'Cancel',exact:true}).click();expect((await api('/api/library')).filter((item:any)=>[first.id,second.id].includes(item.id))).toHaveLength(2);
  await bulk.getByRole('button',{name:'Delete selected (2)',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Move selected to trash',exact:true}).click();
  await expect(bulk.getByRole('status')).toContainText('1 moved to trash. 1 could not be deleted.');await expect(bulk.getByRole('status')).toContainText('Keep this source');
  expect((await api('/api/library')).some((item:any)=>item.id===first.id)).toBe(true);expect((await api('/api/trash')).some((item:any)=>item.id===second.id)).toBe(true);
  await api(`/api/trash/${second.id}/restore`,{});expect(await fs.readFile(path.join(workspace,second.file))).toEqual(await fs.readFile(secondFile));
  for(let index=0;index<2;index++)await waitJob((await api('/api/export',{title:`Bulk export ${index}`,preset:'clean',effect:'none',sourceCanvas:true,captions:false,clips:[{sourceId:second.id,start:0,end:1}]})).id);
  await page.reload();await nav('Exports');const exportsBulk=page.getByRole('region',{name:'Bulk video deletion'});await exportsBulk.getByLabel('Select all',{exact:true}).check();await exportsBulk.getByRole('button',{name:'Delete selected (2)',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Move selected to trash',exact:true}).click();
  await expect(page.getByText('Your finished clips live here',{exact:true})).toBeVisible();expect((await api('/api/trash')).filter((item:any)=>item.title.startsWith('Bulk export'))).toHaveLength(2);
  expect((await api('/api/library')).some((item:any)=>item.id===second.id)).toBe(true);expect(runtimeErrors).toEqual([]);
});

test('delete all trash requires confirmation, preserves newly added trash, and removes confirmed files permanently',async()=>{
  const items=[];
  for(let index=0;index<3;index++){const file=path.join(workspace,`Empty trash ${index}.mp4`);await fs.copyFile(fixture,file);items.push(await uploadThroughUI(file));}
  for(const item of items.slice(0,2))await api(`/api/files/${item.id}`,{},'DELETE');
  const denied=await fetch(base+'/api/trash',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:items.slice(0,2).map(item=>item.id)})});expect(denied.status).toBe(400);
  await nav('Settings');const panel=page.locator('.trash-panel');await expect(panel.locator('.trash-row')).toHaveCount(2);
  page.once('dialog',dialog=>dialog.dismiss());await panel.getByRole('button',{name:'Delete all permanently (2)',exact:true}).click();expect(await api('/api/trash')).toHaveLength(2);
  page.once('dialog',async dialog=>{expect(dialog.message()).toContain('all 2 items');await api(`/api/files/${items[2].id}`,{},'DELETE');await dialog.accept();});
  await panel.getByRole('button',{name:'Delete all permanently (2)',exact:true}).click();
  await expect(panel).toContainText('2 permanently deleted.');await expect(panel.locator('.trash-row')).toHaveCount(1);expect((await api('/api/trash'))[0].id).toBe(items[2].id);
  for(const item of items.slice(0,2)){expect(await fs.stat(path.join(workspace,'trash',item.id)).then(()=>true,()=>false)).toBe(false);expect(await fs.readFile(path.join(workspace,item.title))).toEqual(await fs.readFile(fixture));}
  page.once('dialog',dialog=>dialog.accept());await panel.getByRole('button',{name:'Delete all permanently (1)',exact:true}).click();await expect(panel.getByText('Trash is empty.',{exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Delete all permanently (0)',exact:true})).toBeDisabled();
  expect(await api('/api/trash')).toHaveLength(0);expect(runtimeErrors).toEqual([]);
});

test('streamed player reconnects after connection failures and expired sessions without losing VOD clip marks',async()=>{
  const item=await uploadThroughUI(fixture);await nav('Dashboard');await page.getByLabel('YouTube, live stream, or supported video link').fill(`${base}/media/${item.id}`);
  const player=page.locator('.source-player');await playback(player.locator('video'));
  await player.getByLabel(/Clip start/).fill('2');await player.getByLabel(/Clip end/).fill('5');
  let attempts=0;const created:any[]=[];
  await page.route('**/api/playback',async route=>{if(route.request().method()!=='POST')return route.continue();attempts++;if(attempts<=2)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary fixture connection failure'})});const response=await route.fetch();const body=await response.json();created.push(body);await route.fulfill({response});});
  await player.getByRole('button',{name:'Use streamed player',exact:true}).click();
  await expect.poll(()=>created.length,{timeout:30000}).toBe(1);await playback(player.locator('video'));
  expect(attempts).toBe(3);await expect(player.getByLabel(/Clip start/)).toHaveValue('2');await expect(player.getByLabel(/Clip end/)).toHaveValue('5');
  await api(`/api/playback/${created[0].id}`,{},'DELETE');
  await expect.poll(()=>created.length,{timeout:35000}).toBeGreaterThan(1);await playback(player.locator('video'));
  await expect(player.getByLabel(/Clip start/)).toHaveValue('2');await expect(player.getByLabel(/Clip end/)).toHaveValue('5');await expect(player.locator('.link-error')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);await page.unroute('**/api/playback');
});

test('actual exported file sizes appear beside editor downloads, exact previews and export cards',async()=>{
  const item=await uploadThroughUI(fixture);
  await api('/api/projects',{title:'File size display',timeline:{title:'File size display',qualityPolicyVersion:2,preset:'clean',effect:'none',sourceCanvas:true,captions:false,clips:[{id:randomUUID(),sourceId:item.id,start:0,end:1}]}});
  await page.reload();await nav('My Projects');await page.locator('.project-row').filter({hasText:'File size display'}).click();
  const response=page.waitForResponse(response=>response.url().endsWith('/api/export')&&response.request().method()==='POST');await page.getByRole('button',{name:'Export video',exact:true}).click();const output=await waitJob((await(await response).json()).id);
  expect(output.size).toBe((await fs.stat(path.join(workspace,output.file))).size);
  const size=page.locator('.delivery-file .file-size');await expect(size).toHaveAttribute('title',`${output.size.toLocaleString('en-US')} bytes`);await expect(size).toContainText(/File size: [\d.]+ (KB|MB|GB)/);
  const previewResponse=page.waitForResponse(response=>response.url().endsWith('/api/editor/preview')&&response.request().method()==='POST');await page.getByRole('button',{name:'Render exact preview',exact:true}).click();const preview=await waitJob((await(await previewResponse).json()).id);
  await expect(page.locator('.exact-preview .file-size')).toHaveAttribute('title',`${preview.size.toLocaleString('en-US')} bytes`);
  await page.reload();await nav('Exports');await expect(page.locator('.media-card .file-size')).toHaveAttribute('title',`${output.size.toLocaleString('en-US')} bytes`);expect(runtimeErrors).toEqual([]);
});

test('show info opens real file details, copies its path and supports folder reveal and closing',async()=>{
  const item=await uploadThroughUI(fixture);const card=page.locator('.media-card').filter({hasText:item.title});await card.getByRole('button',{name:'Show info',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Video information'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('640 x 360 pixels');await expect(dialog).toContainText('Video codec: h264');await expect(dialog).toContainText(path.join(workspace,item.file));await expect(dialog.locator('.file-size')).toHaveAttribute('title',`${item.size.toLocaleString('en-US')} bytes`);
  await context.grantPermissions(['clipboard-read','clipboard-write']);await dialog.getByRole('button',{name:'Copy file path',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(path.join(workspace,item.file));
  const reveal=page.waitForResponse(response=>response.url().endsWith(`/api/files/${item.id}/reveal`));await dialog.getByRole('button',{name:'Show in folder',exact:true}).click();expect((await(await reveal).json()).path).toBe(path.join(workspace,item.file));await expect(dialog).toContainText('Library location:');
  await dialog.getByRole('button',{name:'Close info',exact:true}).click();await expect(dialog).toHaveCount(0);await card.getByRole('button',{name:'Show info',exact:true}).click();await page.getByRole('button',{name:'Close info',exact:true}).press('Escape');await expect(dialog).toHaveCount(0);
  const libraryFile=path.join(workspace,item.file);expect(path.dirname(libraryFile)).toBe(workspace);await fs.unlink(libraryFile);
  const missing=page.waitForResponse(response=>response.url().endsWith(`/api/files/${item.id}/reveal`));await card.getByRole('button',{name:'Show in folder',exact:true}).click();expect((await(await missing).json()).missing).toBe(true);await expect(card).toContainText('File missing from disk:');expect(runtimeErrors).toEqual([]);
});
