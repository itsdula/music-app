/* eslint-disable no-console -- CLI diagnostics */
// Builds the Electron host into dist/:
//   dist/main/main.js        main process (ESM, Node 24 / Electron 45)
//   dist/preload/preload.cjs sandboxed preload (CommonJS, `electron` external)
//   dist/probe/              security probe page (smoke tests; no Studio packages)
//   dist/renderer/           <Studio /> renderer (Vite, relative asset paths)
// Usage: node scripts/build.mjs [--skip-renderer] [--watch]
//   --watch  dev mode for `pnpm dev` (apps/dev-monitor): rebuilds main, preload and the renderer
//            on change and prints one `[watch] <target> built|failed` line per rebuild; the
//            orchestrator restarts Electron when main is rebuilt, and main (under STUDIO_DEV=1)
//            reloads the window when the preload or renderer output changes. No probe.
// Optional build-time environment (see src/shared/build-defines.d.ts and docs/assistant.md):
//   STUDIO_ASSISTANT_URL    https URL of a Studio /api/assistant endpoint (http only for loopback)
//   STUDIO_ASSISTANT_TOKEN  shared secret for that endpoint (shipped in the renderer bundle)
//   STUDIO_DEV=1            dev build: compiles in the dev-only code behind __STUDIO_DEV__
//                           (OpenTelemetry log export, window reload, verbose renderer console).
//                           Never set it for a build you ship.
// The renderer needs workspace codegen and @studio/react's CSS: prefer
// `pnpm turbo run build --filter=@studio/desktop...` from the repo root.
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { context as esbuildContext, build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(appDir, 'src');
const dist = join(appDir, 'dist');
const skipRenderer = process.argv.includes('--skip-renderer');
const watch = process.argv.includes('--watch');
const devBuild = process.env.STUDIO_DEV === '1';

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

/** Dev-only code (src/main/dev-*.ts, verbose renderer logging) is dead code unless STUDIO_DEV=1. */
const devDefines = { __STUDIO_DEV__: JSON.stringify(devBuild) };

const shared = { bundle: true, sourcemap: true, logLevel: 'warning', legalComments: 'none' };

const mainOptions = {
  ...shared,
  entryPoints: [join(src, 'main/main.ts')],
  outfile: join(dist, 'main/main.js'),
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['electron'],
  // Main needs only the URL (for the CSP); the token stays out of the main bundle.
  define: { __STUDIO_ASSISTANT_URL__: assistantDefines.__STUDIO_ASSISTANT_URL__, ...devDefines },
};

const preloadOptions = {
  ...shared,
  entryPoints: [join(src, 'preload/preload.ts')],
  outfile: join(dist, 'preload/preload.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'chrome156',
  external: ['electron'],
};

function rendererConfig(watchOptions) {
  return {
    configFile: false,
    root: join(src, 'renderer'),
    base: './',
    publicDir: false,
    logLevel: 'warn',
    plugins: [react()],
    define: { ...assistantDefines, ...devDefines },
    build: {
      outDir: join(dist, 'renderer'),
      // In watch mode dist/renderer is emptied once up front, so a rebuild never leaves the
      // studio:// protocol serving a half-empty directory.
      emptyOutDir: !watchOptions,
      target: 'chrome156',
      sourcemap: true,
      chunkSizeWarningLimit: 4096,
      ...(watchOptions ? { watch: watchOptions } : {}),
    },
  };
}

async function buildHost() {
  await Promise.all(
    ['main', 'preload', 'probe'].map((d) => rm(join(dist, d), { recursive: true, force: true })),
  );
  await Promise.all([
    esbuild(mainOptions),
    esbuild(preloadOptions),
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
  await viteBuild(rendererConfig(null));
  console.log('built dist/renderer');
}

/** esbuild plugin printing one `[watch]` line per rebuild of `target`. */
function reportRebuilds(target) {
  return {
    name: 'studio-watch-report',
    setup(build) {
      build.onEnd((result) => {
        console.log(`[watch] ${target} ${result.errors.length > 0 ? 'failed' : 'built'}`);
      });
    },
  };
}

async function watchAll() {
  await Promise.all(
    ['main', 'preload', 'renderer'].map((d) => rm(join(dist, d), { recursive: true, force: true })),
  );
  for (const [target, options] of [
    ['main', mainOptions],
    ['preload', preloadOptions],
  ]) {
    const ctx = await esbuildContext({ ...options, plugins: [reportRebuilds(target)] });
    await ctx.watch();
  }
  const watcher = await viteBuild(rendererConfig({}));
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') {
      void event.result?.close();
      console.log('[watch] renderer built');
    } else if (event.code === 'ERROR') {
      void event.result?.close();
      console.error(`[watch] renderer failed: ${event.error?.message ?? event.error}`);
    }
  });
}

if (watch) {
  await watchAll();
} else {
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
}
