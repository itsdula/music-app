/**
 * Control inventory of the AKAI Professional MPK Mini MK3 with what each control sends in
 * the factory default program, and how well that is evidenced.
 *
 * Source: docs/midi-device-research.md (§1, §3, §4). Verification follows the dossier;
 * NOTHING here has been tested on a physical unit, so no control is 'verified-hardware'.
 * Section numbers in notes refer to that dossier.
 */
import { midiToNoteName } from '@studio/domain';
import type { DeviceControl } from '@studio/midi-core';

export const MPK_MINI_MK3_KEY_COUNT = 25;
/** Assumed lowest key at octave 0 (C3 = MIDI 48). UNVERIFIED (§3, §9 Q5). */
export const MPK_MINI_MK3_ASSUMED_LOWEST_NOTE = 48;
export const MPK_MINI_MK3_KEYS_CHANNEL = 1;
export const MPK_MINI_MK3_PADS_CHANNEL = 10;
export const MPK_MINI_MK3_PAD_NOTES_BANK_A = [36, 37, 38, 39, 40, 41, 42, 43] as const;
export const MPK_MINI_MK3_PAD_NOTES_BANK_B = [44, 45, 46, 47, 48, 49, 50, 51] as const;
/** K1..K8 in factory Program 1 "PGM: MPC". */
export const MPK_MINI_MK3_KNOB_CCS = [70, 71, 72, 73, 74, 75, 76, 77] as const;
export const MPK_MINI_MK3_JOYSTICK_Y_CC = 1;
export const MPK_MINI_MK3_SUSTAIN_CC = 64;

const KEY_NOTE =
  'Keys send Note On/Off with velocity. Channel 1 is the setting Akai support articles tell ' +
  'users to set or check (DOC-EXCERPT), not confirmed as the factory default. The lowest ' +
  'note at octave 0 (assumed C3 = 48) is UNVERIFIED; OCT −/+ and the Editor transpose ' +
  'shift every key, so identification only works at the default octave.';

const PAD_NOTE =
  'Note mode on channel 10, Bank A notes 36–43, Bank B 44–51 (General MIDI drum range): ' +
  'assumed by the Zynthian driver against the factory program (COMMUNITY, §3) — not in an ' +
  'Akai document. Velocity- and pressure-sensitive. In CC mode pads send CC 16–31 and in ' +
  'PROG CHANGE mode program changes (numbers UNVERIFIED); FULL LEVEL forces velocity 127.';

const KNOB_NOTE =
  'CC 70–77 (K1–K8) in factory Program 1 "PGM: MPC" per a third-party vendor hardware ' +
  'guide (Spectrasonics, SECONDARY) and community observation of K8 = CC77 (COMMUNITY); not ' +
  'from an Akai document and other programs differ. 360° endless encoder sending Absolute ' +
  '0–127 by default; Relative mode can be selected per knob in the Program Editor ' +
  '(encoding UNVERIFIED). Transmit channel not documented, so any channel is accepted.';

const BUTTON_NOTE =
  'Handled internally by the device (DOC-EXCERPT): sends no MIDI by default as far as ' +
  'known. Whether anything is transmitted is UNVERIFIED (§9 Q16–17).';

const keys: DeviceControl[] = Array.from({ length: MPK_MINI_MK3_KEY_COUNT }, (_, index) => {
  const note = MPK_MINI_MK3_ASSUMED_LOWEST_NOTE + index;
  return {
    id: `key.${index}`,
    kind: 'key',
    label: `Key ${index + 1} (${midiToNoteName(note)})`,
    defaultSource: { kind: 'note', channel: MPK_MINI_MK3_KEYS_CHANNEL, note, behavior: 'gate' },
    verification: 'unverified',
    note: KEY_NOTE,
  };
});

const pads: DeviceControl[] = (['A', 'B'] as const).flatMap((bank) =>
  (bank === 'A' ? MPK_MINI_MK3_PAD_NOTES_BANK_A : MPK_MINI_MK3_PAD_NOTES_BANK_B).map(
    (note, index): DeviceControl => ({
      id: `pad.${bank}${index + 1}`,
      kind: 'pad',
      label: `PAD ${index + 1} (Bank ${bank})`,
      defaultSource: { kind: 'note', channel: MPK_MINI_MK3_PADS_CHANNEL, note, behavior: 'gate' },
      verification: 'community',
      note: PAD_NOTE,
    }),
  ),
);

const knobs: DeviceControl[] = MPK_MINI_MK3_KNOB_CCS.map((controller, index) => ({
  id: `knob.K${index + 1}`,
  kind: 'knob',
  label: `K${index + 1}`,
  defaultSource: { kind: 'cc', channel: 'any', controller, mode: 'absolute' },
  // Evidence is a third-party guide plus community observation, not an Akai document.
  verification: 'community',
  note: KNOB_NOTE,
}));

const joystick: DeviceControl[] = [
  {
    id: 'joystick.x',
    kind: 'joystickX',
    label: 'Joystick X (left/right)',
    defaultSource: { kind: 'pitchBend', channel: 'any' },
    verification: 'documented',
    note:
      'Left/right bends pitch by default (DOC-EXCERPT + SECONDARY reviews). Per axis the ' +
      'Editor offers Pitch Bend, Single CC or Dual CC. Centre value and dead zone UNVERIFIED.',
  },
  {
    id: 'joystick.y',
    kind: 'joystickY',
    label: 'Joystick Y (up/down)',
    defaultSource: {
      kind: 'cc',
      channel: 'any',
      controller: MPK_MINI_MK3_JOYSTICK_Y_CC,
      mode: 'absolute',
    },
    verification: 'documented',
    note:
      'Up/down applies modulation, CC1 (DOC-EXCERPT + SECONDARY reviews). Whether pushing ' +
      'down sends anything in the factory program is UNVERIFIED (§9 Q7).',
  },
];

const pedal: DeviceControl = {
  id: 'pedal.sustain',
  kind: 'pedal',
  label: 'Sustain pedal input (rear 1/4" jack)',
  defaultSource: {
    kind: 'cc',
    channel: 'any',
    controller: MPK_MINI_MK3_SUSTAIN_CC,
    mode: 'absolute',
  },
  verification: 'unverified',
  note:
    'The jack exists (DOC-EXCERPT). CC64, its values, channel and pedal polarity are ' +
    'UNVERIFIED — no source states them (§9 Q6).',
};

const BUTTONS: ReadonlyArray<readonly [id: string, label: string]> = [
  ['button.arpOnOff', 'ARPEGGIATOR ON/OFF'],
  ['button.tapTempo', 'TAP TEMPO'],
  ['button.octaveDown', 'OCT -'],
  ['button.octaveUp', 'OCT +'],
  ['button.fullLevel', 'FULL LEVEL'],
  ['button.noteRepeat', 'NOTE REPEAT'],
  ['button.bankAB', 'BANK A/B'],
  ['button.padCC', 'CC'],
  ['button.padProgramChange', 'PROG CHANGE'],
  ['button.programSelect', 'PROG SELECT'],
];

const buttons: DeviceControl[] = BUTTONS.map(([id, label]) => ({
  id,
  kind: 'button',
  label,
  verification: 'unverified',
  note: BUTTON_NOTE,
}));

export const MPK_MINI_MK3_CONTROLS: readonly DeviceControl[] = [
  ...keys,
  ...pads,
  ...knobs,
  ...joystick,
  pedal,
  ...buttons,
];

export function mpkPadControlId(bank: 'A' | 'B', pad: number): string {
  return `pad.${bank}${pad}`;
}
