/* eslint-disable no-console -- CLI diagnostics */
// Packages the built Electron host as a standalone macOS app for this Mac's architecture:
//   out/Studio-darwin-<arch>/Studio.app   double-click to run
//   out/Studio-mac-<arch>.zip             the same app zipped, to copy to another Mac
// Run `pnpm package:mac` from the repo root (it builds first).
//
// dist/ is fully bundled (esbuild main and preload, Vite renderer), so the app ships only dist/
// and a minimal package.json: no node_modules. The app is signed ad hoc, not with an Apple
// Developer ID, so on another Mac Gatekeeper blocks the first launch: right-click the app and
// choose Open (or run `xattr -cr Studio.app`) once.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

if (process.platform !== 'darwin') {
  console.error('package:mac must run on macOS.');
  process.exit(1);
}

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(appDir, 'out');
const stage = join(out, 'stage');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

const pkg = await readJson(join(appDir, 'package.json'));
const electronVersion = (await readJson(join(appDir, 'node_modules/electron/package.json')))
  .version;

await rm(out, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(appDir, 'dist'), join(stage, 'dist'), {
  recursive: true,
  // Source maps and the smoke-test probe page stay out of the app.
  filter: (src) => !src.endsWith('.map') && !src.includes(join('dist', 'probe')),
});
await writeFile(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'studio',
      productName: 'Studio',
      version: pkg.version,
      description: 'A local-first music workstation',
      type: 'module',
      main: pkg.main,
    },
    null,
    2,
  )}\n`,
);

const [appPath] = await packager({
  dir: stage,
  out,
  name: 'Studio',
  platform: 'darwin',
  arch,
  electronVersion,
  appVersion: pkg.version,
  appBundleId: 'app.studio.desktop',
  appCategoryType: 'public.app-category.music',
  icon: join(appDir, 'resources/icon.icns'),
  asar: true,
  prune: false,
  overwrite: true,
  darwinDarkModeSupport: true,
  extendInfo: {
    NSMicrophoneUsageDescription: 'Studio records audio from your microphone or audio interface.',
  },
});

const app = join(appPath, 'Studio.app');
execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
const zip = join(out, `Studio-mac-${arch}.zip`);
execFileSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip], {
  stdio: 'inherit',
});
await rm(stage, { recursive: true, force: true });

console.log(`\nPackaged ${app}\nZipped   ${zip}`);
