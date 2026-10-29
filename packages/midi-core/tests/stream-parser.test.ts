import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeMidiMessage, MidiStreamParser, type MidiMessage, type MidiStreamItem } from '../src';

const messages = (items: MidiStreamItem[]): MidiMessage[] =>
  items.flatMap((item) => (item.ok ? [item.value] : []));
const errors = (items: MidiStreamItem[]): string[] =>
  items.flatMap((item) => (item.ok ? [] : [item.error.code]));

describe('MidiStreamParser', () => {
  it('parses consecutive complete messages', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0x90, 60, 100, 0x80, 60, 0, 0xc0, 3]);
    expect(messages(out)).toEqual([
      { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
      { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
      { type: 'programChange', channel: 1, program: 3 },
    ]);
  });

  it('supports running status, including note-on velocity 0 as note-off', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0x90, 60, 100, 62, 90, 60, 0, 0xb1, 1, 10, 1, 11]);
    expect(messages(out)).toEqual([
      { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
      { type: 'noteOn', channel: 1, note: 62, velocity: 90 },
      { type: 'noteOff', channel: 1, note: 60, velocity: 0 },
      { type: 'controlChange', channel: 2, controller: 1, value: 10 },
      { type: 'controlChange', channel: 2, controller: 1, value: 11 },
    ]);
  });

  it('keeps running status for one-data-byte messages', () => {
    const parser = new MidiStreamParser();
    expect(messages(parser.push([0xd0, 5, 6, 7]))).toHaveLength(3);
  });

  it('assembles messages split across chunks', () => {
    const parser = new MidiStreamParser();
    expect(parser.push([0xe0])).toEqual([]);
    expect(parser.push([0x00])).toEqual([]);
    expect(messages(parser.push([0x40]))).toEqual([{ type: 'pitchBend', channel: 1, value: 0 }]);
  });

  it('emits real-time bytes interleaved inside messages without breaking them', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0x90, 0xf8, 60, 0xfe, 100, 0xf8, 61, 0xfa, 101]);
    expect(messages(out)).toEqual([
      { type: 'clock' },
      { type: 'activeSensing' },
      { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
      { type: 'clock' },
      { type: 'start' },
      { type: 'noteOn', channel: 1, note: 61, velocity: 101 },
    ]);
  });

  it('accumulates SysEx with interleaved real-time bytes', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0xf0, 0x7e, 0xf8, 0x7f, 0x06]);
    expect(messages(out)).toEqual([{ type: 'clock' }]);
    const end = parser.push([0x01, 0xf7]);
    expect(messages(end)).toEqual([
      { type: 'sysex', bytes: Uint8Array.of(0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7) },
    ]);
  });

  it('SysEx and system common cancel running status', () => {
    const parser = new MidiStreamParser();
    const afterSysex = parser.push([0x90, 60, 1, 0xf0, 0xf7, 61, 1]);
    expect(errors(afterSysex)).toEqual(['unexpected-data-byte', 'unexpected-data-byte']);
    const afterCommon = new MidiStreamParser().push([0x90, 60, 1, 0xf3, 2, 61, 1]);
    expect(messages(afterCommon)).toContainEqual({ type: 'songSelect', song: 2 });
    expect(errors(afterCommon)).toEqual(['unexpected-data-byte', 'unexpected-data-byte']);
  });

  it('reports stray data bytes and resynchronises on the next status', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0x40, 0x41, 0xb0, 7, 100]);
    expect(errors(out)).toEqual(['unexpected-data-byte', 'unexpected-data-byte']);
    expect(messages(out)).toEqual([
      { type: 'controlChange', channel: 1, controller: 7, value: 100 },
    ]);
  });

  it('reports a truncated message interrupted by a new status', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0x90, 60, 0xb0, 1, 2]);
    expect(errors(out)).toEqual(['truncated']);
    expect(messages(out)).toEqual([{ type: 'controlChange', channel: 1, controller: 1, value: 2 }]);
  });

  it('reports SysEx interrupted by a status byte', () => {
    const parser = new MidiStreamParser();
    const out = parser.push([0xf0, 0x01, 0x02, 0x90, 60, 100]);
    expect(errors(out)).toEqual(['unterminated-sysex']);
    expect(messages(out)).toEqual([{ type: 'noteOn', channel: 1, note: 60, velocity: 100 }]);
  });

  it('discards oversized SysEx until its EOX', () => {
    const parser = new MidiStreamParser({ maxSysexBytes: 6 });
    const out = parser.push([0xf0, 1, 2, 3, 4, 5, 6, 7, 0xf7, 0xf8]);
    expect(errors(out)).toEqual(['unterminated-sysex']);
    expect(messages(out)).toEqual([{ type: 'clock' }]);
    // A SysEx exactly at the limit is accepted.
    expect(messages(parser.push([0xf0, 1, 2, 3, 4, 0xf7]))).toHaveLength(1);
  });

  it('a status byte ends SysEx discarding', () => {
    const parser = new MidiStreamParser({ maxSysexBytes: 3 });
    const out = parser.push([0xf0, 1, 2, 3, 0x90, 60, 1]);
    expect(errors(out)).toEqual(['unterminated-sysex']);
    expect(messages(out)).toEqual([{ type: 'noteOn', channel: 1, note: 60, velocity: 1 }]);
  });

  it('reports stray EOX and undefined statuses', () => {
    const parser = new MidiStreamParser();
    expect(errors(parser.push([0xf7, 0xf4, 0xf9]))).toEqual([
      'unexpected-data-byte',
      'undefined-status',
      'undefined-status',
    ]);
  });

  it('reset drops partial state', () => {
    const parser = new MidiStreamParser();
    parser.push([0x90, 60]);
    parser.reset();
    expect(errors(parser.push([100]))).toEqual(['unexpected-data-byte']);
  });

  it('parses any concatenation of encoded messages, in any chunking', () => {
    const msg = fc.oneof(
      fc
        .tuple(
          fc.integer({ min: 1, max: 16 }),
          fc.integer({ min: 0, max: 127 }),
          fc.integer({ min: 1, max: 127 }),
        )
        .map(([channel, note, velocity]): MidiMessage => ({
          type: 'noteOn',
          channel,
          note,
          velocity,
        })),
      fc
        .tuple(fc.integer({ min: 1, max: 16 }), fc.integer({ min: 0, max: 127 }))
        .map(([channel, program]): MidiMessage => ({ type: 'programChange', channel, program })),
      fc.constant<MidiMessage>({ type: 'clock' }),
      fc
        .array(fc.integer({ min: 0, max: 127 }), { maxLength: 6 })
        .map((p): MidiMessage => ({ type: 'sysex', bytes: Uint8Array.from([0xf0, ...p, 0xf7]) })),
    );
    fc.assert(
      fc.property(
        fc.array(msg, { maxLength: 12 }),
        fc.integer({ min: 1, max: 5 }),
        (list, size) => {
          const bytes = list.flatMap((m) => Array.from(encodeMidiMessage(m)));
          const parser = new MidiStreamParser();
          const out: MidiStreamItem[] = [];
          for (let i = 0; i < bytes.length; i += size)
            out.push(...parser.push(bytes.slice(i, i + size)));
          expect(errors(out)).toEqual([]);
          expect(messages(out)).toEqual(list);
        },
      ),
    );
  });
});
