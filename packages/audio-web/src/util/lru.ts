/**
 * Tiny least-recently-used cache for deterministic, context-independent derived audio
 * (drum kits, reverb impulse responses). AudioBuffers are not bound to a context, so a
 * cached buffer serves the realtime context and offline renders alike. Cached buffers
 * are shared read-only — callers must never write into them.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  getOrCreate(key: string, create: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = create();
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest);
    }
    return value;
  }

  get size(): number {
    return this.map.size;
  }
}
