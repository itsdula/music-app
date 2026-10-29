import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against production builds of both hosts:
 *  - web:  Next.js (landing page + /studio)        http://localhost:3100
 *  - vite: standalone Vite host mounting <Studio /> http://localhost:3200
 * Studio feature specs run on the Vite host; portability smoke specs run on both.
 * Chromium flags allow audio without a user gesture and fake microphone input.
 */
const CHROMIUM_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: CHROMIUM_ARGS },
    permissions: ['microphone'],
  },
  projects: [
    {
      name: 'web',
      testMatch: /(landing|portability)\.spec\.ts/,
      use: { baseURL: 'http://localhost:3100' },
    },
    {
      name: 'vite',
      testMatch: /(studio\/.*|portability)\.spec\.ts/,
      use: { baseURL: 'http://localhost:3200' },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @studio/web start',
      url: 'http://localhost:3100',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @studio/vite-host preview',
      url: 'http://localhost:3200',
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
