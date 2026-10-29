import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInlineBundles } from '../../../scripts/inline-bundles.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** exportName -> worker/worklet entry (relative to the package root). */
const entries = {};

await buildInlineBundles({ packageRoot, entries });
