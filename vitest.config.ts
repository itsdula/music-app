import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Test projects:
 *  - unit:        pure package tests in Node (`*.test.ts`)
 *  - react:       UI/component tests in jsdom (`*.test.tsx` in ui/studio-react)
 *  - integration: cross-module tests in Node (`*.integration.test.ts`)
 *  - contracts:   shared interface/golden-fixture suites (`*.contract.test.ts`)
 *  - browser:     real-Chromium tests for Web Audio/Web MIDI adapters (`*.browser.test.ts`)
 */
const CHROMIUM_ARGS = [
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
];

const nonUnitSuffixes = ['**/*.integration.test.*', '**/*.contract.test.*', '**/*.browser.test.*'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          // apps/electron-host/tests cover its pure main-process policy (no Electron runtime);
          // apps/web/tests cover the server-side assistant modules (no Next.js runtime);
          // apps/dev-monitor/tests cover the dev orchestrator's pure modules.
          include: [
            'packages/*/tests/**/*.test.ts',
            'apps/electron-host/tests/**/*.test.ts',
            'apps/web/tests/**/*.test.ts',
            'apps/dev-monitor/tests/**/*.test.ts',
          ],
          exclude: [
            '**/node_modules/**',
            'packages/{ui,audio-ui,studio-react}/**',
            ...nonUnitSuffixes,
          ],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['packages/{ui,audio-ui,studio-react}/tests/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', ...nonUnitSuffixes],
          setupFiles: ['./scripts/vitest-react-setup.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['packages/*/tests/**/*.integration.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['packages/*/tests/**/*.contract.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['packages/*/tests/**/*.browser.test.ts'],
          testTimeout: 30_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { args: CHROMIUM_ARGS } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      // audio-web runs only in real Chromium (the `browser` project), so Node coverage omits it.
      exclude: ['**/src/generated/**', '**/index.ts', '**/*.d.ts', 'packages/audio-web/src/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
