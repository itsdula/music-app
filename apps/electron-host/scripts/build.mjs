/* eslint-disable no-console -- CLI diagnostics */
// Builds the Electron host into dist/:
//   dist/main/main.js        main process (ESM, Node 24 / Electron 45)
//   dist/preload/preload.cjs sandboxed preload (CommonJS, `electron` external)
//   dist/probe/              security probe page (smoke tests; no Studio packages)
//   dist/renderer/           <Studio /> renderer (Vite, relative asset paths)
// Usage: node scripts/build.mjs [--skip-renderer]
// Optional build-time environment (see src/shared/build-defines.d.ts and docs/assistant.md):
//   STUDIO_ASSISTANT_URL    https URL of a Studio /api/assistant endpoint (http only for loopback)
//   STUDIO_ASSISTANT_TOKEN  shared secret for that endpoint (shipped in the renderer bundle)
// The renderer needs workspace codegen and @studio/react's CSS: prefer
// `pnpm turbo run build --filter=@studio/electron-host...` from the repo root.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appDir, 'src');
const dist = join(appDir, 'dist');
const skipRenderer = process.argv.includes('--skip-renderer');

/** Validates STUDIO_ASSISTANT_URL so a typo fails the build instead of shipping a broken CSP. */
function assistantUrlFromEnv() {
  const raw = process.env.STUDIO_ASSISTANT_URL?.trim() ?? '';
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`STUDIO_ASSISTANT_URL is not a valid URL: ${raw}`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('STUDIO_ASSISTANT_URL must use https: (http: is allowed only for localhost)');
  }
  if (url.username || url.password) {
    throw new Error('STUDIO_ASSISTANT_URL must not contain credentials');
  }
  return url.href;
}

const assistantUrl = assistantUrlFromEnv();
const assistantDefines = {
  __STUDIO_ASSISTANT_URL__: JSON.stringify(assistantUrl),
  __STUDIO_ASSISTANT_TOKEN__: JSON.stringify(
    assistantUrl ? (process.env.STUDIO_ASSISTANT_TOKEN?.trim() ?? '') : '',
  ),
};

const shared = { bundle: true, sourcemap: true, logLevel: 'warning', legalComments: 'none' };

async function buildHost() {
  await Promise.all(
    ['main', 'preload', 'probe'].map((d) => rm(join(dist, d), { recursive: true, force: true })),
  );
  await Promise.all([
    esbuild({
      ...shared,
      entryPoints: [join(src, 'main/main.ts')],
      outfile: join(dist, 'main/main.js'),
      platform: 'node',
      format: 'esm',
      target: 'node24',
      external: ['electron'],
      // Main needs only the URL (for the CSP); the token stays out of the main bundle.
      define: { __STUDIO_ASSISTANT_URL__: assistantDefines.__STUDIO_ASSISTANT_URL__ },
    }),
    esbuild({
      ...shared,
      entryPoints: [join(src, 'preload/preload.ts')],
      outfile: join(dist, 'preload/preload.cjs'),
      platform: 'node',
      format: 'cjs',
      target: 'chrome156',
      external: ['electron'],
    }),
    esbuild({
      ...shared,
      entryPoints: [join(src, 'probe/probe.ts')],
      outfile: join(dist, 'probe/probe.js'),
      platform: 'browser',
      format: 'esm',
      target: 'chrome156',
    }),
  ]);
  await mkdir(join(dist, 'probe'), { recursive: true });
  await copyFile(join(src, 'probe/index.html'), join(dist, 'probe/index.html'));
  console.log('built dist/main, dist/preload, dist/probe');
}

async function buildRenderer() {
  await viteBuild({
    configFile: false,
    root: join(src, 'renderer'),
    base: './',
    publicDir: false,
    logLevel: 'warn',
    plugins: [react()],
    define: assistantDefines,
    build: {
      outDir: join(dist, 'renderer'),
      emptyOutDir: true,
      target: 'chrome156',
      sourcemap: true,
      chunkSizeWarningLimit: 4096,
    },
  });
  console.log('built dist/renderer');
}

if (assistantUrl) console.log(`assistant endpoint: ${new URL(assistantUrl).origin}`);
await buildHost();
if (!skipRenderer) {
  try {
    await buildRenderer();
  } catch (error) {
    console.error('\nRenderer build failed (main, preload and probe were built).');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
