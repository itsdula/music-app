import { defineConfig } from 'vitest/config';

// Node-only unit tests for the side-effect-free host modules (no Electron runtime needed).
export default defineConfig({
  test: {
    name: 'electron-host',
    root: import.meta.dirname,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
