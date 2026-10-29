/**
 * End-to-end pipeline in Node: fake host port → MidiService (profile detection) →
 * MappingEngine (default mappings, pickup) — the wiring the app performs.
 */
import { describe, expect, it } from 'vitest';
import { asMappingId, type ParameterAddress } from '@studio/domain';
import {
  MappingEngine,
  MidiService,
  type MidiAccessPort,
  type MidiInputEvent,
  type MidiPortDescriptor,
  type RawMidiInput,
} from '@studio/midi-core';
import { mpkMiniMk3Profile } from '../src';

function fakePort(ports: MidiPortDescriptor[]) {
  const listeners = new Set<(input: RawMidiInput) => void>();
  const port: MidiAccessPort = {
    supported: true,
    requestAccess: () => Promise.resolve('granted'),
    getStatus: () => 'granted',
    listPorts: () => ports,
    onPortsChanged: () => () => undefined,
    onMessage: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    send: () => undefined,
    close: () => undefined,
  };
  const receive = (bytes: number[], portId = 'mpk') => {
    for (const l of listeners) l({ portId, bytes: Uint8Array.from(bytes), timestampMs: 1 });
  };
  return { port, receive };
}

describe('MPK Mini MK3 through MidiService and MappingEngine', () => {
  it('detects the device, identifies K1 and drives the selected track gain with pickup', () => {
    const { port, receive } = fakePort([
      { id: 'mpk', name: 'MPK mini 3 MIDI 1', type: 'input', state: 'connected' },
      { id: 'other', name: 'MPK mini Play mk3', type: 'input', state: 'connected' },
    ]);
    const service = new MidiService({ port, profiles: [mpkMiniMk3Profile], now: () => 0 });
    expect(service.listDevices().map((d) => d.profile?.id)).toEqual([
      'akai.mpk-mini-mk3',
      undefined,
    ]);

    const engine = new MappingEngine();
    engine.setMappings(
      mpkMiniMk3Profile
        .defaultMappings()
        .map((m, i) => ({ ...m, id: asMappingId(`default-${i}`) })),
    );
    const gain: ParameterAddress = { scope: 'selectedTrack', param: 'gainDb' };
    let gainValue = 0.75;
    const reader = {
      getNormalized: (a: ParameterAddress) =>
        a.scope === gain.scope && a.param === gain.param ? gainValue : undefined,
    };

    const events: MidiInputEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
      for (const effect of engine.process(event, reader)) {
        if (effect.kind === 'setParameter' && effect.address.scope === 'selectedTrack')
          gainValue = effect.normalized;
      }
    });

    receive([0xb0, 70, 10]); // K1 far below the current value: ignored (pickup)
    expect(gainValue).toBe(0.75);
    receive([0xb0, 70, 100]); // crosses 0.75: picked up
    expect(gainValue).toBeCloseTo(100 / 127);
    expect(events[0]).toMatchObject({
      profileId: 'akai.mpk-mini-mk3',
      control: { controlId: 'knob.K1' },
    });

    receive([0xb0, 70, 0], 'other'); // same CC from a different device: not mapped
    expect(gainValue).toBeCloseTo(100 / 127);
    expect(events[2]?.profileId).toBeUndefined();

    receive([0x99, 36, 120]); // pad A1: identified, no mapping effect
    expect(events[3]?.control?.controlId).toBe('pad.A1');
    expect(service.panic().releasedNotes).toBe(1);
  });
});
