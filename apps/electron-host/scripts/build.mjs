/* eslint-disable no-console -- CLI diagnostics */
// Builds the Electron host into dist/:
//   dist/main/main.js        main process (ESM, Node 24 / Electron 45)
//   dist/preload/preload.cjs sandboxed preload (CommonJS, `electron` external)
//   dist/probe/              security probe page (smoke tests; no Studio packages)
//   dist/renderer/           <Studio /> renderer (Vite, relative asset paths)
// Usage: node scripts/build.mjs [--skip-renderer]
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
