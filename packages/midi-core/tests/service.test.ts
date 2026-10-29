import { describe, expect, it } from 'vitest';
import {
  MidiService,
  type MidiDevice,
  type MidiDeviceProfile,
  type MidiInputEvent,
  type MidiServiceError,
} from '../src';
import { FakeMidiAccessPort, input, output } from './fake-port';

const testProfile: MidiDeviceProfile = {
  id: 'test.keys',
  displayName: 'Test Keys',
  manufacturer: 'Test',
  matchPort: (port) => (port.name.startsWith('Keys') ? 10 : 0),
  controls: [{ id: 'knob.1', kind: 'knob', label: 'K1', verification: 'unverified' }],
  identify: (message) =>
    message.type === 'controlChange' && message.controller === 70
      ? { controlId: 'knob.1', value: message.value / 127, message }
      : null,
  defaultMappings: () => [],
  capabilities: [],
};

const weakProfile: MidiDeviceProfile = {
  ...testProfile,
  id: 'test.weak',
  matchPort: (port) => (port.name.includes('Keys') ? 1 : 0),
};

const throwingProfile: MidiDeviceProfile = {
  ...testProfile,
  id: 'test.throws',
  matchPort: () => {
    throw new Error('boom');
  },
  identify: () => {
    throw new Error('identify failed');
  },
};

function setup(ports = [input('in-1', 'Keys A'), output('out-1', 'Synth')]) {
  const port = new FakeMidiAccessPort();
  port.ports = ports;
  let time = 5000;
  const service = new MidiService({ port, profiles: [weakProfile, testProfile], now: () => time });
  const events: MidiInputEvent[] = [];
  const errors: MidiServiceError[] = [];
  const deviceLists: MidiDevice[][] = [];
  service.subscribe((e) => events.push(e));
  service.subscribeErrors((e) => errors.push(e));
  service.subscribeDevices((d) => deviceLists.push(d));
  return { port, service, events, errors, deviceLists, setTime: (t: number) => (time = t) };
}

describe('MidiService — access', () => {
  it('requests access without SysEx and refreshes the device list', async () => {
    const { port, service, deviceLists } = setup([]);
    port.ports = [input('in-1', 'Keys A')];
    expect(service.getStatus()).toBe('idle');
    await expect(service.requestAccess({ sysex: false })).resolves.toBe('granted');
    expect(port.requests).toEqual([{ sysex: false }]);
    expect(service.getStatus()).toBe('granted');
    expect(deviceLists).toHaveLength(1);
    await expect(service.requestAccess()).resolves.toBe('granted');
    expect(deviceLists).toHaveLength(1); // unchanged list: no notification
  });

  it('reports unsupported hosts and denied/failed access', async () => {
    const unsupported = setup();
    unsupported.port.supported = false;
    expect(unsupported.service.supported).toBe(false);
    expect(unsupported.service.getStatus()).toBe('unsupported');
    await expect(unsupported.service.requestAccess()).resolves.toBe('unsupported');

    const denied = setup();
    denied.port.grant = 'denied';
    await expect(denied.service.requestAccess()).resolves.toBe('denied');

    const failing = setup();
    failing.port.grant = new Error('host exploded');
    await expect(failing.service.requestAccess()).resolves.toBe('error');
    expect(failing.errors).toEqual([{ kind: 'access-failed', message: 'host exploded' }]);
  });

  it('survives a port whose listing throws', () => {
    const port = new FakeMidiAccessPort();
    port.listThrows = true;
    const errors: MidiServiceError[] = [];
    const service = new MidiService({ port, profiles: [], now: () => 0 });
    service.subscribeErrors((e) => errors.push(e));
    expect(service.listDevices()).toEqual([]);
    port.listThrows = true;
    return service.requestAccess().then(() => {
      expect(errors.map((e) => e.kind)).toEqual(['access-failed']);
    });
  });
});

describe('MidiService — devices', () => {
  it('lists inputs then outputs with the best-matching profile', () => {
    const { service } = setup();
    const devices = service.listDevices();
    expect(devices.map((d) => [d.port.type, d.displayName, d.profile?.id])).toEqual([
      ['input', 'Keys A', 'test.keys'],
      ['output', 'Synth', undefined],
    ]);
    expect(service.getDevice('out-1')?.displayName).toBe('Synth');
  });

  it('ignores profiles that throw while matching', () => {
    const port = new FakeMidiAccessPort();
    port.ports = [input('in-1', 'Keys A')];
    const service = new MidiService({ port, profiles: [throwingProfile], now: () => 0 });
    expect(service.listDevices()[0]?.profile).toBeUndefined();
  });

  it('disambiguates duplicate names deterministically and stably across hotplug', () => {
    const { port, service, deviceLists } = setup([
      input('id-b', 'Keys A'),
      input('id-a', 'Keys A'),
      output('id-c', 'Keys A'),
      input('id-x', ''),
    ]);
    const names = () =>
      service.listDevices().map((d) => `${d.port.type}:${d.port.id}=${d.displayName}`);
    expect(names()).toEqual([
      'input:id-x=id-x',
      'input:id-a=Keys A',
      'input:id-b=Keys A (2)',
      'output:id-c=Keys A',
    ]);
    // Unplug the first; the second keeps its "(2)" while known.
    port.setPorts([input('id-b', 'Keys A'), output('id-c', 'Keys A')]);
    expect(names()).toEqual(['input:id-b=Keys A (2)', 'output:id-c=Keys A']);
    // A newly plugged duplicate takes the lowest free ordinal.
    port.setPorts([input('id-b', 'Keys A'), input('id-z', 'Keys A'), output('id-c', 'Keys A')]);
    expect(names()).toEqual(['input:id-z=Keys A', 'input:id-b=Keys A (2)', 'output:id-c=Keys A']);
    expect(deviceLists).toHaveLength(2);
  });

  it('notifies device listeners on hotplug and isolates listener failures', () => {
    const { port, service, deviceLists, errors } = setup();
    service.subscribeDevices(() => {
      throw new Error('ui crashed');
    });
    port.setPorts([input('in-1', 'Keys A'), input('in-2', 'Pads')]);
    expect(deviceLists.at(-1)?.map((d) => d.port.id)).toEqual(['in-1', 'in-2']);
    expect(errors).toEqual([{ kind: 'listener-failed', message: 'ui crashed' }]);
    port.setPorts([input('in-1', 'Keys A'), input('in-2', 'Pads')]);
    expect(deviceLists).toHaveLength(1);
  });

  it('unsubscribe functions detach listeners', () => {
    const { port, service, deviceLists } = setup();
    const extra: unknown[] = [];
    const un1 = service.subscribe((e) => extra.push(e));
    const un2 = service.subscribeDevices((d) => extra.push(d));
    const un3 = service.subscribeErrors((e) => extra.push(e));
    un1();
    un2();
    un3();
    port.receive('in-1', [0x90, 60, 1]);
    port.receive('in-1', [0x90]);
    port.setPorts([]);
    expect(extra).toEqual([]);
    expect(deviceLists).toHaveLength(1);
  });
});

describe('MidiService — input', () => {
  it('delivers validated, annotated events with the identified control', () => {
    const { port, events } = setup();
    port.receive('in-1', [0xb0, 70, 127], 123.5);
    port.receive('in-1', [0x90, 60, 100], 124);
    expect(events).toEqual([
      {
        portId: 'in-1',
        portName: 'Keys A',
        profileId: 'test.keys',
        message: { type: 'controlChange', channel: 1, controller: 70, value: 127 },
        timestampMs: 123.5,
        control: {
          controlId: 'knob.1',
          value: 1,
          message: { type: 'controlChange', channel: 1, controller: 70, value: 127 },
        },
      },
      {
        portId: 'in-1',
        portName: 'Keys A',
        profileId: 'test.keys',
        message: { type: 'noteOn', channel: 1, note: 60, velocity: 100 },
        timestampMs: 124,
      },
    ]);
  });

  it('drops invalid bytes and reports them (sanitized) without throwing', () => {
    const { port, events, errors } = setup();
    expect(() => port.receive('in-1', [0x90, 60, 200], 7)).not.toThrow();
    port.receive(
      'unknown',
      Array.from({ length: 40 }, () => 0x01),
      8,
    );
    expect(events).toEqual([]);
    expect(errors.map((e) => (e.kind === 'invalid-input' ? e.error.code : e.kind))).toEqual([
      'data-out-of-range',
      'unexpected-data-byte',
    ]);
    expect(errors.map((e) => ({ ...e, error: undefined }))).toEqual([
      {
        kind: 'invalid-input',
        portId: 'in-1',
        portName: 'Keys A',
        error: undefined,
        bytes: '90 3C C8',
        timestampMs: 7,
      },
      {
        kind: 'invalid-input',
        portId: 'unknown',
        portName: '',
        error: undefined,
        bytes: '01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 01 … (+24 bytes)',
        timestampMs: 8,
      },
    ]);
  });

  it('isolates subscriber and profile exceptions', () => {
    const port = new FakeMidiAccessPort();
    port.ports = [input('in-1', 'Keys A')];
    const service = new MidiService({
      port,
      profiles: [{ ...throwingProfile, matchPort: () => 1 }],
      now: () => 0,
    });
    const errors: MidiServiceError[] = [];
    const events: MidiInputEvent[] = [];
    service.subscribeErrors((e) => errors.push(e));
    service.subscribeErrors(() => {
      throw new Error('error listener broken');
    });
    service.subscribe(() => {
      throw new Error('subscriber broke');
    });
    service.subscribe((e) => events.push(e));
    expect(() => port.receive('in-1', [0xb0, 70, 1])).not.toThrow();
    expect(events).toHaveLength(1);
    expect(events[0]?.control).toBeUndefined();
    expect(errors.map((e) => (e.kind === 'listener-failed' ? e.message : e.kind))).toEqual([
      'identify failed',
      'subscriber broke',
    ]);
  });
});

describe('MidiService — stuck-note protection', () => {
  it('releases notes and sustain when an input disconnects', () => {
    const { port, service, events, setTime } = setup();
    port.receive('in-1', [0x90, 60, 100]);
    port.receive('in-1', [0x91, 64, 100]);
    port.receive('in-1', [0xb0, 64, 127]);
    expect(service.activeNoteCount()).toBe(2);
    setTime(9000);
    events.length = 0;
    port.setPorts([input('in-1', 'Keys A', 'disconnected'), output('out-1', 'Synth')]);
    expect(events.map((e) => [e.message, e.timestampMs, e.profileId])).toEqual([
      [{ type: 'noteOff', channel: 1, note: 60, velocity: 0 }, 9000, 'test.keys'],
      [{ type: 'noteOff', channel: 2, note: 64, velocity: 0 }, 9000, 'test.keys'],
      [{ type: 'controlChange', channel: 1, controller: 64, value: 0 }, 9000, 'test.keys'],
    ]);
    expect(service.activeNoteCount('in-1')).toBe(0);
  });

  it('releases notes when an input vanishes from the list', () => {
    const { port, events } = setup();
    port.receive('in-1', [0x90, 60, 100]);
    events.length = 0;
    port.setPorts([]);
    expect(events.map((e) => e.message.type)).toEqual(['noteOff']);
  });

  it('panic releases to subscribers and only touches outputs when asked', () => {
    const { port, service, events } = setup([
      input('in-1', 'Keys A'),
      output('out-1', 'Synth'),
      output('out-2', 'Other'),
      output('out-3', 'Gone', 'disconnected'),
    ]);
    port.receive('in-1', [0x90, 60, 100]);
    events.length = 0;
    expect(service.panic()).toEqual({ releasedNotes: 1, outputsNotified: 0 });
    expect(events.map((e) => e.message.type)).toEqual(['noteOff']);
    expect(port.sent).toEqual([]);

    expect(service.panic({ sendAllNotesOffToOutputs: true, outputPortIds: ['out-1'] })).toEqual({
      releasedNotes: 0,
      outputsNotified: 1,
    });
    expect(port.sent).toHaveLength(32);
    expect(port.sent.slice(0, 2)).toEqual([
      { portId: 'out-1', bytes: [0xb0, 64, 0] },
      { portId: 'out-1', bytes: [0xb0, 123, 0] },
    ]);
    expect(port.sent.at(-1)).toEqual({ portId: 'out-1', bytes: [0xbf, 123, 0] });
    port.sent = [];
    expect(service.panic({ sendAllNotesOffToOutputs: true }).outputsNotified).toBe(2);
    port.sendError = new Error('cable pulled');
    expect(service.panic({ sendAllNotesOffToOutputs: true }).outputsNotified).toBe(0);
  });

  it('dispose releases notes, detaches from the port and leaves the port open', () => {
    const { port, service, events } = setup();
    port.receive('in-1', [0x90, 60, 100]);
    events.length = 0;
    service.dispose();
    expect(events.map((e) => e.message.type)).toEqual(['noteOff']);
    expect(port.listenerCount).toBe(0);
    expect(port.closed).toBe(false);
    service.dispose();
    port.receive('in-1', [0x90, 60, 100]);
    expect(events).toHaveLength(1);
  });
});

describe('MidiService — send', () => {
  it('sends encoded messages with an optional timestamp', () => {
    const { port, service } = setup();
    expect(
      service.send('out-1', { type: 'noteOn', channel: 2, note: 60, velocity: 1 }, 42),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    expect(service.send('out-1', { type: 'clock' }).ok).toBe(true);
    expect(port.sent).toEqual([
      { portId: 'out-1', bytes: [0x91, 60, 1], timestampMs: 42 },
      { portId: 'out-1', bytes: [0xf8] },
    ]);
  });

  it('never sends SysEx and validates the target port and message', () => {
    const { port, service, errors } = setup([
      input('in-1', 'Keys A'),
      output('out-1', 'Synth'),
      output('out-off', 'Off', 'disconnected'),
    ]);
    const code = (r: ReturnType<MidiService['send']>) => (r.ok ? 'ok' : r.error.code);
    expect(code(service.send('out-1', { type: 'sysex', bytes: Uint8Array.of(0xf0, 0xf7) }))).toBe(
      'sysex-not-allowed',
    );
    expect(code(service.send('nope', { type: 'clock' }))).toBe('unknown-port');
    expect(code(service.send('in-1', { type: 'clock' }))).toBe('not-an-output');
    expect(code(service.send('out-off', { type: 'clock' }))).toBe('disconnected');
    expect(code(service.send('out-1', { type: 'programChange', channel: 0, program: 1 }))).toBe(
      'invalid-message',
    );
    port.sendError = new Error('InvalidStateError');
    expect(code(service.send('out-1', { type: 'clock' }))).toBe('send-failed');
    expect(errors).toEqual([
      { kind: 'send-failed', portId: 'out-1', message: 'InvalidStateError' },
    ]);
    port.sendError = Object.assign(Object.create(null) as object, {}) as Error;
    expect(code(service.send('out-1', { type: 'clock' }))).toBe('send-failed');
    expect(errors.at(-1)).toEqual({
      kind: 'send-failed',
      portId: 'out-1',
      message: 'Unknown error',
    });
    expect(port.sent).toEqual([]);
  });
});
