import type { Page } from '@playwright/test';

/**
 * Installs a scriptable stand-in for `navigator.requestMIDIAccess` before the page loads.
 * It models only what the Web MIDI spec guarantees (ports with id/name/state, `statechange`,
 * `onmidimessage`), so Studio's real adapter, MidiService and profile matching run unchanged.
 * It says nothing about how a physical MPK Mini MK3 behaves — hardware verification is a
 * separate, manual protocol (docs/midi-integration.md).
 */
export async function installFakeMidi(page: Page, ports: ReadonlyArray<{ id: string; name: string; manufacturer?: string }>): Promise<void> {
  await page.addInitScript((initialPorts) => {
    type Listener = (event: { data: Uint8Array; timeStamp: number }) => void;
    class FakeInput {
      readonly type = 'input';
      state: 'connected' | 'disconnected' = 'connected';
      connection: 'open' | 'closed' | 'pending' = 'closed';
      onmidimessage: Listener | null = null;
      constructor(
        readonly id: string,
        readonly name: string,
        readonly manufacturer: string,
      ) {}
      addEventListener(): void {}
      removeEventListener(): void {}
      open(): Promise<this> {
        this.connection = 'open';
        return Promise.resolve(this);
      }
      close(): Promise<this> {
        this.connection = 'closed';
        return Promise.resolve(this);
      }
    }
    const inputs = new Map<string, FakeInput>();
    for (const p of initialPorts) inputs.set(p.id, new FakeInput(p.id, p.name, p.manufacturer ?? ''));
    const access = new EventTarget() as EventTarget & { inputs: Map<string, FakeInput>; outputs: Map<string, never>; sysexEnabled: boolean };
    Object.assign(access, { inputs, outputs: new Map(), sysexEnabled: false });
    let requests = 0;
    const fake = {
      requests: () => requests,
      lastSysexRequest: null as boolean | null,
      send(portId: string, bytes: number[]): void {
        const input = inputs.get(portId);
        if (!input || input.state !== 'connected') return;
        input.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp: performance.now() });
      },
      setConnected(portId: string, connected: boolean): void {
        const input = inputs.get(portId);
        if (!input) return;
        input.state = connected ? 'connected' : 'disconnected';
        if (!connected) input.connection = 'closed';
        access.dispatchEvent(Object.assign(new Event('statechange'), { port: input }));
      },
      add(id: string, name: string): void {
        const input = new FakeInput(id, name, '');
        inputs.set(id, input);
        access.dispatchEvent(Object.assign(new Event('statechange'), { port: input }));
      },
    };
    Object.defineProperty(window, '__fakeMidi', { value: fake, configurable: true });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: (options?: { sysex?: boolean }) => {
        requests += 1;
        fake.lastSysexRequest = options?.sysex ?? false;
        return Promise.resolve(access);
      },
    });
  }, ports);
}

type FakeMidiHandle = {
  send(portId: string, bytes: number[]): void;
  setConnected(portId: string, connected: boolean): void;
  add(id: string, name: string): void;
  requests(): number;
  lastSysexRequest: boolean | null;
};

export function sendMidi(page: Page, portId: string, bytes: number[]): Promise<void> {
  return page.evaluate(
    ([id, data]) => (window as unknown as { __fakeMidi: FakeMidiHandle }).__fakeMidi.send(id, data),
    [portId, bytes] as const,
  );
}

/** Sends a run of messages in one round trip (e.g. a knob sweep). */
export function sendMidiBatch(page: Page, portId: string, messages: number[][]): Promise<void> {
  return page.evaluate(
    ([id, list]) => {
      const fake = (window as unknown as { __fakeMidi: FakeMidiHandle }).__fakeMidi;
      for (const bytes of list) fake.send(id, bytes);
    },
    [portId, messages] as const,
  );
}

export function setMidiPortConnected(page: Page, portId: string, connected: boolean): Promise<void> {
  return page.evaluate(
    ([id, on]) => (window as unknown as { __fakeMidi: FakeMidiHandle }).__fakeMidi.setConnected(id, on),
    [portId, connected] as const,
  );
}

export function lastSysexRequest(page: Page): Promise<boolean | null> {
  return page.evaluate(() => (window as unknown as { __fakeMidi: FakeMidiHandle }).__fakeMidi.lastSysexRequest);
}
