/**
 * Parsing and encoding of single, complete MIDI messages (the unit Web MIDI delivers).
 *
 * Raw bytes are untrusted: `parseMidiMessage` never throws and reports malformed input as
 * a `MidiParseError`. `encodeMidiMessage` operates on values the application created, so
 * out-of-range fields are programming errors and throw a `RangeError`.
 */
import { err, ok, type Result } from '@studio/domain';
import type {
  MidiChannelVoiceMessage,
  MidiMessage,
  MidiParseError,
  MidiParseErrorCode,
} from './messages';

const fail = (code: MidiParseErrorCode, message: string): Result<never, MidiParseError> =>
  err({ code, message });

/** Number of data bytes that follow a channel-voice status nibble (0x8..0xE). */
export function channelVoiceDataLength(status: number): 1 | 2 {
  const kind = status & 0xf0;
  return kind === 0xc0 || kind === 0xd0 ? 1 : 2;
}

/**
 * Number of data bytes following a system-common status byte, or `undefined` for the
 * undefined statuses 0xF4/0xF5 and for bytes that are not system-common.
 */
export function systemCommonDataLength(status: number): number | undefined {
  switch (status) {
    case 0xf1:
    case 0xf3:
      return 1;
    case 0xf2:
      return 2;
    case 0xf6:
      return 0;
    default:
      return undefined;
  }
}

/** True for system real-time status bytes (0xF8..0xFF), which may appear anywhere. */
export function isRealTimeStatus(byte: number): boolean {
  return byte >= 0xf8 && byte <= 0xff;
}

const REAL_TIME: Readonly<Record<number, MidiMessage | undefined>> = {
  0xf8: { type: 'clock' },
  0xfa: { type: 'start' },
  0xfb: { type: 'continue' },
  0xfc: { type: 'stop' },
  0xfe: { type: 'activeSensing' },
  0xff: { type: 'systemReset' },
};

function hex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

function checkData(
  bytes: Uint8Array,
  from: number,
  to: number,
): Result<never, MidiParseError> | null {
  for (let i = from; i < to; i++) {
    const byte = bytes[i] ?? 0;
    if (byte > 0x7f) {
      return fail('data-out-of-range', `Data byte ${i} is 0x${hex(byte)} (must be 0x00..0x7F)`);
    }
  }
  return null;
}

function checkExactLength(
  bytes: Uint8Array,
  expected: number,
  label: string,
): Result<never, MidiParseError> | null {
  if (bytes.length < expected) {
    return fail('truncated', `${label} needs ${expected} bytes but ${bytes.length} were received`);
  }
  const dataError = checkData(bytes, 1, expected);
  if (dataError) return dataError;
  if (bytes.length > expected) {
    return fail(
      'unexpected-data-byte',
      `${bytes.length - expected} unexpected trailing byte(s) after ${label}`,
    );
  }
  return null;
}

function parseChannelVoice(bytes: Uint8Array, status: number): Result<MidiMessage, MidiParseError> {
  const length = 1 + channelVoiceDataLength(status);
  const problem = checkExactLength(bytes, length, `status 0x${hex(status)}`);
  if (problem) return problem;
  const channel = (status & 0x0f) + 1;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;
  let message: MidiChannelVoiceMessage;
  switch (status & 0xf0) {
    case 0x80:
      message = { type: 'noteOff', channel, note: d1, velocity: d2 };
      break;
    case 0x90:
      message =
        d2 === 0
          ? { type: 'noteOff', channel, note: d1, velocity: 0 }
          : { type: 'noteOn', channel, note: d1, velocity: d2 };
      break;
    case 0xa0:
      message = { type: 'polyPressure', channel, note: d1, pressure: d2 };
      break;
    case 0xb0:
      message = { type: 'controlChange', channel, controller: d1, value: d2 };
      break;
    case 0xc0:
      message = { type: 'programChange', channel, program: d1 };
      break;
    case 0xd0:
      message = { type: 'channelPressure', channel, pressure: d1 };
      break;
    default:
      message = { type: 'pitchBend', channel, value: ((d2 << 7) | d1) - 8192 };
      break;
  }
  return ok(message);
}

function parseSysex(bytes: Uint8Array): Result<MidiMessage, MidiParseError> {
  for (let i = 1; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    if (byte === 0xf7) {
      if (i !== bytes.length - 1) {
        return fail(
          'unexpected-data-byte',
          `${bytes.length - 1 - i} unexpected trailing byte(s) after End of Exclusive`,
        );
      }
      return ok({ type: 'sysex', bytes: bytes.slice() });
    }
    if (byte > 0x7f) {
      return fail(
        'unterminated-sysex',
        `SysEx interrupted by status byte 0x${hex(byte)} at offset ${i}`,
      );
    }
  }
  return fail('unterminated-sysex', 'SysEx message has no End of Exclusive (0xF7)');
}

function parseSystem(bytes: Uint8Array, status: number): Result<MidiMessage, MidiParseError> {
  if (status === 0xf0) return parseSysex(bytes);
  if (status === 0xf7) {
    return fail('unexpected-data-byte', 'End of Exclusive (0xF7) without a SysEx start');
  }
  const realTime = REAL_TIME[status];
  if (realTime) {
    const problem = checkExactLength(bytes, 1, `status 0x${hex(status)}`);
    return problem ?? ok(realTime);
  }
  const dataLength = systemCommonDataLength(status);
  if (dataLength === undefined) {
    return fail('undefined-status', `Status 0x${hex(status)} is undefined in the MIDI 1.0 spec`);
  }
  const problem = checkExactLength(bytes, 1 + dataLength, `status 0x${hex(status)}`);
  if (problem) return problem;
  const d1 = bytes[1] ?? 0;
  const d2 = bytes[2] ?? 0;
  switch (status) {
    case 0xf1:
      return ok({ type: 'mtcQuarterFrame', value: d1 });
    case 0xf2:
      return ok({ type: 'songPosition', sixteenths: (d2 << 7) | d1 });
    case 0xf3:
      return ok({ type: 'songSelect', song: d1 });
    default:
      return ok({ type: 'tuneRequest' });
  }
}

/**
 * Parses exactly one complete MIDI message. Channels are reported as 1..16, note-on with
 * velocity 0 becomes `noteOff`, pitch bend is centred at 0 (-8192..8191). Running status
 * is not accepted here (Web MIDI never delivers it); use `MidiStreamParser` for raw streams.
 */
export function parseMidiMessage(bytes: Uint8Array): Result<MidiMessage, MidiParseError> {
  const status = bytes[0];
  if (status === undefined) return fail('empty', 'Empty MIDI message');
  if (status < 0x80) {
    return fail(
      'unexpected-data-byte',
      `Message starts with data byte 0x${hex(status)} instead of a status byte`,
    );
  }
  return status < 0xf0 ? parseChannelVoice(bytes, status) : parseSystem(bytes, status);
}

function assertInt(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`MIDI ${field} must be an integer in ${min}..${max}, got ${value}`);
  }
  return value;
}

const data7 = (value: number, field: string): number => assertInt(value, 0, 127, field);
const channelNibble = (channel: number): number => assertInt(channel, 1, 16, 'channel') - 1;

/**
 * Encodes a message to bytes. Throws `RangeError` for values outside the MIDI ranges
 * (they can only come from application bugs) and for SysEx bytes that are not framed by
 * F0..F7 with 7-bit payload.
 */
export function encodeMidiMessage(message: MidiMessage): Uint8Array {
  switch (message.type) {
    case 'noteOff':
      return Uint8Array.of(
        0x80 | channelNibble(message.channel),
        data7(message.note, 'note'),
        data7(message.velocity, 'velocity'),
      );
    case 'noteOn':
      return Uint8Array.of(
        0x90 | channelNibble(message.channel),
        data7(message.note, 'note'),
        data7(message.velocity, 'velocity'),
      );
    case 'polyPressure':
      return Uint8Array.of(
        0xa0 | channelNibble(message.channel),
        data7(message.note, 'note'),
        data7(message.pressure, 'pressure'),
      );
    case 'controlChange':
      return Uint8Array.of(
        0xb0 | channelNibble(message.channel),
        data7(message.controller, 'controller'),
        data7(message.value, 'value'),
      );
    case 'programChange':
      return Uint8Array.of(
        0xc0 | channelNibble(message.channel),
        data7(message.program, 'program'),
      );
    case 'channelPressure':
      return Uint8Array.of(
        0xd0 | channelNibble(message.channel),
        data7(message.pressure, 'pressure'),
      );
    case 'pitchBend': {
      const raw = assertInt(message.value, -8192, 8191, 'pitch bend') + 8192;
      return Uint8Array.of(0xe0 | channelNibble(message.channel), raw & 0x7f, raw >> 7);
    }
    case 'sysex': {
      const result = parseSysex(message.bytes);
      if (message.bytes[0] !== 0xf0 || !result.ok) {
        throw new RangeError('SysEx bytes must start with F0, end with F7 and carry 7-bit data');
      }
      return message.bytes.slice();
    }
    case 'mtcQuarterFrame':
      return Uint8Array.of(0xf1, data7(message.value, 'MTC quarter frame'));
    case 'songPosition': {
      const position = assertInt(message.sixteenths, 0, 0x3fff, 'song position');
      return Uint8Array.of(0xf2, position & 0x7f, position >> 7);
    }
    case 'songSelect':
      return Uint8Array.of(0xf3, data7(message.song, 'song'));
    case 'tuneRequest':
      return Uint8Array.of(0xf6);
    case 'clock':
      return Uint8Array.of(0xf8);
    case 'start':
      return Uint8Array.of(0xfa);
    case 'continue':
      return Uint8Array.of(0xfb);
    case 'stop':
      return Uint8Array.of(0xfc);
    case 'activeSensing':
      return Uint8Array.of(0xfe);
    case 'systemReset':
      return Uint8Array.of(0xff);
  }
}

/** Channel-voice messages carry a channel; system messages do not. */
export function isChannelMessage(message: MidiMessage): message is MidiChannelVoiceMessage {
  return 'channel' in message;
}
