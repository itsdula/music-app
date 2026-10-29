/**
 * Analytic fundamental-frequency curves. A curve maps time (seconds) to f0 in Hz;
 * 0 means unvoiced. Because the synthesiser integrates the curve sample by sample, the
 * curve itself is the exact ground truth for pitch-tracking metrics.
 */
export type F0Curve = (tSeconds: number) => number;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** Constant f0 between `startSeconds` (default 0) and `endSeconds` (default ∞). */
export function constantF0(hz: number, startSeconds = 0, endSeconds = Infinity): F0Curve {
  return (t) => (t >= startSeconds && t < endSeconds ? hz : 0);
}

export interface VibratoOptions {
  readonly baseHz: number;
  readonly rateHz: number;
  /** Peak deviation in cents (half the peak-to-peak extent). */
  readonly depthCents: number;
  readonly startSeconds?: number;
  readonly endSeconds?: number;
  /** Start phase in cycles. */
  readonly phase?: number;
  /** Linear drift across the voiced span in cents per second (default 0). */
  readonly driftCentsPerSecond?: number;
}

export function vibratoF0(options: VibratoOptions): F0Curve {
  const start = options.startSeconds ?? 0;
  const end = options.endSeconds ?? Infinity;
  const phase = options.phase ?? 0;
  const drift = options.driftCentsPerSecond ?? 0;
  return (t) => {
    if (t < start || t >= end) return 0;
    const local = t - start;
    const cents =
      options.depthCents * Math.sin(2 * Math.PI * (phase + options.rateHz * local)) + drift * local;
    return options.baseHz * Math.pow(2, cents / 1200);
  };
}

export interface GlideOptions {
  readonly fromHz: number;
  readonly toHz: number;
  /** When the glide starts; before it the curve holds `fromHz` from `holdStartSeconds`. */
  readonly glideStartSeconds: number;
  readonly glideSeconds: number;
  /** Voiced span (defaults: 0 .. ∞). */
  readonly holdStartSeconds?: number;
  readonly endSeconds?: number;
}

/** Hold → glide (linear in cents) → hold. */
export function glideF0(options: GlideOptions): F0Curve {
  const start = options.holdStartSeconds ?? 0;
  const end = options.endSeconds ?? Infinity;
  const ratio = Math.log2(options.toHz / options.fromHz);
  return (t) => {
    if (t < start || t >= end) return 0;
    const u = Math.min(1, Math.max(0, (t - options.glideStartSeconds) / options.glideSeconds));
    return options.fromHz * Math.pow(2, ratio * u);
  };
}

export interface TimedNote {
  readonly midi: number;
  readonly startSeconds: number;
  readonly durationSeconds: number;
}

export interface MelodyF0Options {
  /**
   * Portamento between notes that touch (gap below 1 ms): the pitch moves linearly in
   * cents over this many seconds, centred on the boundary. Default 0 (instant steps).
   */
  readonly glideSeconds?: number;
  /** Optional vibrato applied to every note. */
  readonly vibrato?: { readonly rateHz: number; readonly depthCents: number };
  /** Constant detune per note in cents (index-aligned), e.g. to simulate off-pitch singing. */
  readonly detuneCents?: readonly number[];
}

/** Piecewise f0 for a note list (gaps are unvoiced). Notes must be sorted and non-overlapping. */
export function melodyF0(notes: readonly TimedNote[], options: MelodyF0Options = {}): F0Curve {
  const glide = options.glideSeconds ?? 0;
  const pitchOf = (index: number): number =>
    notes[index]!.midi + (options.detuneCents?.[index] ?? 0) / 100;
  return (t) => {
    // Binary search for the note containing t.
    let lo = 0;
    let hi = notes.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const note = notes[mid]!;
      if (t < note.startSeconds) hi = mid - 1;
      else if (t >= note.startSeconds + note.durationSeconds) lo = mid + 1;
      else {
        found = mid;
        break;
      }
    }
    if (found < 0) return 0;
    const note = notes[found]!;
    let midi = pitchOf(found);
    if (glide > 0) {
      const prev = notes[found - 1];
      const next = notes[found + 1];
      const noteEnd = note.startSeconds + note.durationSeconds;
      if (
        prev !== undefined &&
        Math.abs(prev.startSeconds + prev.durationSeconds - note.startSeconds) < 1e-3 &&
        t < note.startSeconds + glide / 2
      ) {
        const u = 0.5 + (t - note.startSeconds) / glide;
        midi = pitchOf(found - 1) + (midi - pitchOf(found - 1)) * u;
      } else if (
        next !== undefined &&
        Math.abs(noteEnd - next.startSeconds) < 1e-3 &&
        t >= noteEnd - glide / 2
      ) {
        const u = (t - (noteEnd - glide / 2)) / glide;
        midi = midi + (pitchOf(found + 1) - midi) * u;
      }
    }
    const vibrato = options.vibrato;
    const cents =
      vibrato === undefined
        ? 0
        : vibrato.depthCents * Math.sin(2 * Math.PI * vibrato.rateHz * (t - note.startSeconds));
    return midiToHz(midi + cents / 100);
  };
}
