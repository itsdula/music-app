/**
 * Golden byte fixtures: the wire format every host adapter and native bridge must agree on.
 */
import { describe, expect, it } from 'vitest';
import {
  encodeMidiMessage,
  parseMidiMessage,
  type MidiMessage,
  type MidiParseErrorCode,
} from '../src';

const sysexBytes = Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7);

/** [description, bytes, expected message, canonical re-encoding (if different)] */
type ValidFixture = readonly [string, number[], MidiMessage, number[]?];
const VALID_TUPLES: readonly ValidFixture[] = [
  ['note off', [0x80, 60, 64], { type: 'noteOff', channel: 1, note: 60, velocity: 64 }],
  ['note on ch 16', [0x9f, 127, 1], { type: 'noteOn', channel: 16, note: 127, velocity: 1 }],
  [
    'note on velocity 0 → note off',
    [0x93, 48, 0],
    { type: 'noteOff', channel: 4, note: 48, velocity: 0 },
    [0x83, 48, 0],
  ],
  ['poly pressure', [0xa1, 36, 90], { type: 'polyPressure', channel: 2, note: 36, pressure: 90 }],
  [
    'control change',
    [0xb0, 74, 127],
    { type: 'controlChange', channel: 1, controller: 74, value: 127 },
  ],
  ['program change', [0xc9, 5], { type: 'programChange', channel: 10, program: 5 }],
  ['channel pressure', [0xd2, 100], { type: 'channelPressure', channel: 3, pressure: 100 }],
  ['pitch bend centre', [0xe0, 0x00, 0x40], { type: 'pitchBend', channel: 1, value: 0 }],
  ['pitch bend min', [0xe0, 0x00, 0x00], { type: 'pitchBend', channel: 1, value: -8192 }],
  ['pitch bend max', [0xef, 0x7f, 0x7f], { type: 'pitchBend', channel: 16, value: 8191 }],
  ['sysex', [...sysexBytes], { type: 'sysex', bytes: sysexBytes }],
  ['empty sysex', [0xf0, 0xf7], { type: 'sysex', bytes: Uint8Array.of(0xf0, 0xf7) }],
  ['MTC quarter frame', [0xf1, 0x25], { type: 'mtcQuarterFrame', value: 0x25 }],
  ['song position', [0xf2, 0x10, 0x02], { type: 'songPosition', sixteenths: 0x110 }],
  ['song select', [0xf3, 7], { type: 'songSelect', song: 7 }],
  ['tune request', [0xf6], { type: 'tuneRequest' }],
  ['clock', [0xf8], { type: 'clock' }],
  ['start', [0xfa], { type: 'start' }],
  ['continue', [0xfb], { type: 'continue' }],
  ['stop', [0xfc], { type: 'stop' }],
  ['active sensing', [0xfe], { type: 'activeSensing' }],
  ['system reset', [0xff], { type: 'systemReset' }],
];

const VALID = VALID_TUPLES.map(([name, bytes, message, canonical]) => ({
  name,
  bytes,
  message,
  canonical: canonical ?? bytes,
}));

const INVALID: ReadonlyArray<readonly [string, number[], MidiParseErrorCode]> = [
  ['empty', [], 'empty'],
  ['stray data byte', [0x3c, 0x40], 'unexpected-data-byte'],
  ['truncated note on', [0x90, 60], 'truncated'],
  ['status only', [0xb0], 'truncated'],
  ['truncated program change', [0xc0], 'truncated'],
  ['truncated pitch bend', [0xe0, 0x00], 'truncated'],
  ['truncated song position', [0xf2, 0x01], 'truncated'],
  ['data > 127 (velocity)', [0x90, 60, 0x80], 'data-out-of-range'],
  ['data > 127 (note)', [0x90, 0xc8, 10], 'data-out-of-range'],
  ['data > 127 (program)', [0xc0, 0xff], 'data-out-of-range'],
  ['trailing bytes after CC', [0xb0, 1, 2, 3], 'unexpected-data-byte'],
  ['trailing bytes after clock', [0xf8, 0x00], 'unexpected-data-byte'],
  ['unterminated sysex', [0xf0, 0x47, 0x01], 'unterminated-sysex'],
  ['sysex interrupted by status', [0xf0, 0x47, 0x90, 0xf7], 'unterminated-sysex'],
  ['bytes after EOX', [0xf0, 0x01, 0xf7, 0x00], 'unexpected-data-byte'],
  ['stray EOX', [0xf7], 'unexpected-data-byte'],
  ['undefined F4', [0xf4], 'undefined-status'],
  ['undefined F5', [0xf5], 'undefined-status'],
  ['undefined F9', [0xf9], 'undefined-status'],
  ['undefined FD', [0xfd], 'undefined-status'],
];

describe('MIDI wire format (golden fixtures)', () => {
  it.each(VALID)('parses $name', ({ bytes, message }) => {
    const result = parseMidiMessage(Uint8Array.from(bytes));
    expect(result).toEqual({ ok: true, value: message });
  });

  it.each(VALID)('encodes $name', ({ message, canonical }) => {
    expect(Array.from(encodeMidiMessage(message))).toEqual(canonical);
  });

  it.each(INVALID)('rejects %s', (_name, bytes, code) => {
    const result = parseMidiMessage(Uint8Array.from(bytes));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('copies SysEx bytes instead of aliasing the host buffer', () => {
    const input = Uint8Array.from(sysexBytes);
    const result = parseMidiMessage(input);
    input[1] = 0x00;
    expect(result.ok && result.value.type === 'sysex' && result.value.bytes[1]).toBe(0x7e);
  });
});
