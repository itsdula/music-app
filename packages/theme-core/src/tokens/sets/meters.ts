import { ref, type ContrastCheck, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('meters', { utility: true, canvas: true });
const v = setValue('meters', { canvas: true });

const VS_TRACK: ContrastCheck[] = [{ vs: ['meter-track'], min: 3 }];
const tint = (of: string): ContrastCheck[] => [
  { vs: ['background'], min: 4.5 },
  { vs: ['background'], min: 4.5, tint: { token: of, alpha: 0.15 } },
];

export const METERS_TOKENS: readonly TokenDef[] = [
  c('meter-track', ref('muted')),
  c('meter-ok', ref('success'), { contract: VS_TRACK }),
  c('meter-ok-foreground', ref('meter-ok'), { contract: tint('meter-ok') }),
  c('meter-warn', ref('warning'), { contract: VS_TRACK }),
  c('meter-warn-foreground', ref('meter-warn'), { contract: tint('meter-warn') }),
  c('meter-clip', ref('destructive'), { contract: VS_TRACK }),
  c('meter-clip-foreground', ref('meter-clip'), { contract: tint('meter-clip') }),
  c('meter-peak', ref('foreground')),
  c('meter-scale', ref('faint-foreground')),
  v('meter-thickness', 'length', '6px', { range: [2, 24] }),
  v('meter-gap', 'length', '1px', { range: [0, 8] }),
];
