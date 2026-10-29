/**
 * Transport clock: maps engine time (seconds on the backend audio clock) to musical
 * position (ticks) through an anchor, with optional loop wrapping.
 *
 * Model. While playing, an "unwrapped" tick coordinate advances linearly:
 *
 *     u(t) = anchorTick + (t − anchorTime) · bpm · PPQ / 60
 *
 * The audible timeline position is `wrapTick(u)`: identical to u before the loop end;
 * from the loop end on it cycles through [loop.startTick, loop.endTick). The loop is
 * active only when it is enabled and the anchor lies before its end (DAW convention:
 * starting playback after the loop end ignores the loop). u is monotonic, so scheduling
 * windows are expressed in u and never overlap or leave gaps across wraps.
 */
import { PPQ, type LoopRegion } from '@studio/domain';

export interface LoopBounds {
  /** Inclusive start tick. */
  readonly startTick: number;
  /** Exclusive end tick; > startTick. */
  readonly endTick: number;
}

export interface TransportClock {
  /** Engine time (s) at which the transport is at `anchorTick`. */
  readonly anchorTime: number;
  /** Timeline tick at `anchorTime` (fractional allowed). */
  readonly anchorTick: number;
  /** Tempo in quarter notes per minute (> 0). */
  readonly bpm: number;
  /** Active loop, or null when looping does not apply to this run. */
  readonly loop: LoopBounds | null;
}

/** Ticks per second at a tempo: `bpm · PPQ / 60`. O(1). */
export function ticksPerSecond(bpm: number): number {
  return (bpm * PPQ) / 60;
}

/**
 * The loop bounds that apply to a run anchored at `anchorTick`, or null when the
 * loop is disabled, degenerate (end ≤ start) or the anchor is at/after the loop end.
 * O(1), exact.
 */
export function activeLoop(
  loop: LoopRegion | null | undefined,
  anchorTick: number,
): LoopBounds | null {
  if (!loop || !loop.enabled) return null;
  if (!(loop.endTick > loop.startTick)) return null;
  if (anchorTick >= loop.endTick) return null;
  return { startTick: loop.startTick, endTick: loop.endTick };
}

/**
 * Creates a clock anchored at (`anchorTime`, `anchorTick`).
 * Units: seconds, ticks, bpm. Pure; O(1).
 */
export function createTransportClock(
  anchorTime: number,
  anchorTick: number,
  bpm: number,
  loop: LoopRegion | null,
): TransportClock {
  if (!(bpm > 0)) throw new Error(`createTransportClock: bpm must be > 0 (got ${bpm})`);
  return { anchorTime, anchorTick, bpm, loop: activeLoop(loop, anchorTick) };
}

/**
 * Unwrapped run coordinate at engine time `time` (linear, may be < anchorTick for
 * times before the anchor). O(1).
 */
export function unwrappedTickAtTime(clock: TransportClock, time: number): number {
  return clock.anchorTick + (time - clock.anchorTime) * ticksPerSecond(clock.bpm);
}

/** Engine time at which the run reaches unwrapped coordinate `u`. Inverse of the above. O(1). */
export function timeAtUnwrappedTick(clock: TransportClock, u: number): number {
  return clock.anchorTime + (u - clock.anchorTick) / ticksPerSecond(clock.bpm);
}

/**
 * Maps an unwrapped coordinate to a timeline tick: identity before `loop.endTick`,
 * then `loop.startTick + ((u − loop.endTick) mod length)`. Exact for integer inputs.
 * O(1).
 */
export function wrapTick(u: number, loop: LoopBounds | null): number {
  if (!loop || u < loop.endTick) return u;
  const length = loop.endTick - loop.startTick;
  return loop.startTick + ((u - loop.endTick) % length);
}

/**
 * Loop iteration of an unwrapped coordinate: 0 before the loop end, then 1, 2, …
 * O(1).
 */
export function loopIteration(u: number, loop: LoopBounds | null): number {
  if (!loop || u < loop.endTick) return 0;
  return Math.floor((u - loop.endTick) / (loop.endTick - loop.startTick)) + 1;
}

/**
 * Timeline tick (loop-wrapped, fractional) at engine time `time`. Times before the
 * anchor extrapolate linearly backwards (useful for latency-compensated recording
 * positions); clamp at the call site if a display position is needed. O(1).
 */
export function tickAtTime(clock: TransportClock, time: number): number {
  return wrapTick(unwrappedTickAtTime(clock, time), clock.loop);
}

/**
 * Re-anchors a running clock at `time` (keeping the current position) with an optional
 * new tempo and/or loop — used for tempo or loop edits during playback so that the
 * position stays continuous. O(1).
 */
export function rebaseClock(
  clock: TransportClock,
  time: number,
  changes: { readonly bpm?: number; readonly loop?: LoopRegion | null } = {},
): TransportClock {
  const tick = tickAtTime(clock, time);
  const loop =
    changes.loop !== undefined
      ? changes.loop
      : clock.loop
        ? { enabled: true, startTick: clock.loop.startTick, endTick: clock.loop.endTick }
        : null;
  return createTransportClock(time, tick, changes.bpm ?? clock.bpm, loop);
}
