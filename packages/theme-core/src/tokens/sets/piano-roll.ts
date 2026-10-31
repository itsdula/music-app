import { lit, ref, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('piano-roll', { canvas: true });
const v = setValue('piano-roll', { canvas: true });

export const PIANO_ROLL_TOKENS: readonly TokenDef[] = [
  c('piano-roll-row', ref('card')),
  c('piano-roll-row-black', ref('background')),
  c('piano-roll-row-scale', ref('primary', 0.05)),
  c('piano-roll-row-octave', ref('border-strong')),
  c('piano-roll-row-line', ref('border', 0.6)),
  c('piano-roll-grid-bar', ref('border-strong')),
  c('piano-roll-grid-beat', ref('border')),
  c('piano-roll-grid-sub', ref('border', 0.45)),
  c('note-outline', lit('#00000059')),
  c('note-outline-selected', ref('foreground')),
  c('note-label', ref('foreground')),
  v('note-shade-low', 'number', -0.35, { range: [-1, 1] }),
  v('note-shade-selected', 'number', 0.35, { range: [-1, 1] }),
  // Keys are a physical material: the same in both modes.
  c('piano-key-white', lit('#d9dbe0'), { invariant: true }),
  c('piano-key-white-border', lit('#a9adb6'), { invariant: true }),
  c('piano-key-black', lit('#1b1e25'), { invariant: true }),
  c('piano-key-black-border', lit('#0d0f13'), { invariant: true }),
  c('piano-key-label', lit('#4a4f5a'), { invariant: true }),
  c('piano-key-active', ref('primary')),
  c('piano-key-active-label', ref('primary-foreground')),
  c('velocity-lane', ref('background')),
  c('velocity-divider', ref('border')),
  c('velocity-bar-selected', ref('foreground')),
  v('velocity-bar-shade', 'number', -0.1, { range: [-1, 1] }),
];
