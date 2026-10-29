/**
 * Musical and audio time.
 *
 * Units (kept distinct by name; all are plain numbers at runtime):
 * - `Ticks`   integer musical time, PPQ ticks per quarter note. The canonical unit
 *             for anything placed on the musical timeline (clips, notes, loop).
 * - `Seconds` floating-point wall/audio time.
 * - `Frames`  integer sample frames at a stated sample rate (audio source offsets).
 *
 * Tempo is a single global BPM in quarter notes per minute, independent of the
 * time-signature denominator. A future tempo map will replace `bpm` arguments with
 * a `TempoMap` while keeping these function shapes.
 */

/** Ticks per quarter note. 960 = 2^6·3·5, so straight and triplet grids down to 1/64 are integers. */
export const PPQ = 960;

export type Ticks = number;
export type Seconds = number;
export type Frames = number;

export const MIN_BPM = 20;
export const MAX_BPM = 400;

export type TimeSignatureDenominator = 1 | 2 | 4 | 8 | 16 | 32;

export interface TimeSignature {
  readonly numerator: number;
  readonly denominator: TimeSignatureDenominator;
}

export interface BarsBeatsTicks {
  /** 1-based bar number. */
  readonly bar: number;
  /** 1-based beat within the bar (beat = 1/denominator note). */
  readonly beat: number;
  /** Remaining ticks within the beat, 0-based. */
  readonly tick: Ticks;
}

export function ticksPerBeat(meter: TimeSignature): Ticks {
  return (PPQ * 4) / meter.denominator;
}

export function ticksPerBar(meter: TimeSignature): Ticks {
  return ticksPerBeat(meter) * meter.numerator;
}

/** Seconds per tick at a constant tempo. */
export function secondsPerTick(bpm: number): Seconds {
  return 60 / (bpm * PPQ);
}

export function ticksToSeconds(ticks: Ticks, bpm: number): Seconds {
  return (ticks * 60) / (bpm * PPQ);
}

/** Converts seconds to (fractional) ticks. Callers decide how to round. */
export function secondsToTicks(seconds: Seconds, bpm: number): number {
  return (seconds * bpm * PPQ) / 60;
}

export function secondsToFrames(seconds: Seconds, sampleRate: number): Frames {
  return Math.round(seconds * sampleRate);
}

export function framesToSeconds(frames: Frames, sampleRate: number): Seconds {
  return frames / sampleRate;
}

export function framesToTicks(frames: Frames, sampleRate: number, bpm: number): number {
  return secondsToTicks(frames / sampleRate, bpm);
}

export function ticksToFrames(ticks: Ticks, sampleRate: number, bpm: number): Frames {
  return Math.round(ticksToSeconds(ticks, bpm) * sampleRate);
}

/** Splits a tick position into bars/beats/ticks for display (position 0 = 1.1.0). */
export function ticksToBarsBeats(ticks: Ticks, meter: TimeSignature): BarsBeatsTicks {
  const perBeat = ticksPerBeat(meter);
  const perBar = perBeat * meter.numerator;
  const t = Math.max(0, Math.floor(ticks));
  const bar = Math.floor(t / perBar);
  const inBar = t - bar * perBar;
  const beat = Math.floor(inBar / perBeat);
  return { bar: bar + 1, beat: beat + 1, tick: inBar - beat * perBeat };
}

export function barsBeatsToTicks(position: BarsBeatsTicks, meter: TimeSignature): Ticks {
  return (
    (position.bar - 1) * ticksPerBar(meter) +
    (position.beat - 1) * ticksPerBeat(meter) +
    position.tick
  );
}

/** Formats as `bar.beat.sixteenth` (e.g. `3.2.1`), the transport display convention. */
export function formatBarsBeats(ticks: Ticks, meter: TimeSignature): string {
  const { bar, beat, tick } = ticksToBarsBeats(ticks, meter);
  const sixteenth = Math.floor(tick / (PPQ / 4)) + 1;
  return `${bar}.${beat}.${sixteenth}`;
}

/** Formats seconds as `m:ss.mmm`. */
export function formatSeconds(seconds: Seconds): string {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  const whole = Math.floor(rest);
  const millis = Math.floor((rest - whole) * 1000);
  return `${minutes}:${String(whole).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

export function isValidTimeSignature(meter: TimeSignature): boolean {
  return (
    Number.isInteger(meter.numerator) &&
    meter.numerator >= 1 &&
    meter.numerator <= 32 &&
    [1, 2, 4, 8, 16, 32].includes(meter.denominator)
  );
}
