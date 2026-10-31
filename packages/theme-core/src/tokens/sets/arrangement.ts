import { lit, ref, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('arrangement', { canvas: true });
const v = setValue('arrangement', { canvas: true });

export const ARRANGEMENT_TOKENS: readonly TokenDef[] = [
  c('arrangement-lane', ref('background')),
  c('arrangement-lane-selected', ref('primary', 0.05)),
  c('arrangement-lane-divider', ref('border')),
  c('arrangement-header', ref('card')),
  c('arrangement-header-selected', ref('accent')),
  v('clip-radius', 'length', (x) => `${Number(((x.seeds.radius * 2) / 3).toFixed(3))}px`, {
    deps: ['$radius'],
    range: [0, 16],
  }),
  v('clip-fill-opacity', 'number', 0.22, { range: [0, 1] }),
  v('clip-fill-opacity-selected', 'number', 0.34, { range: [0, 1] }),
  v('clip-header-opacity', 'number', 0.7, { range: [0, 1] }),
  v('clip-header-opacity-selected', 'number', 0.95, { range: [0, 1] }),
  c('clip-outline-selected', ref('foreground')),
  c('clip-label', ref('foreground')),
  c('clip-label-shadow', lit('#00000073')),
  v('clip-waveform-lighten', 'number', 0.45, { range: [0, 1] }),
  v('clip-midi-lighten', 'number', 0.4, { range: [0, 1] }),
  c('clip-fade-shade', ref('background', 0.4)),
];
