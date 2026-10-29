/**
 * Suggested global mappings for the MPK Mini MK3 knobs (factory Program 1 CCs).
 *
 * Keys and pads are intentionally NOT mapped: note input is routed by the app to the
 * armed/selected instrument track (pads' default notes 36–51 are General MIDI drum notes).
 * The joystick's pitch bend / CC1 go to instruments as live expression, not mappings.
 */
import { DEFAULT_VALUE_TRANSFORM, type MidiMapping, type ParameterAddress } from '@studio/domain';
import { MPK_MINI_MK3_KNOB_CCS } from './controls';

export const MPK_MINI_MK3_PROFILE_ID = 'akai.mpk-mini-mk3';

const KNOB_TARGETS: ReadonlyArray<readonly [ParameterAddress, string]> = [
  [{ scope: 'selectedTrack', param: 'gainDb' }, 'Selected track volume'],
  [{ scope: 'selectedTrack', param: 'pan' }, 'Selected track pan'],
  [{ scope: 'selectedInstrument', param: 'cutoffHz' }, 'Instrument cutoff'],
  [{ scope: 'selectedInstrument', param: 'resonance' }, 'Instrument resonance'],
  [{ scope: 'selectedInstrument', param: 'attack' }, 'Instrument attack'],
  [{ scope: 'selectedInstrument', param: 'release' }, 'Instrument release'],
  [{ scope: 'selectedInstrument', param: 'filterEnvAmount' }, 'Instrument filter env amount'],
  [{ scope: 'selectedInstrument', param: 'osc2Mix' }, 'Instrument osc 2 mix'],
];

export function mpkMiniMk3DefaultMappings(): Array<Omit<MidiMapping, 'id'>> {
  return KNOB_TARGETS.map(([address, targetLabel], index) => ({
    source: {
      kind: 'cc',
      channel: 'any',
      controller: MPK_MINI_MK3_KNOB_CCS[index] ?? 70 + index,
      mode: 'absolute',
    },
    device: { profileId: MPK_MINI_MK3_PROFILE_ID },
    target: { kind: 'parameter', address },
    transform: { ...DEFAULT_VALUE_TRANSFORM, takeover: 'pickup' },
    scope: 'global',
    enabled: true,
    label: `MPK Mini MK3 K${index + 1} → ${targetLabel}`,
  }));
}
