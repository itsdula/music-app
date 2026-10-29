import type { MidiDeviceProfile } from '@studio/midi-core';
import { MPK_MINI_MK3_CAPABILITIES } from './capabilities';
import { MPK_MINI_MK3_CONTROLS } from './controls';
import { MPK_MINI_MK3_PROFILE_ID, mpkMiniMk3DefaultMappings } from './default-mappings';
import { identifyMpkMiniMk3 } from './identify';
import { MPK_MINI_MK3_LAYOUT } from './layout';
import { matchMpkMiniMk3Port } from './port-matching';

/**
 * AKAI Professional MPK Mini MK3 profile, built from docs/midi-device-research.md.
 * Works over standard MIDI only; never sends SysEx. Not tested on hardware yet.
 */
export const mpkMiniMk3Profile: MidiDeviceProfile = {
  id: MPK_MINI_MK3_PROFILE_ID,
  displayName: 'AKAI Professional MPK Mini MK3',
  manufacturer: 'AKAI Professional',
  matchPort: matchMpkMiniMk3Port,
  controls: MPK_MINI_MK3_CONTROLS,
  identify: identifyMpkMiniMk3,
  defaultMappings: mpkMiniMk3DefaultMappings,
  capabilities: MPK_MINI_MK3_CAPABILITIES,
  layout: MPK_MINI_MK3_LAYOUT,
};
