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
          include: ['packages/*/tests/**/*.test.ts'],
          exclude: ['**/node_modules/**', 'packages/{ui,studio-react}/**', ...nonUnitSuffixes],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'react',
          environment: 'jsdom',
          include: ['packages/{ui,studio-react}/tests/**/*.test.{ts,tsx}'],
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
      exclude: ['**/src/generated/**', '**/index.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
