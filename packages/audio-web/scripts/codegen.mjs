import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInlineBundles } from '../../../scripts/inline-bundles.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** exportName -> worker/worklet entry (relative to the package root). */
const entries = {
  STUDIO_WORKLET_SOURCE: 'src/worklets/studio-worklet.ts',
  CLOCK_WORKER_SOURCE: 'src/workers/clock-worker.ts',
};

await buildInlineBundles({ packageRoot, entries });
