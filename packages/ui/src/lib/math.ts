/** Clamps `value` into [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Number of decimals implied by a step (0.01 -> 2, 1e-3 -> 3). */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const text = String(step);
  const exp = /e-(\d+)$/.exec(text);
  if (exp?.[1]) return Number(exp[1]);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Snaps `value` to the grid `min + k * step`, clamps it and removes float noise. */
export function snapToStep(value: number, step: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (!(step > 0)) return clamp(value, min, max);
  const snapped = min + Math.round((value - min) / step) * step;
  const decimals = Math.max(decimalsOf(step), decimalsOf(Math.abs(min)));
  return clamp(Number(snapped.toFixed(Math.min(decimals, 12))), min, max);
}

/** Converts a linear amplitude to dBFS (-Infinity for silence). */
export function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : Number.NEGATIVE_INFINITY;
}
