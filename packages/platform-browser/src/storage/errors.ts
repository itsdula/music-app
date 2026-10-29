import { StorageQuotaError } from '@studio/project-storage';

const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED']);
/** Legacy DOMException codes: QUOTA_EXCEEDED_ERR (22) and Firefox's 1014. */
const QUOTA_CODES = new Set([22, 1014]);

/**
 * True when `error` (or anything it wraps: Dexie's `inner`, standard `cause`) is a
 * storage-quota failure. Browsers report quota exhaustion either as the failing
 * request's error or as the reason a transaction aborted.
 */
export function isQuotaError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const candidate = current as {
      name?: unknown;
      code?: unknown;
      inner?: unknown;
      cause?: unknown;
    };
    if (typeof candidate.name === 'string' && QUOTA_NAMES.has(candidate.name)) return true;
    if (typeof candidate.code === 'number' && QUOTA_CODES.has(candidate.code)) return true;
    current = candidate.inner ?? candidate.cause;
  }
  return false;
}

/** Converts quota failures into the portable {@link StorageQuotaError}; other errors pass through. */
export function mapStorageError(error: unknown, context: string): unknown {
  if (error instanceof StorageQuotaError) return error;
  if (isQuotaError(error)) {
    return new StorageQuotaError(
      `Storage quota exceeded while ${context}. Free up space (delete unused projects or assets) or grant persistent storage.`,
      error,
    );
  }
  return error;
}

export async function withStorageErrors<T>(
  context: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const mapped = mapStorageError(error, context);
    throw mapped instanceof Error ? mapped : new Error(String(mapped));
  }
}
