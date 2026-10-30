import { clamp } from './decibels';

/** Maps a value (usually dB) to a 0..1 position on a control, and back. */
export interface Taper {
  toPosition: (value: number) => number;
  toValue: (position: number) => number;
}

export type TaperInput = 'linear' | 'audio' | 'log' | Taper;

/** Equal distance per unit across the range. */
export const linearTaper = (min: number, max: number): Taper => ({
  toPosition: (value) => (value > min ? clamp((value - min) / (max - min), 0, 1) : 0),
  toValue: (position) => min + clamp(position, 0, 1) * (max - min),
});

/**
 * A console-style fader law: 0 dB at three quarters of the travel, a square-law fall to
 * `minDb` below it and linear headroom above it.
 */
export function audioTaper(minDb = -60, maxDb = 6, unityPosition = 0.75): Taper {
  const anchorDb = Math.min(0, maxDb);
  const unity = maxDb > 0 ? clamp(unityPosition, 0, 1) : 1;
  return {
    toPosition: (db) => {
      if (!(db > minDb)) return 0;
      if (db >= maxDb) return 1;
      if (db >= anchorDb) return unity + ((db - anchorDb) / (maxDb - anchorDb)) * (1 - unity);
      return (1 - Math.sqrt((db - anchorDb) / (minDb - anchorDb))) * unity;
    },
    toValue: (position) => {
      const p = clamp(position, 0, 1);
      if (p >= unity) {
        return unity >= 1 ? anchorDb : anchorDb + ((p - unity) / (1 - unity)) * (maxDb - anchorDb);
      }
      return anchorDb + (minDb - anchorDb) * (1 - p / unity) ** 2;
    },
  };
}

/** Logarithmic law for frequency and time parameters. `min` must be above 0. */
export function logTaper(min: number, max: number): Taper {
  const span = Math.log(max / min);
  return {
    toPosition: (value) => (value > min ? clamp(Math.log(value / min) / span, 0, 1) : 0),
    toValue: (position) => min * Math.exp(clamp(position, 0, 1) * span),
  };
}

/** Resolves a taper name or object for a range. */
export function resolveTaper(taper: TaperInput, min: number, max: number): Taper {
  if (typeof taper !== 'string') return taper;
  if (taper === 'audio') return audioTaper(min, max);
  if (taper === 'log') return logTaper(min, max);
  return linearTaper(min, max);
}
