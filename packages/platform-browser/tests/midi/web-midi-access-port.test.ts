import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidiService, type MidiPortDescriptor, type RawMidiInput } from '@studio/midi-core';
import {
  createWebMidiAccessPort,
  mapWebMidiAccessError,
  type WebMidiNavigatorLike,
} from '../../src/midi';

type Handler = ((event: { data: Uint8Array | null; timeStamp: number }) => void) | null;

class FakePort {
  onmidimessage: Handler = null;
  readonly sent: Array<{ data: number[]; timestamp?: number }> = [];
  constructor(
    readonly id: string,
    public name: string | null,
    readonly type: 'input' | 'output',
    public state: 'connected' | 'disconnected' = 'connected',
    readonly manufacturer: string | null = null,
  ) {}
  send(data: number[], timestamp?: number): void {
    this.sent.push({ data, ...(timestamp !== undefined ? { timestamp } : {}) });
  }
  emit(bytes: number[] | null, timeStamp = 10): void {
    this.onmidimessage?.({ data: bytes ? Uint8Array.from(bytes) : null, timeStamp });
  }
}

class FakeAccess {
  readonly inputs = new Map<string, FakePort>();
  readonly outputs = new Map<string, FakePort>();
  readonly sysexEnabled = false;
  private readonly listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.delete(listener);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  add(port: FakePort, fire = true): void {
    (port.type === 'input' ? this.inputs : this.outputs).set(port.id, port);
    if (fire) this.fire();
  }
  fire(): void {
    for (const l of [...this.listeners]) l();
  }
}

function fakeNavigator(access: FakeAccess | Error) {
  const calls: Array<MIDIOptions | undefined> = [];
  const nav: WebMidiNavigatorLike = {
    requestMIDIAccess: (options) => {
      calls.push(options);
      return access instanceof Error
        ? Promise.reject(access)
        : Promise.resolve(access as unknown as MIDIAccess);
    },
  };
  return { nav, calls };
}

const domError = (name: string) => Object.assign(new Error(name), { name });

function setup() {
  const access = new FakeAccess();
  access.add(new FakePort('in-1', 'MPK mini 3', 'input', 'connected', 'AKAI'), false);
  access.add(new FakePort('out-1', 'MPK mini 3', 'output'), false);
  const { nav, calls } = fakeNavigator(access);
  const port = createWebMidiAccessPort({ navigator: nav, pollIntervalMs: 1000 });
  return { access, port, calls };
}

describe('createWebMidiAccessPort — feature detection and permissions', () => {
  it('reports unsupported without requestMIDIAccess', async () => {
    const port = createWebMidiAccessPort({ navigator: {} });
    expect(port.supported).toBe(false);
    expect(port.getStatus()).toBe('unsupported');
    await expect(port.requestAccess({ sysex: false })).resolves.toBe('unsupported');
    expect(port.listPorts()).toEqual([]);
    port.close();
    expect(port.getStatus()).toBe('unsupported');
  });

  it('falls back to the global navigator (Node has none with Web MIDI)', () => {
    expect(createWebMidiAccessPort().supported).toBe(false);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotSupportedError', 'unsupported'],
    ['InvalidStateError', 'error'],
    ['AbortError', 'error'],
  ] as const)('maps %s to %s', async (name, status) => {
    const { nav } = fakeNavigator(domError(name));
    const port = createWebMidiAccessPort({ navigator: nav });
    await expect(port.requestAccess({ sysex: false })).resolves.toBe(status);
    expect(port.getStatus()).toBe(status);
  });

  it('maps non-error rejections to error', () => {
    expect(mapWebMidiAccessError('nope')).toBe('error');
    expect(mapWebMidiAccessError(null)).toBe('error');
    expect(mapWebMidiAccessError({ name: 'NotAllowedError' })).toBe('denied');
  });

  it('requests with the given sysex flag, shares an in-flight request and caches the grant', async () => {
    const { port, calls } = setup();
    expect(port.supported).toBe(true);
    expect(port.getStatus()).toBe('idle');
    const a = port.requestAccess({ sysex: false });
    expect(port.getStatus()).toBe('requesting');
    const b = port.requestAccess({ sysex: false });
    expect(b).toBe(a);
    await expect(a).resolves.toBe('granted');
    await expect(port.requestAccess({ sysex: false })).resolves.toBe('granted');
    expect(calls).toEqual([{ sysex: false }]);
  });

  it('ignores a grant that arrives after close', async () => {
    const { port, access } = setup();
    const request = port.requestAccess({ sysex: false });
    port.close();
    await expect(request).resolves.toBe('idle');
    expect(access.listenerCount).toBe(0);
    expect(port.listPorts()).toEqual([]);
  });

  it('a rejection after close leaves the port idle', async () => {
    const { nav } = fakeNavigator(domError('NotAllowedError'));
    const port = createWebMidiAccessPort({ navigator: nav });
    const request = port.requestAccess({ sysex: false });
    port.close();
    await expect(request).resolves.toBe('idle');
  });
});

describe('createWebMidiAccessPort — ports and messages', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists inputs and outputs', async () => {
    const { port, access } = setup();
    expect(port.listPorts()).toEqual([]);
    await port.requestAccess({ sysex: false });
    access.add(new FakePort('in-2', null, 'input', 'disconnected'), false);
    expect(port.listPorts()).toEqual([
      { id: 'in-1', name: 'MPK mini 3', manufacturer: 'AKAI', type: 'input', state: 'connected' },
      { id: 'in-2', name: '', type: 'input', state: 'disconnected' },
      { id: 'out-1', name: 'MPK mini 3', type: 'output', state: 'connected' },
    ]);
  });

  it('forwards messages with copied bytes and the event timestamp', async () => {
    const { port, access } = setup();
    const received: RawMidiInput[] = [];
    port.onMessage((input) => received.push(input));
    await port.requestAccess({ sysex: false });
    const input = access.inputs.get('in-1')!;
    expect(input.onmidimessage).not.toBeNull();
    const data = Uint8Array.of(0x90, 60, 100);
    input.onmidimessage?.({ data, timeStamp: 1234.5 });
    data[0] = 0;
    input.emit(null);
    expect(received).toEqual([
      { portId: 'in-1', bytes: Uint8Array.of(0x90, 60, 100), timestampMs: 1234.5 },
    ]);
    expect(received[0]?.bytes).not.toBe(data);
  });

  it('isolates throwing message listeners', async () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (e: unknown) => reported.push(e));
    const { port, access } = setup();
    const received: RawMidiInput[] = [];
    port.onMessage(() => {
      throw new Error('listener bug');
    });
    port.onMessage((input) => received.push(input));
    await port.requestAccess({ sysex: false });
    access.inputs.get('in-1')!.emit([0xf8]);
    expect(received).toHaveLength(1);
    expect(reported).toEqual([new Error('listener bug')]);
  });

  it('falls back to a microtask rethrow when reportError is unavailable', async () => {
    vi.stubGlobal('reportError', undefined);
    const queued: Array<() => void> = [];
    vi.stubGlobal('queueMicrotask', (fn: () => void) => queued.push(fn));
    const { port, access } = setup();
    port.onPortsChanged(() => {
      throw new Error('ports listener bug');
    });
    await port.requestAccess({ sysex: false });
    expect(queued).toHaveLength(1);
    expect(() => queued[0]!()).toThrow('ports listener bug');
    expect(access.listenerCount).toBe(1);
  });

  it('notifies hotplug via statechange, attaching new inputs, deduplicating no-op events', async () => {
    const { port, access } = setup();
    const lists: MidiPortDescriptor[][] = [];
    const messages: RawMidiInput[] = [];
    port.onPortsChanged((ports) => lists.push(ports));
    port.onMessage((m) => messages.push(m));
    await port.requestAccess({ sysex: false });
    expect(lists).toHaveLength(1); // initial list after grant
    access.fire(); // e.g. a connection (open/close) change only
    expect(lists).toHaveLength(1);
    const pads = new FakePort('in-2', 'Pads', 'input');
    access.add(pads);
    expect(lists.at(-1)?.map((p) => p.id)).toEqual(['in-1', 'in-2', 'out-1']);
    pads.emit([0x99, 36, 100], 5);
    expect(messages).toEqual([
      { portId: 'in-2', bytes: Uint8Array.of(0x99, 36, 100), timestampMs: 5 },
    ]);
    pads.state = 'disconnected';
    access.fire();
    expect(lists.at(-1)?.find((p) => p.id === 'in-2')?.state).toBe('disconnected');
    expect(lists).toHaveLength(3);
  });

  it('re-attaches a handler when a reconnected input lost it', async () => {
    const { port, access } = setup();
    port.onMessage(() => undefined);
    await port.requestAccess({ sysex: false });
    const input = access.inputs.get('in-1')!;
    input.onmidimessage = null;
    input.state = 'disconnected';
    access.fire();
    expect(input.onmidimessage).toBeNull();
    input.state = 'connected';
    access.fire();
    expect(input.onmidimessage).not.toBeNull();
  });

  it('polls while listeners exist (Firefox fires no statechange) and stops afterwards', async () => {
    const { port, access } = setup();
    const lists: MidiPortDescriptor[][] = [];
    const unsubscribe = port.onPortsChanged((ports) => lists.push(ports));
    await port.requestAccess({ sysex: false });
    expect(lists).toHaveLength(1);
    access.add(new FakePort('in-3', 'Late', 'input'), false); // no event
    vi.advanceTimersByTime(999);
    expect(lists).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(lists).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(1);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    access.add(new FakePort('in-4', 'Later', 'input'), false);
    vi.advanceTimersByTime(5000);
    expect(lists).toHaveLength(2);
  });

  it('polling can be disabled', async () => {
    const access = new FakeAccess();
    const { nav } = fakeNavigator(access);
    const port = createWebMidiAccessPort({ navigator: nav, pollIntervalMs: 0 });
    port.onMessage(() => undefined);
    await port.requestAccess({ sysex: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sends bytes with and without a timestamp', async () => {
    const { port, access } = setup();
    expect(() => port.send('out-1', Uint8Array.of(0xf8))).toThrow(/not been granted/);
    await port.requestAccess({ sysex: false });
    port.send('out-1', Uint8Array.of(0x90, 60, 1), 99.5);
    port.send('out-1', Uint8Array.of(0xfc));
    expect(access.outputs.get('out-1')!.sent).toEqual([
      { data: [0x90, 60, 1], timestamp: 99.5 },
      { data: [0xfc] },
    ]);
    expect(() => port.send('missing', Uint8Array.of(0xf8))).toThrow(/Unknown MIDI output/);
  });

  it('close removes every listener and timer', async () => {
    const { port, access } = setup();
    const lists: MidiPortDescriptor[][] = [];
    const messages: RawMidiInput[] = [];
    port.onPortsChanged((ports) => lists.push(ports));
    port.onMessage((m) => messages.push(m));
    await port.requestAccess({ sysex: false });
    const input = access.inputs.get('in-1')!;
    access.add(new FakePort('in-5', 'X', 'input'));
    const foreign: Handler = () => undefined;
    input.onmidimessage = foreign; // a handler we did not install is left alone on close
    port.close();
    expect(access.listenerCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(input.onmidimessage).toBe(foreign);
    expect(access.inputs.get('in-5')!.onmidimessage).toBeNull();
    expect(port.getStatus()).toBe('idle');
    expect(port.listPorts()).toEqual([]);
    const before = lists.length;
    access.fire();
    vi.advanceTimersByTime(10_000);
    expect(lists).toHaveLength(before);
  });

  it('works end-to-end under MidiService', async () => {
    const { port, access } = setup();
    const service = new MidiService({ port, profiles: [], now: () => 0 });
    const types: string[] = [];
    const errors: string[] = [];
    service.subscribe((e) => types.push(e.message.type));
    service.subscribeErrors((e) => errors.push(e.kind));
    await expect(service.requestAccess({ sysex: false })).resolves.toBe('granted');
    expect(service.listDevices().map((d) => d.displayName)).toEqual(['MPK mini 3', 'MPK mini 3']);
    const input = access.inputs.get('in-1')!;
    input.emit([0x90, 60, 100]);
    input.emit([0x90, 60]);
    input.state = 'disconnected';
    access.fire();
    expect(types).toEqual(['noteOn', 'noteOff']);
    expect(errors).toEqual(['invalid-input']);
    service.dispose();
    port.close();
  });
});
