import { ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('transport', { utility: true });

export const TRANSPORT_TOKENS: readonly TokenDef[] = [
  c('transport', ref('card')),
  c('transport-display', ref('background')),
  c('transport-display-foreground', ref('foreground')),
  c('transport-record', ref('record')),
  c('transport-active', ref('primary')),
  c('transport-play-active', ref('success')),
];
