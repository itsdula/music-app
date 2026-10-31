import { lit, modal, ref, type TokenDef } from '../registry';
import { setColor } from './helpers';

const c = setColor('overlays', { utility: true });

/** Applied on `.studio-portal-root`. Menus use the global popover/accent tokens. */
export const OVERLAYS_TOKENS: readonly TokenDef[] = [
  c('overlay-scrim', modal(lit('#00000080'), lit('#0000004d'))),
  c('tooltip', ref('invert')),
  c('tooltip-foreground', ref('invert-foreground')),
  c('kbd', ref('muted')),
  c('kbd-foreground', ref('muted-foreground')),
];
