import { GRAPHIC_VS_BG, lit, modal, ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('vocal-editor', { canvas: true });

export const VOCAL_EDITOR_TOKENS: readonly TokenDef[] = [
  c('vocal-row', ref('card')),
  c('vocal-row-black', ref('background')),
  c('vocal-row-tonic', ref('primary', 0.12)),
  c('vocal-row-scale', ref('primary', 0.06)),
  c('vocal-note', modal(lit('#7fb8f0'), ref('info')), { contract: GRAPHIC_VS_BG }),
  c('vocal-note-bypassed', ref('faint-foreground')),
  c('vocal-target', ref('primary-strong')),
  c('vocal-detected', ref('foreground', 0.6)),
  c('vocal-breath', lit('#5fa8d3'), { contract: GRAPHIC_VS_BG }),
  c('vocal-sibilant', ref('warning')),
  c('vocal-unvoiced', ref('muted-foreground')),
  c('vocal-silence', ref('border')),
];
