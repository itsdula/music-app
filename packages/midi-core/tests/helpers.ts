import type { MidiMessage, MidiInputEvent } from '../src';

export function ev(
  message: MidiMessage,
  extra: Partial<Omit<MidiInputEvent, 'message'>> = {},
): MidiInputEvent {
  return { portId: 'in-1', portName: 'Test Keys', timestampMs: 0, message, ...extra };
}

export const cc = (controller: number, value: number, channel = 1): MidiMessage => ({
  type: 'controlChange',
  channel,
  controller,
  value,
});

export const noteOn = (note: number, velocity = 100, channel = 1): MidiMessage => ({
  type: 'noteOn',
  channel,
  note,
  velocity,
});

export const noteOff = (note: number, channel = 1): MidiMessage => ({
  type: 'noteOff',
  channel,
  note,
  velocity: 0,
});
