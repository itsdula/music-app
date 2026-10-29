import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  channelVoiceDataLength,
  encodeMidiMessage,
  isChannelMessage,
  isRealTimeStatus,
  parseMidiMessage,
  systemCommonDataLength,
  type MidiMessage,
} from '../src';

const channel = fc.integer({ min: 1, max: 16 });
const data = fc.integer({ min: 0, max: 127 });

const messageArb: fc.Arbitrary<MidiMessage> = fc.oneof(
  fc.record({
    type: fc.constant('noteOn' as const),
    channel,
    note: data,
    velocity: fc.integer({ min: 1, max: 127 }),
  }),
  fc.record({ type: fc.constant('noteOff' as const), channel, note: data, velocity: data }),
  fc.record({ type: fc.constant('polyPressure' as const), channel, note: data, pressure: data }),
  fc.record({
    type: fc.constant('controlChange' as const),
    channel,
    controller: data,
    value: data,
  }),
  fc.record({ type: fc.constant('programChange' as const), channel, program: data }),
  fc.record({ type: fc.constant('channelPressure' as const), channel, pressure: data }),
  fc.record({
    type: fc.constant('pitchBend' as const),
    channel,
    value: fc.integer({ min: -8192, max: 8191 }),
  }),
  fc.array(data, { maxLength: 40 }).map((payload): MidiMessage => ({
    type: 'sysex',
    bytes: Uint8Array.from([0xf0, ...payload, 0xf7]),
  })),
  fc.record({ type: fc.constant('mtcQuarterFrame' as const), value: data }),
  fc.record({
    type: fc.constant('songPosition' as const),
    sixteenths: fc.integer({ min: 0, max: 0x3fff }),
  }),
  fc.record({ type: fc.constant('songSelect' as const), song: data }),
  fc.constantFrom<MidiMessage>(
    { type: 'tuneRequest' },
    { type: 'clock' },
    { type: 'start' },
    { type: 'continue' },
    { type: 'stop' },
    { type: 'activeSensing' },
    { type: 'systemReset' },
  ),
);

describe('parseMidiMessage / encodeMidiMessage', () => {
  it('round-trips every valid message (encode → parse identity)', () => {
    fc.assert(
      fc.property(messageArb, (message) => {
        const parsed = parseMidiMessage(encodeMidiMessage(message));
        expect(parsed).toEqual({ ok: true, value: message });
      }),
      { numRuns: 2000 },
    );
  });

  it('never throws on arbitrary bytes and only returns valid messages', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 12 }), (bytes) => {
        const result = parseMidiMessage(bytes);
        if (result.ok) {
          // Whatever parses must re-encode to bytes that parse to the same message.
          expect(parseMidiMessage(encodeMidiMessage(result.value))).toEqual(result);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it.each<[string, MidiMessage]>([
    ['channel 0', { type: 'noteOn', channel: 0, note: 60, velocity: 1 }],
    ['channel 17', { type: 'controlChange', channel: 17, controller: 1, value: 1 }],
    ['note 128', { type: 'noteOff', channel: 1, note: 128, velocity: 0 }],
    ['fractional value', { type: 'controlChange', channel: 1, controller: 1, value: 1.5 }],
    ['pitch bend 8192', { type: 'pitchBend', channel: 1, value: 8192 }],
    ['song position overflow', { type: 'songPosition', sixteenths: 0x4000 }],
    ['unframed sysex', { type: 'sysex', bytes: Uint8Array.of(0x47, 0x01) }],
    ['sysex with 8-bit payload', { type: 'sysex', bytes: Uint8Array.of(0xf0, 0x80, 0xf7) }],
    ['program -1', { type: 'programChange', channel: 1, program: -1 }],
  ])('encode throws RangeError for %s', (_name, message) => {
    expect(() => encodeMidiMessage(message)).toThrow(RangeError);
  });

  it('exposes length helpers', () => {
    expect(channelVoiceDataLength(0x90)).toBe(2);
    expect(channelVoiceDataLength(0xc5)).toBe(1);
    expect(channelVoiceDataLength(0xd0)).toBe(1);
    expect(systemCommonDataLength(0xf2)).toBe(2);
    expect(systemCommonDataLength(0xf6)).toBe(0);
    expect(systemCommonDataLength(0xf4)).toBeUndefined();
    expect(isRealTimeStatus(0xf8)).toBe(true);
    expect(isRealTimeStatus(0xf7)).toBe(false);
  });

  it('distinguishes channel messages', () => {
    expect(isChannelMessage({ type: 'clock' })).toBe(false);
    expect(isChannelMessage({ type: 'programChange', channel: 1, program: 0 })).toBe(true);
  });
});
