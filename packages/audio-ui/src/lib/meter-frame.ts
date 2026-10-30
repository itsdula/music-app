import { gainToDb } from './decibels';
import { createFrameEmitter, type FrameEmitter } from './frame-source';

/** One meter reading in dBFS: a level per channel and, optionally, a peak-hold level per channel. */
export interface MeterFrame {
  levels: readonly number[];
  peaks?: readonly number[] | undefined;
}

/** Bottom of every meter's range; quieter readings (and digital silence) sit here. */
export const METER_FLOOR_DB = -60;

/** Mix-bus zones: amber from −12 dBFS, red (and the clip latch) from 0 dBFS. */
export const MIX_METER_WARN_DB = -12;
export const MIX_METER_CLIP_DB = 0;

const floorDb = (db: number) => Math.max(METER_FLOOR_DB, db);

/** Converts linear peak amplitudes per channel (1.0 = 0 dBFS), as engines report them, to a frame. */
export function meterFrameFromGains(peak: readonly number[]): MeterFrame {
  return { levels: peak.map((p) => floorDb(gainToDb(p))) };
}

export interface MeterEmitterOptions {
  channels?: number;
  /** How long a peak mark stays put before it falls. Default 1000 ms. */
  holdMs?: number;
  /** How fast it falls after that. Default 20 dB per second. */
  fallDbPerSecond?: number;
  /** Clock in ms; defaults to `performance.now()`. */
  now?: () => number;
}

export interface MeterEmitter extends FrameEmitter<MeterFrame> {
  /** True once every level and peak mark has come to rest at the floor, so silent frames can be skipped. */
  readonly settled: boolean;
}

/**
 * A meter source that adds peak hold to the levels it is given: the `@audio-ui/react` meter
 * draws `peaks` but leaves their timing to the caller.
 */
export function createMeterEmitter({
  channels = 2,
  holdMs = 1000,
  fallDbPerSecond = 20,
  now = () => performance.now(),
}: MeterEmitterOptions = {}): MeterEmitter {
  const silent = Array.from({ length: channels }, () => METER_FLOOR_DB);
  const emitter = createFrameEmitter<MeterFrame>({ levels: silent, peaks: silent });
  const held = silent.map((db) => ({ db, at: 0 }));
  let last = now();
  let settled = true;

  return {
    getSnapshot: emitter.getSnapshot,
    subscribe: emitter.subscribe,
    get settled() {
      return settled;
    },
    emit: ({ levels }) => {
      const time = now();
      const elapsed = Math.max(0, time - last) / 1000;
      last = time;
      const peaks = held.map((hold, i) => {
        const level = floorDb(levels[i] ?? METER_FLOOR_DB);
        if (level >= hold.db) {
          hold.db = level;
          hold.at = time;
        } else if (time - hold.at > holdMs) {
          hold.db = Math.max(level, hold.db - fallDbPerSecond * elapsed);
        }
        return hold.db;
      });
      settled =
        levels.every((db) => floorDb(db) <= METER_FLOOR_DB) &&
        peaks.every((db) => db <= METER_FLOOR_DB);
      emitter.emit({ levels: levels.map(floorDb), peaks });
    },
  };
}
