import { ref, type TokenDef } from '../registry';
import { setColor, setValue } from './helpers';

const c = setColor('devices', { utility: true });
const v = setValue('devices');

/** Knobs, faders and device panels. */
export const DEVICES_TOKENS: readonly TokenDef[] = [
  c('device', ref('card')),
  c('device-header', ref('popover')),
  c('device-border', ref('border')),
  c('control-track', ref('muted')),
  c('control-fill', ref('primary')),
  c('control-thumb', ref('foreground')),
  c('control-thumb-border', ref('input')),
  c('knob-cap', ref('secondary')),
  c('knob-cap-metal', ref('secondary')),
  c('knob-pointer', ref('foreground')),
  v('knob-size', 'length', '32px', { range: [16, 96] }),
  v('fader-thumb-size', 'length', '12px', { range: [6, 32] }),
  v('fader-track-size', 'length', '4px', { range: [1, 16] }),
];
