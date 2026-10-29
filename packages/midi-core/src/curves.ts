/**
 * Value curves for mappings and incoming note velocity.
 */
import type { MappingCurve, MidiValueTransform } from '@studio/domain';

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);

/** Steepness of the exponential/logarithmic curves (they are exact inverses). */
const CURVE_K = 3;
const EXP_K_MINUS_1 = Math.expm1(CURVE_K);

/**
 * Shapes a normalized input 0..1. Every curve is monotonically non-decreasing and maps
 * 0 → 0 and 1 → 1 exactly.
 * - exponential: slow start, fast end — (e^(3x) − 1) / (e^3 − 1)
 * - logarithmic: fast start, slow end — the exact inverse of `exponential`
 * - sCurve: smoothstep 3x² − 2x³ (fine control around both ends)
 */
export function applyMappingCurve(value: number, curve: MappingCurve): number {
  const x = clamp01(value);
  if (x === 0 || x === 1) return x;
  switch (curve) {
    case 'linear':
      return x;
    case 'exponential':
      return clamp01(Math.expm1(CURVE_K * x) / EXP_K_MINUS_1);
    case 'logarithmic':
      return clamp01(Math.log1p(x * EXP_K_MINUS_1) / CURVE_K);
    case 'sCurve':
      return clamp01(x * x * (3 - 2 * x));
  }
}

/**
 * Converts a normalized control position (0..1) into the target's normalized value:
 * curve → invert → scale into [min, max]. The result is clamped to 0..1.
 */
export function applyValueTransform(position: number, transform: MidiValueTransform): number {
  let shaped = applyMappingCurve(position, transform.curve);
  if (transform.invert) shaped = 1 - shaped;
  return clamp01(transform.min + shaped * (transform.max - transform.min));
}

export type VelocityCurve = 'linear' | 'soft' | 'hard' | 'fixed';

/**
 * Applies a performance velocity curve to an incoming note-on velocity (1..127).
 * - linear: unchanged
 * - soft: easier to play loud (concave, gamma 0.6)
 * - hard: needs more force for loud notes (convex, gamma 1.6)
 * - fixed: always `fixedValue` (default 100)
 * The result is an integer in 1..127 (0 stays 0 so note-offs are never turned into
 * note-ons).
 */
export function applyVelocityCurve(
  velocity: number,
  curve: VelocityCurve,
  fixedValue: number = 100,
): number {
  if (!(velocity > 0)) return 0;
  const clampVelocity = (value: number): number =>
    Math.min(127, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
  if (curve === 'fixed') return clampVelocity(fixedValue);
  const x = Math.min(127, velocity) / 127;
  switch (curve) {
    case 'linear':
      return clampVelocity(x * 127);
    case 'soft':
      return clampVelocity(Math.pow(x, 0.6) * 127);
    case 'hard':
      return clampVelocity(Math.pow(x, 1.6) * 127);
  }
}
