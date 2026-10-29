/**
 * Maps messages sent under the factory defaults to physical controls. Driven entirely by
 * the controls' `defaultSource`, so the table and identification cannot drift apart.
 */
import type { MidiChannelFilter } from '@studio/domain';
import type { DeviceControl, DeviceControlEvent, MidiMessage } from '@studio/midi-core';
import { MPK_MINI_MK3_CONTROLS } from './controls';

interface Index {
  readonly notes: Map<string, DeviceControl>;
  readonly ccs: Map<string, DeviceControl>;
  pitchBend: { control: DeviceControl; channel: MidiChannelFilter } | null;
}

const keyFor = (channel: MidiChannelFilter, number: number): string => `${channel}:${number}`;

function buildIndex(controls: readonly DeviceControl[]): Index {
  const index: Index = { notes: new Map(), ccs: new Map(), pitchBend: null };
  for (const control of controls) {
    const source = control.defaultSource;
    if (!source) continue;
    switch (source.kind) {
      case 'note':
        index.notes.set(keyFor(source.channel, source.note), control);
        break;
      case 'cc':
        index.ccs.set(keyFor(source.channel, source.controller), control);
        break;
      case 'pitchBend':
        index.pitchBend = { control, channel: source.channel };
        break;
      case 'programChange':
        break;
    }
  }
  return index;
}

const INDEX = buildIndex(MPK_MINI_MK3_CONTROLS);

const lookup = (map: Map<string, DeviceControl>, channel: number, number: number) =>
  map.get(keyFor(channel, number)) ?? map.get(keyFor('any', number));

/**
 * Identifies the physical control behind a default-program message. Continuous controls
 * report 0..1; keys, pads and the sustain pedal report 1 (pressed) / 0 (released).
 */
export function identifyMpkMiniMk3(message: MidiMessage): DeviceControlEvent | null {
  switch (message.type) {
    case 'noteOn':
    case 'noteOff': {
      const control = lookup(INDEX.notes, message.channel, message.note);
      if (!control) return null;
      return { controlId: control.id, value: message.type === 'noteOn' ? 1 : 0, message };
    }
    case 'controlChange': {
      const control = lookup(INDEX.ccs, message.channel, message.controller);
      if (!control) return null;
      const value = control.kind === 'pedal' ? (message.value >= 64 ? 1 : 0) : message.value / 127;
      return { controlId: control.id, value, message };
    }
    case 'pitchBend': {
      const pb = INDEX.pitchBend;
      if (!pb || (pb.channel !== 'any' && pb.channel !== message.channel)) return null;
      return { controlId: pb.control.id, value: (message.value + 8192) / 16383, message };
    }
    default:
      return null;
  }
}
