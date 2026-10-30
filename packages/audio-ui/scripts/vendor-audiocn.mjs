// Copies the audiocn files Studio uses from a checkout of github.com/audiocn/ui into
// src/audiocn/, keeping upstream's layout and rewriting its `@/` alias to relative imports.
//
//   git clone https://github.com/audiocn/ui /tmp/audiocn && git -C /tmp/audiocn checkout <sha>
//   node packages/audio-ui/scripts/vendor-audiocn.mjs /tmp/audiocn
//
// Update UPSTREAM.md with the commit afterwards. Local changes to vendored files are listed
// there too, so an update can re-apply them.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = [
  'lib/utils.ts',
  ...[
    'types',
    'decibels',
    'ballistics',
    'zones',
    'taper',
    'bands',
    'bar-levels',
    'wave-line',
    'time',
    'frame-loop',
    'frame-source',
    'history',
    'history-playback',
    'click',
  ].map((f) => `lib/audio/${f}.ts`),
  ...[
    'use-audio-config.tsx',
    'use-audio-context.tsx',
    'use-frame-source.ts',
    'use-level.ts',
    'use-clip-hold.ts',
    'use-reduced-motion.ts',
    'use-visibility.ts',
  ].map((f) => `hooks/${f}`),
  ...[
    'db-scale',
    'db-readout',
    'clip-indicator',
    'level-meter',
    'fader',
    'knob',
    'pan-control',
    'channel-toggle',
    'parameter-slider',
  ].map((f) => `components/ui/${f}.tsx`),
];

const source = process.argv[2];
if (!source) {
  console.error('usage: vendor-audiocn.mjs <path to audiocn checkout>');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'audiocn');
rmSync(target, { recursive: true, force: true });

for (const file of FILES) {
  const out = join(target, file);
  mkdirSync(dirname(out), { recursive: true });
  const text = readFileSync(join(source, file), 'utf8')
    .replace(/^"use client";\n\n?/u, '')
    .replace(/(from\s+|import\s+)"@\/([^"]+)"/gu, (_, kw, spec) => {
      let rel = relative(dirname(file), spec);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${kw}"${rel}"`;
    });
  writeFileSync(out, text);
}
copyFileSync(join(source, 'license.md'), join(target, 'LICENSE.md'));
const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
console.warn(`Vendored ${FILES.length} files from audiocn ${sha}`);
