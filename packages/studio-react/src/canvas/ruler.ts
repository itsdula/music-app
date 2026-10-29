/**
 * Ruler and grid line computation for musical axes. Picks the finest musically meaningful
 * subdivision whose on-screen spacing stays above a minimum, so grids stay legible at
 * every zoom level. Pure and allocation-light; used by every timeline renderer.
 */
import { PPQ, ticksPerBar, ticksPerBeat, type TimeSignature } from '@studio/domain';
import type { TimeAxis } from './time-axis';

export type GridLineLevel = 'bar' | 'beat' | 'sub';

export interface GridLine {
  readonly tick: number;
  readonly x: number;
  readonly level: GridLineLevel;
  /** 1-based bar number for bar lines. */
  readonly bar?: number;
}

/** Candidate subdivisions in ticks, coarse → fine, for a meter. */
function subdivisionCandidates(meter: TimeSignature): number[] {
  const beat = ticksPerBeat(meter);
  const candidates = [beat / 2, beat / 4, PPQ / 8, PPQ / 16];
  return [...new Set(candidates.filter((c) => Number.isInteger(c) && c > 0 && c < beat))].sort((a, b) => b - a);
}

/**
 * Returns grid lines for the visible range. `minSpacingPx` controls density for each level.
 * Bars are always considered; if even bars are too dense, every Nth bar (power of two) is used.
 */
export function computeGridLines(
  axis: TimeAxis,
  widthPx: number,
  meter: TimeSignature,
  minSpacingPx = 10,
): GridLine[] {
  const { startTick, endTick } = axis.visibleRange(widthPx);
  const bar = ticksPerBar(meter);
  const beat = ticksPerBeat(meter);
  let barStep = 1;
  while (axis.span(bar * barStep) < minSpacingPx * 2.5 && barStep < 4096) barStep *= 2;

  const showBeats = barStep === 1 && axis.span(beat) >= minSpacingPx;
  let sub = 0;
  if (showBeats) {
    for (const candidate of subdivisionCandidates(meter)) {
      if (axis.span(candidate) >= minSpacingPx) sub = candidate;
    }
  }
  const step = sub || (showBeats ? beat : bar * barStep);
  const first = Math.max(0, Math.floor(startTick / step) * step);
  const lines: GridLine[] = [];
  for (let tick = first; tick < endTick; tick += step) {
    const x = axis.tickToX(tick);
    if (tick % bar === 0) {
      const barIndex = tick / bar;
      if (barIndex % barStep === 0) lines.push({ tick, x, level: 'bar', bar: barIndex + 1 });
    } else if (tick % beat === 0) {
      lines.push({ tick, x, level: 'beat' });
    } else {
      lines.push({ tick, x, level: 'sub' });
    }
  }
  return lines;
}
