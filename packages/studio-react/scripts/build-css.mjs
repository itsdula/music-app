// Builds dist/studio.css with the Tailwind CLI and copies the bundled Inter font.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');

const fontsDir = join(pkgRoot, 'dist', 'fonts');
mkdirSync(fontsDir, { recursive: true });
const interDir = dirname(require.resolve('@fontsource-variable/inter/package.json'));
copyFileSync(
  join(interDir, 'files', 'inter-latin-wght-normal.woff2'),
  join(fontsDir, 'inter-latin-wght-normal.woff2'),
);

const args = ['-i', join(pkgRoot, 'src/styles/studio.css'), '-o', join(pkgRoot, 'dist/studio.css')];
if (watch) args.push('--watch');
else args.push('--minify');
const cli = join(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist', 'index.mjs');
const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', cwd: pkgRoot });
child.on('exit', (code) => process.exit(code ?? 1));
