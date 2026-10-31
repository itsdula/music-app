import { ref, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('waveform', { canvas: true });
const v = setValue('waveform', { canvas: true });

export const WAVEFORM_TOKENS: readonly TokenDef[] = [
  c('waveform-color', ref('muted-foreground')),
  c('waveform-progress-color', ref('primary')),
  c('waveform-cursor', ref('foreground')),
  c('waveform-hover', ref('foreground', 0.5)),
  c('waveform-region', ref('primary', 0.25)),
  c('waveform-region-border', ref('primary')),
  c('waveform-marker', ref('warning')),
  v('waveform-bar-radius', 'length', '2px', { range: [0, 8] }),
  c('spectrum', ref('primary')),
  c('spectrum-grid', ref('border')),
  c('spectrum-peak', ref('foreground')),
];
