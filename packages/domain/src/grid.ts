import { PPQ, ticksPerBar, ticksPerBeat, type Ticks, type TimeSignature } from './time';

/**
 * Grid divisions. Straight divisions are fractions of a whole note; `T` suffix
 * denotes triplets (2/3 of the straight value). `bar`/`beat` follow the meter.
 */
export type GridDivision =
  | 'bar'
  | 'beat'
  | '1/1'
  | '1/2'
  | '1/4'
  | '1/8'
  | '1/16'
  | '1/32'
  | '1/64'
  | '1/2T'
  | '1/4T'
  | '1/8T'
  | '1/16T'
  | '1/32T';

export const GRID_DIVISIONS: readonly GridDivision[] = [
  'bar',
  'beat',
  '1/1',
  '1/2',
  '1/4',
  '1/8',
  '1/16',
  '1/32',
  '1/64',
  '1/2T',
  '1/4T',
  '1/8T',
  '1/16T',
  '1/32T',
];

export type SnapMode = 'round' | 'floor' | 'ceil';

/** Length of one grid step in ticks. Always an integer for PPQ = 960. */
export function gridDivisionTicks(division: GridDivision, meter: TimeSignature): Ticks {
  switch (division) {
    case 'bar':
      return ticksPerBar(meter);
    case 'beat':
      return ticksPerBeat(meter);
    default: {
      const triplet = division.endsWith('T');
      const denominator = Number(division.slice(2, triplet ? -1 : undefined));
      const straight = (PPQ * 4) / denominator;
      return triplet ? (straight * 2) / 3 : straight;
    }
  }
}

/** Snaps a tick to the grid anchored at tick 0. `gridTicks <= 0` disables snapping. */
export function snapTick(tick: number, gridTicks: Ticks, mode: SnapMode = 'round'): Ticks {
  if (gridTicks <= 0) return Math.round(tick);
  const steps = tick / gridTicks;
  const snapped =
    mode === 'floor' ? Math.floor(steps) : mode === 'ceil' ? Math.ceil(steps) : Math.round(steps);
  // `|| 0` normalizes -0 (e.g. rounding -0.1 steps), which would otherwise leak into positions.
  return snapped * gridTicks || 0;
}

/**
 * Snaps a moving item by its start: returns the delta that places `originalStart + rawDelta`
 * on the grid. Used by drag gestures so that items keep their relative offsets.
 */
export function snapDelta(originalStart: Ticks, rawDelta: number, gridTicks: Ticks): Ticks {
  return snapTick(originalStart + rawDelta, gridTicks) - originalStart;
}

export interface QuantizeOptions {
  readonly gridTicks: Ticks;
  /** 0 = no change, 1 = fully on grid. */
  readonly strength: number;
  /** Swing amount 0..1 applied to every second grid step (0.5 ≈ triplet feel at 1/8). */
  readonly swing?: number;
  /** When true note ends are quantized too (lengths keep >= 1 grid step / minimum). */
  readonly quantizeEnds?: boolean;
}

/** Quantizes a single position with strength and optional swing. */
export function quantizeTick(tick: Ticks, options: QuantizeOptions): Ticks {
  const { gridTicks, strength } = options;
  if (gridTicks <= 0 || strength <= 0) return tick;
  const index = Math.round(tick / gridTicks);
  let target = index * gridTicks;
  const swing = options.swing ?? 0;
  if (swing > 0 && index % 2 !== 0) target += Math.round((gridTicks * swing) / 2);
  return Math.round(tick + (target - tick) * Math.min(1, strength));
}
