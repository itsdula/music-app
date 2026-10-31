import { GRAPHIC_VS_BG, ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('timeline', { canvas: true });

/** Ruler, grid, playhead and loop: the canvas base shared by every timeline view. */
export const TIMELINE_TOKENS: readonly TokenDef[] = [
  c('timeline-ruler', ref('card')),
  c('timeline-ruler-label', ref('muted-foreground')),
  c('timeline-ruler-tick', ref('faint-foreground')),
  c('timeline-ruler-tick-minor', ref('border')),
  c('timeline-grid-bar', ref('border-strong', 0.9)),
  c('timeline-grid-beat', ref('border', 0.7)),
  c('timeline-grid-sub', ref('border', 0.35)),
  c('timeline-playhead', ref('foreground'), { contract: GRAPHIC_VS_BG }),
  c('timeline-playhead-recording', ref('record')),
  c('timeline-loop', ref('primary', 0.55)),
  c('timeline-loop-inactive', ref('muted-foreground', 0.35)),
  c('timeline-loop-region', ref('primary', 0.04)),
  c('timeline-selection', ref('primary', 0.1)),
  c('timeline-selection-border', ref('primary', 0.8)),
  c('timeline-out-of-range', ref('background', 0.5)),
  // Registry aliases (@audio-ui timeline).
  c('timeline-grid-color', ref('timeline-grid-beat'), { canvas: false }),
  c('timeline-grid-accent-color', ref('timeline-grid-bar'), { canvas: false }),
];
