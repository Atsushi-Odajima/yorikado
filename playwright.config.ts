import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running DEMO app (npm run dev or npm start) + local Supabase.
 * WebKit runs only when PW_WEBKIT=1 and the WebKit browser is installed
 * (not available in the development container; see docs/TEST_REPORT.txt).
 */
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: base, trace: 'retain-on-failure', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    ...(process.env.PW_WEBKIT === '1' ? [{ name: 'webkit-iphone', use: { ...devices['iPhone 15'] } }] : []),
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: base + '/login', reuseExistingServer: true, timeout: 120_000 },
});
