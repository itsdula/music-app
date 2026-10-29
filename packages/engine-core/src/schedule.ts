/**
 * Scheduling-window planning.
 *
 * A lookahead scheduler repeatedly asks "what happens in the next window of engine
 * time?". Windows are expressed in the clock's unwrapped tick coordinate (see clock.ts)
 * so consecutive windows share exact boundaries. This module splits such a window into
 * contiguous timeline segments: one per loop iteration touched. Each segment carries the
 * engine time of its first tick, the tick after which sound must stop for the current
 * pass (the loop end, a render end, or +∞), and whether it starts at a discontinuity
 * (playback start, seek, loop wrap) where sounds already "in progress" on the timeline —
 * e.g. an audio clip spanning the loop start — must be (re)started mid-way.
 */
import { loopIteration, timeAtUnwrappedTick, ticksPerSecond, type TransportClock } from './clock';

export interface ScheduleSegment {
  /** Timeline ticks covered, half-open [startTick, endTick). */
  readonly startTick: number;
  readonly endTick: number;
  /** Unwrapped coordinate of `startTick` (monotonic across segments). */
  readonly startUnwrapped: number;
  /** Engine time (s) of `startTick` in this pass. */
  readonly startTime: number;
  /** Seconds per tick at the clock tempo (informational; times are computed by division). */
  readonly secondsPerTick: number;
  /** Ticks per second at the clock tempo (`bpm · PPQ / 60`). */
  readonly ticksPerSecond: number;
  /**
   * Timeline tick at which everything started in this pass must stop: the loop end
   * when looping, else the render end (`options.endTick`) or +∞.
   */
  readonly boundaryTick: number;
  /** True when `startTick` begins a new pass (start/seek/loop wrap). */
  readonly discontinuity: boolean;
  /** Loop iteration (0 before the first wrap). */
  readonly iteration: number;
}

export interface PlanOptions {
  /** Whether `fromUnwrapped` itself is a discontinuity (first window after play/seek). */
  readonly startIsDiscontinuity?: boolean;
  /** Linear (non-loop) hard end, e.g. the end of an offline render. */
  readonly endTick?: number;
}

/**
 * Splits the unwrapped window [fromUnwrapped, toUnwrapped) into timeline segments.
 *
 * Guarantees: segments are in time order, contiguous in the unwrapped coordinate, each
 * lies inside one loop pass (never crosses `loop.endTick`), and their union covers the
 * window exactly. Segments at a loop wrap have `discontinuity = true`. With a linear
 * `endTick`, the window is truncated at it. Empty windows yield [].
 *
 * - Units: ticks in, ticks and seconds out.
 * - Determinism: loop boundaries are computed from integer loop bounds, so a window that
 *   ends exactly on a loop end and the next window starting there agree exactly.
 * - Complexity: O(1 + number of loop iterations crossed).
 */
export function planScheduleSegments(
  clock: TransportClock,
  fromUnwrapped: number,
  toUnwrapped: number,
  options: PlanOptions = {},
): ScheduleSegment[] {
  const segments: ScheduleSegment[] = [];
  const loop = clock.loop;
  const tps = ticksPerSecond(clock.bpm);
  const secondsPerTick = 1 / tps;
  let to = toUnwrapped;
  if (!loop && options.endTick !== undefined) to = Math.min(to, options.endTick);
  if (!(to > fromUnwrapped)) return segments;
  const linearBoundary = options.endTick ?? Number.POSITIVE_INFINITY;

  let cursor = fromUnwrapped;
  let first = true;
  while (cursor < to) {
    if (!loop || cursor < loop.endTick) {
      const end = loop ? Math.min(to, loop.endTick) : to;
      segments.push({
        startTick: cursor,
        endTick: end,
        startUnwrapped: cursor,
        startTime: timeAtUnwrappedTick(clock, cursor),
        secondsPerTick,
        ticksPerSecond: tps,
        boundaryTick: loop ? loop.endTick : linearBoundary,
        discontinuity: first && options.startIsDiscontinuity === true,
        iteration: 0,
      });
      cursor = end;
    } else {
      const length = loop.endTick - loop.startTick;
      const iteration = loopIteration(cursor, loop);
      const passStart = loop.endTick + (iteration - 1) * length;
      const passEnd = passStart + length;
      const end = Math.min(to, passEnd);
      segments.push({
        startTick: loop.startTick + (cursor - passStart),
        endTick: loop.startTick + (end - passStart),
        startUnwrapped: cursor,
        startTime: timeAtUnwrappedTick(clock, cursor),
        secondsPerTick,
        ticksPerSecond: tps,
        boundaryTick: loop.endTick,
        discontinuity: cursor === passStart || (first && options.startIsDiscontinuity === true),
        iteration,
      });
      cursor = end;
    }
    first = false;
  }
  return segments;
}

/**
 * Engine time of a timeline tick inside a segment:
 * `startTime + (tick − startTick) / ticksPerSecond`. Division (not multiplication by a
 * rounded reciprocal) keeps musically round positions exact — e.g. 1920 ticks at
 * 120 bpm is exactly 1 s — so repeated loop passes start on identical sample offsets.
 * O(1).
 */
export function segmentTimeAtTick(segment: ScheduleSegment, tick: number): number {
  return segment.startTime + (tick - segment.startTick) / segment.ticksPerSecond;
}
