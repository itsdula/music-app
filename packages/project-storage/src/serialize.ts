/**
 * Deterministic JSON: object keys sorted by UTF-16 code unit order, arrays kept in
 * order, two-space indentation and a trailing newline. Identical values always
 * produce identical text, so saved projects diff cleanly and bundles are
 * byte-for-byte reproducible.
 */
import type { Project } from '@studio/domain';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    // Null prototype: a "__proto__" key stays an ordinary property.
    const sorted = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      // Mirror JSON.stringify: properties holding undefined are omitted.
      if (child !== undefined) sorted[key] = sortKeysDeep(child);
    }
    return sorted;
  }
  return value;
}

/** Stable, pretty-printed JSON for any JSON-compatible value. */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

/**
 * Serializes a project to stable JSON. The output is what repositories and bundles
 * store; `parseProjectJson(serializeProject(p))` yields a project equal to `p`
 * (note: `-0` is written as `0`, as in all JSON).
 */
export function serializeProject(project: Project): string {
  return stableStringify(project);
}
