// Bundles build.ts (it imports TypeScript workspace packages) with esbuild, then runs it.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = mkdtempSync(join(tmpdir(), 'studio-samples-'));
const outfile = join(outDir, 'build.mjs');
try {
  await build({
    entryPoints: [new URL('./build.ts', import.meta.url).pathname],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    logLevel: 'warning',
  });
  await import(pathToFileURL(outfile).href);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
