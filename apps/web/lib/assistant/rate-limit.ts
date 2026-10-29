/**
 * Best-effort fixed-window rate limiter kept in process memory. On serverless platforms each
 * instance has its own counters and they reset on cold start, so this throttles bursts from one
 * client rather than enforcing a global quota (use the provider's spend limit for that).
 */
export interface RateLimiter {
  /** Counts one request for `key`; false when the key is over its limit for this window. */
  take(key: string): boolean;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  /** Upper bound on tracked keys; expired windows are pruned first, then the oldest. */
  readonly maxKeys?: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 10_000;
  const windows = new Map<string, { start: number; count: number }>();

  function prune(at: number): void {
    for (const [key, window] of windows) {
      if (at - window.start >= options.windowMs) windows.delete(key);
    }
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  }

  return {
    take(key) {
      if (options.limit <= 0) return true;
      const at = now();
      const window = windows.get(key);
      if (!window || at - window.start >= options.windowMs) {
        if (!window && windows.size >= maxKeys) prune(at);
        windows.delete(key);
        windows.set(key, { start: at, count: 1 });
        return true;
      }
      window.count += 1;
      return window.count <= options.limit;
    },
  };
}
