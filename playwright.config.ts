import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { actionTimeout: 10000, navigationTimeout: 20000, browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 } }
});
