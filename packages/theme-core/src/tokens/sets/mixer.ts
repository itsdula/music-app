import { ref, type ContrastCheck, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('mixer', { utility: true });
const v = setValue('mixer');

const tint = (of: string): ContrastCheck[] => [
  { vs: ['background'], min: 4.5 },
  { vs: ['background'], min: 4.5, tint: { token: of, alpha: 0.15 } },
];

const channel = (role: string, base: string): TokenDef[] => [
  c(`channel-${role}`, ref(base)),
  c(`channel-${role}-foreground`, ref(`channel-${role}`), {
    contract: tint(`channel-${role}`),
    fg: { kind: 'tint-text', of: `channel-${role}` },
  }),
  c(`channel-${role}-soft`, { op: 'soft', token: `channel-${role}`, alpha: 0.16, base: 'card' }),
  c(`channel-${role}-soft-foreground`, ref(`channel-${role}`), {
    contract: [{ vs: [`channel-${role}-soft`], min: 4.5 }],
    fg: { kind: 'tint-text', of: `channel-${role}-soft` },
  }),
];

export const MIXER_TOKENS: readonly TokenDef[] = [
  c('mixer', ref('background')),
  c('mixer-strip', ref('card')),
  c('mixer-strip-selected', ref('primary', 0.08)),
  c('mixer-strip-border', ref('border')),
  c('mixer-master', ref('popover')),
  v('channel-strip-width', 'length', '84px', { range: [48, 160] }),
  v('mixer-gap', 'length', '8px', { range: [0, 24] }),
  c('channel-accent', ref('primary')),
  c(
    'channel-accent-foreground',
    { op: 'on', token: 'channel-accent' },
    {
      fg: { kind: 'on-fill', of: 'channel-accent' },
    },
  ),
  ...channel('mute', 'warning'),
  ...channel('solo', 'primary'),
  ...channel('monitor', 'info'),
  ...channel('arm', 'record'),
];
