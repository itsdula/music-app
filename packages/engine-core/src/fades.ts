/**
 * Gain envelopes for audio-clip playback voices: clip-edge fades plus short de-click
 * ramps when a voice starts in the middle of a clip (seek, loop wrap, live edit) or is
 * cut before the clip end (loop end, stop, render end).
 */

/** Default de-click ramp length. */
export const DECLICK_SECONDS = 0.005;

export interface GainPoint {
  /** Seconds after the voice start. */
  readonly offsetSeconds: number;
  /** Linear gain (includes the clip gain). */
  readonly gain: number;
}

export interface AudioVoiceEnvelopeInput {
  /** Clip-relative source frame at the voice start (0 = clip's first frame). */
  readonly clipOffsetFrames: number;
  /** Source frames the voice plays (> 0). */
  readonly playFrames: number;
  readonly clipLengthFrames: number;
  readonly fadeInFrames: number;
  readonly fadeOutFrames: number;
  /** Source sample rate: frames per second of playback (no time-stretching). */
  readonly sampleRate: number;
  /** Linear clip gain. */
  readonly gain: number;
  /** Ramp in from 0 over `declickFrames` (voice starts mid-clip). */
  readonly startsMidway: boolean;
  /** Ramp out to 0 over `declickFrames` (voice is cut before the clip end). */
  readonly endsEarly: boolean;
  readonly declickFrames: number;
}

/**
 * Piecewise-linear gain breakpoints for a voice. The gain at clip frame c is
 *
 *     gain · min(fadeIn(c), fadeOut(c)) · declickIn(c) · declickOut(c)
 *
 * with linear fades fadeIn(c) = c / fadeInFrames and fadeOut(c) = (L − c) / fadeOutFrames
 * (each clamped to [0, 1]; a zero-length fade is 1). The function is evaluated exactly at
 * every breakpoint of its factors inside the played range, so connecting the points with
 * linear ramps reproduces the clip fades exactly (the de-click products are
 * approximated linearly over ≤ 5 ms).
 *
 * - Output: ≥ 2 points, strictly increasing `offsetSeconds`, first at 0, last at
 *   playFrames / sampleRate.
 * - Complexity: O(1) (at most 6 breakpoints).
 */
export function audioVoiceGainEnvelope(input: AudioVoiceEnvelopeInput): GainPoint[] {
  const c0 = input.clipOffsetFrames;
  const n = Math.max(0, input.playFrames);
  const c1 = c0 + n;
  const L = input.clipLengthFrames;
  const fi = Math.max(0, input.fadeInFrames);
  const fo = Math.max(0, input.fadeOutFrames);
  const d = Math.max(0, Math.min(input.declickFrames, n / 2));
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const value = (c: number) => {
    const fadeIn = fi > 0 ? clamp01(c / fi) : 1;
    const fadeOut = fo > 0 ? clamp01((L - c) / fo) : 1;
    const din = input.startsMidway && d > 0 ? clamp01((c - c0) / d) : 1;
    const dout = input.endsEarly && d > 0 ? clamp01((c1 - c) / d) : 1;
    return input.gain * Math.min(fadeIn, fadeOut) * din * dout;
  };
  const candidates = [c0, c1, fi, L - fo];
  if (input.startsMidway && d > 0) candidates.push(c0 + d);
  if (input.endsEarly && d > 0) candidates.push(c1 - d);
  const breakpoints = [...new Set(candidates.filter((c) => c >= c0 && c <= c1))].sort(
    (a, b) => a - b,
  );
  if (breakpoints.length === 1) breakpoints.push(c1);
  return breakpoints.map((c) => ({ offsetSeconds: (c - c0) / input.sampleRate, gain: value(c) }));
}

/** Linear interpolation of an envelope at `offsetSeconds` (holds the end values). O(points). */
export function gainEnvelopeAt(points: readonly GainPoint[], offsetSeconds: number): number {
  if (points.length === 0) return 0;
  if (offsetSeconds <= points[0]!.offsetSeconds) return points[0]!.gain;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (offsetSeconds <= b.offsetSeconds) {
      const span = b.offsetSeconds - a.offsetSeconds;
      return span > 0
        ? a.gain + ((b.gain - a.gain) * (offsetSeconds - a.offsetSeconds)) / span
        : b.gain;
    }
  }
  return points[points.length - 1]!.gain;
}
