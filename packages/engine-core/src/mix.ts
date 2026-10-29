/**
 * Mixer math: decibel conversion, fader law, mute/solo resolution and pan law.
 */
import type { Track, TrackId } from '@studio/domain';

/** Fader positions at or below this level are treated as silence (−∞ dB). */
export const FADER_SILENCE_DB = -60;

/**
 * `10^(db/20)`; `-Infinity` → 0. Units: dB → linear gain. O(1).
 * (Duplicates `dbToGain` from audio-dsp, which engine-core does not depend on.)
 */
export function decibelsToGain(db: number): number {
  if (db === Number.NEGATIVE_INFINITY) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Fader gain for a mixer level in dB: silence at or below {@link FADER_SILENCE_DB}
 * (matching the parameter spec's "min treated as −inf"), else `10^(db/20)`. O(1).
 */
export function faderGain(db: number): number {
  return db <= FADER_SILENCE_DB ? 0 : decibelsToGain(db);
}

/** True when any track is soloed. O(T). */
export function isSoloActive(tracks: Iterable<Track>): boolean {
  for (const track of tracks) if (track.mixer.solo) return true;
  return false;
}

/**
 * Mute/solo gate for one track: 0 when muted, or when another track is soloed and this
 * one is not; else 1. Mute wins over solo. O(1).
 */
export function trackGateGain(track: Track, soloActive: boolean): 0 | 1 {
  if (track.mixer.mute) return 0;
  if (soloActive && !track.mixer.solo) return 0;
  return 1;
}

/**
 * Resolves the gate of every track (see {@link trackGateGain}).
 * Output map iterates in input order. O(T).
 */
export function resolveTrackGates(tracks: readonly Track[]): Map<TrackId, 0 | 1> {
  const solo = isSoloActive(tracks);
  const result = new Map<TrackId, 0 | 1>();
  for (const track of tracks) result.set(track.id, trackGateGain(track, solo));
  return result;
}

export interface PanGains {
  readonly left: number;
  readonly right: number;
}

/**
 * Equal-power (sin/cos) pan law: θ = (pan + 1)·π/4, left = cos θ, right = sin θ.
 * left² + right² = 1 for every position, so perceived loudness of a mono source is
 * constant; the centre is −3.01 dB per side.
 * `pan` in [−1, 1] (clamped; NaN → centre). O(1).
 */
export function equalPowerPanGains(pan: number): PanGains {
  const p = Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0;
  const theta = ((p + 1) * Math.PI) / 4;
  return { left: Math.cos(theta), right: Math.sin(theta) };
}

/**
 * Mixer pan gains: the equal-power law scaled by √2 so the centre is unity (0 dB) on
 * both channels — inserting a centred panner never changes the level. Hard left is
 * +3.01 dB left / silent right. Applied per channel to stereo signals (balance-style).
 * O(1).
 */
export function mixerPanGains(pan: number): PanGains {
  const { left, right } = equalPowerPanGains(pan);
  return { left: left * Math.SQRT2, right: right * Math.SQRT2 };
}
