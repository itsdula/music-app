import { defineConfig } from 'vitest/config';

// Node-only tests for the server-side assistant modules (no Next.js runtime needed).
export default defineConfig({
  test: {
    name: 'web',
    root: import.meta.dirname,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
