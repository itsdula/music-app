import type { MidiAccessPort, MidiAccessStatus, MidiPortDescriptor, RawMidiInput } from '../src';

/** In-memory MidiAccessPort for tests. */
export class FakeMidiAccessPort implements MidiAccessPort {
  supported = true;
  status: MidiAccessStatus = 'idle';
  ports: MidiPortDescriptor[] = [];
  sent: Array<{ portId: string; bytes: number[]; timestampMs?: number }> = [];
  requests: Array<{ sysex: boolean }> = [];
  grant: MidiAccessStatus | Error = 'granted';
  sendError: Error | null = null;
  listThrows = false;
  closed = false;
  private readonly portListeners = new Set<(ports: MidiPortDescriptor[]) => void>();
  private readonly messageListeners = new Set<(input: RawMidiInput) => void>();

  requestAccess(request: { sysex: boolean }): Promise<MidiAccessStatus> {
    this.requests.push({ ...request });
    if (this.grant instanceof Error) return Promise.reject(this.grant);
    this.status = this.grant;
    return Promise.resolve(this.status);
  }
  getStatus(): MidiAccessStatus {
    return this.status;
  }
  listPorts(): MidiPortDescriptor[] {
    if (this.listThrows) throw new Error('list failed');
    return this.ports.map((p) => ({ ...p }));
  }
  onPortsChanged(listener: (ports: MidiPortDescriptor[]) => void): () => void {
    this.portListeners.add(listener);
    return () => this.portListeners.delete(listener);
  }
  onMessage(listener: (input: RawMidiInput) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
  send(portId: string, bytes: Uint8Array, timestampMs?: number): void {
    if (this.sendError) throw this.sendError;
    this.sent.push({
      portId,
      bytes: Array.from(bytes),
      ...(timestampMs !== undefined ? { timestampMs } : {}),
    });
  }
  close(): void {
    this.closed = true;
  }

  get listenerCount(): number {
    return this.portListeners.size + this.messageListeners.size;
  }

  setPorts(ports: MidiPortDescriptor[]): void {
    this.ports = ports;
    for (const l of [...this.portListeners]) l(this.listPorts());
  }

  receive(portId: string, bytes: number[], timestampMs = 0): void {
    for (const l of [...this.messageListeners])
      l({ portId, bytes: Uint8Array.from(bytes), timestampMs });
  }
}

export const input = (
  id: string,
  name: string,
  state: 'connected' | 'disconnected' = 'connected',
): MidiPortDescriptor => ({
  id,
  name,
  type: 'input',
  state,
});

export const output = (
  id: string,
  name: string,
  state: 'connected' | 'disconnected' = 'connected',
): MidiPortDescriptor => ({
  id,
  name,
  type: 'output',
  state,
});
