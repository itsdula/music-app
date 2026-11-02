import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build of the site (apps/site), served by
 * `vp preview` at http://localhost:3200 and built with base '/' (NAWA_BASE_PATH=/ in
 * `pnpm test:e2e`; GitHub Pages builds use '/nawa/'):
 *  - landing: the landing page at /, plus the portability smoke spec on /studio/
 *  - studio:  the Studio feature specs on /studio/ (see e2e/helpers.ts `openStudio`)
 * Chromium flags allow audio without a user gesture and fake microphone input.
 */
const CHROMIUM_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

const isCI = Boolean(process.env.CI);
const SITE_URL = 'http://localhost:3200';

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
    baseURL: SITE_URL,
  },
  projects: [
    { name: 'landing', testMatch: /(landing|portability)\.spec\.ts/ },
    { name: 'studio', testMatch: /studio\/.*\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @studio/site preview',
      url: SITE_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
