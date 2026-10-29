/**
 * Edge hit-zone sizing shared by the canvas editors. Edge zones scale with the item width
 * but never shrink below a usable minimum; a third of the item always stays "body" so it can
 * still be moved, and a small slop outside each edge keeps tiny items resizable.
 */
export interface EdgeZoneSpec {
  /** Widest inner zone in px. */
  readonly max: number;
  /** Narrowest inner zone in px (unless the item is narrower than 3× this). */
  readonly min: number;
  /** Grab area just outside each edge in px. */
  readonly outer: number;
}

/** Inner width of each edge zone for an item `w` px wide. */
export function edgeZoneWidth(w: number, spec: Pick<EdgeZoneSpec, 'min' | 'max'>): number {
  return Math.max(0, Math.min(spec.max, Math.max(spec.min, w / 4), w / 3));
}

export type EdgeSide = 'start' | 'end' | 'inside';

/** Classifies `x` against an item spanning [x0, x0 + w): which edge (or inside), or null if outside. */
export function classifyEdge(
  x: number,
  x0: number,
  w: number,
  spec: EdgeZoneSpec,
  includeOuter: boolean,
): EdgeSide | null {
  const x1 = x0 + w;
  if (x >= x0 && x < x1) {
    const edge = edgeZoneWidth(w, spec);
    if (x >= x1 - edge) return 'end';
    if (x < x0 + edge) return 'start';
    return 'inside';
  }
  if (!includeOuter) return null;
  if (x >= x1 && x < x1 + spec.outer) return 'end';
  if (x < x0 && x >= x0 - spec.outer) return 'start';
  return null;
}
