/**
 * Validated, semantic MIDI messages. Raw bytes from hosts are untrusted (`RawMidiInput`)
 * and become `MidiMessage` only through `parseMidiMessage`.
 *
 * Conventions: `channel` is 1..16 (human numbering) everywhere in Studio; note-on with
 * velocity 0 is normalized to `noteOff`; pitch bend is a signed value -8192..8191.
 */

export type MidiChannelVoiceMessage =
  | {
      readonly type: 'noteOn';
      readonly channel: number;
      readonly note: number;
      readonly velocity: number;
    }
  | {
      readonly type: 'noteOff';
      readonly channel: number;
      readonly note: number;
      readonly velocity: number;
    }
  | {
      readonly type: 'polyPressure';
      readonly channel: number;
      readonly note: number;
      readonly pressure: number;
    }
  | {
      readonly type: 'controlChange';
      readonly channel: number;
      readonly controller: number;
      readonly value: number;
    }
  | { readonly type: 'programChange'; readonly channel: number; readonly program: number }
  | { readonly type: 'channelPressure'; readonly channel: number; readonly pressure: number }
  | { readonly type: 'pitchBend'; readonly channel: number; readonly value: number };

export type MidiSystemMessage =
  | { readonly type: 'sysex'; readonly bytes: Uint8Array }
  | { readonly type: 'mtcQuarterFrame'; readonly value: number }
  | { readonly type: 'songPosition'; readonly sixteenths: number }
  | { readonly type: 'songSelect'; readonly song: number }
  | { readonly type: 'tuneRequest' }
  | { readonly type: 'clock' }
  | { readonly type: 'start' }
  | { readonly type: 'continue' }
  | { readonly type: 'stop' }
  | { readonly type: 'activeSensing' }
  | { readonly type: 'systemReset' };

export type MidiMessage = MidiChannelVoiceMessage | MidiSystemMessage;
export type MidiMessageType = MidiMessage['type'];

export type MidiParseErrorCode =
  | 'empty'
  | 'unexpected-data-byte'
  | 'truncated'
  | 'data-out-of-range'
  | 'unterminated-sysex'
  | 'undefined-status';

export interface MidiParseError {
  readonly code: MidiParseErrorCode;
  readonly message: string;
}

/** Well-known controller numbers. */
export const CC = {
  modulation: 1,
  breath: 2,
  volume: 7,
  pan: 10,
  expression: 11,
  sustain: 64,
  allSoundOff: 120,
  resetAllControllers: 121,
  allNotesOff: 123,
} as const;
