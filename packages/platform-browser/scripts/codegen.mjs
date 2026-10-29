import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInlineBundles } from '../../../scripts/inline-bundles.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

await buildInlineBundles({
  packageRoot,
  entries: { vocalWorkerSource: 'src/workers/vocal-worker.ts' },
});
