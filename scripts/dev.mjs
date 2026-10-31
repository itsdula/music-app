// `pnpm dev` / `npm run dev`: bundles the dev orchestrator (apps/dev-monitor, TypeScript) with
// esbuild, then runs it. It prints only the dev-monitor URL; see docs/dev-monitor.md.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'dev-monitor');
// Inside the package (not a temp dir) so `esbuild` and React resolve from its node_modules.
const outfile = join(appDir, 'dist', 'orchestrator.mjs');
try {
  await build({
    entryPoints: [join(appDir, 'src', 'orchestrator.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    external: ['esbuild'],
    logLevel: 'silent',
  });
} catch (error) {
  process.stderr.write(`studio dev: cannot bundle the orchestrator\n${String(error)}\n`);
  process.exit(1);
}
process.env.STUDIO_DEV_MONITOR_DIR = appDir;
await import(pathToFileURL(outfile).href);
