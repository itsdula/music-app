import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite-plus';

/**
 * Nawa website: two static pages, both built here.
 *   index.html         the landing page
 *   studio/index.html  the full-height <Studio /> (no URL routes: views are React state)
 *
 * Production builds are served from GitHub Pages at https://itsdula.github.io/nawa/, so the
 * base path defaults to '/nawa/'. NAWA_BASE_PATH overrides it (the e2e build uses '/'), and the
 * dev server always uses '/'. Code builds links and asset URLs from import.meta.env.BASE_URL.
 */
const DEFAULT_BASE_PATH = '/nawa/';

/** Normalises a base path to '/', or '/segment/' with leading and trailing slashes. */
function normaliseBasePath(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}

/**
 * The React and Tailwind plugins are typed against the `vite` package, while Vite+ ships its
 * own Vite build (@voidzero-dev/vite-plus-core) with structurally equal but separate types;
 * comparing the two exceeds TypeScript's depth limit. The runtime plugin API is the same.
 */
const plugins = [react(), tailwindcss()] as unknown as PluginOption[];

export default defineConfig(({ command }) => ({
  base:
    command === 'serve' && process.env.NAWA_BASE_PATH === undefined
      ? '/'
      : normaliseBasePath(process.env.NAWA_BASE_PATH ?? DEFAULT_BASE_PATH),
  plugins,
  server: {
    port: 3000,
    // `pnpm dev` (apps/dev-monitor, STUDIO_DEV=1): forward every browser console level to the
    // terminal as `[console.<level>]`, where the dev monitor picks it up. Other runs keep
    // Vite's default.
    ...(process.env.STUDIO_DEV === '1'
      ? {
          forwardConsole: {
            unhandledErrors: true,
            logLevels: ['error', 'warn', 'info', 'log', 'debug'],
          },
        }
      : {}),
  },
  preview: { port: 3200, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The Studio entry is one large chunk by design (the whole DAW); don't warn about it.
    chunkSizeWarningLimit: 4096,
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        studio: resolve(import.meta.dirname, 'studio/index.html'),
      },
    },
  },
}));
