import { gainToDb } from '../audiocn/lib/audio/decibels';
import type { MeterFrame, MeterZone } from '../audiocn/lib/audio/types';

/**
 * Converts linear amplitudes per channel (1.0 = 0 dBFS), as audio engines usually report
 * them, into the dB frame audiocn meters read.
 */
export function meterFrameFromGains(
  peak: readonly number[],
  rms: readonly number[] = [],
): MeterFrame {
  return {
    channels: peak.map((p, i) => {
      const r = rms[i];
      return r === undefined
        ? { peakDb: gainToDb(p) }
        : { peakDb: gainToDb(p), rmsDb: gainToDb(r) };
    }),
  };
}

/** Mix-bus colour zones: green below −12 dBFS, amber up to −3, red above. */
export const MIX_METER_ZONES: MeterZone[] = [
  { fromDb: Number.NEGATIVE_INFINITY, zone: 'ok' },
  { fromDb: -12, zone: 'warn' },
  { fromDb: -3, zone: 'clip' },
];
