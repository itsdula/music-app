import { defineConfig } from 'vitest/config';

// Node-only tests for the orchestrator's pure modules (OTLP decoding, line parsing, log hub).
export default defineConfig({
  test: {
    name: 'dev-monitor',
    root: import.meta.dirname,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
