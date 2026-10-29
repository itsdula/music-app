/**
 * Metronome click positions.
 */
import { ticksPerBar, ticksPerBeat, type TimeSignature } from '@studio/domain';

export interface MetronomeClick {
  /** Timeline tick of the click (integer multiple of the beat length). */
  readonly tick: number;
  /** True on the first beat of a bar. */
  readonly accent: boolean;
}

/**
 * Clicks on every beat (1/denominator note) whose tick lies in [startTick, endTick).
 * Bars start at tick 0 and repeat every `ticksPerBar(meter)`; negative ticks (count-in
 * before the timeline start) are supported with the same grid.
 *
 * - Units: ticks. Determinism: exact integer arithmetic for integer bounds.
 * - Complexity: O(1 + clicks returned).
 */
export function metronomeClicksInRange(
  startTick: number,
  endTick: number,
  meter: TimeSignature,
): MetronomeClick[] {
  const beat = ticksPerBeat(meter);
  const bar = ticksPerBar(meter);
  const clicks: MetronomeClick[] = [];
  if (!(endTick > startTick) || !(beat > 0)) return clicks;
  for (let k = Math.ceil(startTick / beat); k * beat < endTick; k++) {
    const tick = k * beat;
    const inBar = ((tick % bar) + bar) % bar;
    clicks.push({ tick, accent: inBar === 0 });
  }
  return clicks;
}
