import type {
  MidiAccessPort,
  MidiAccessStatus,
  MidiPortDescriptor,
  RawMidiInput,
} from '@studio/midi-core';

/** Scriptable MIDI host port: tests connect ports and inject raw bytes. */
export class FakeMidiPort implements MidiAccessPort {
  readonly supported = true;
  private status: MidiAccessStatus = 'idle';
  private ports: MidiPortDescriptor[] = [];
  private readonly messageListeners = new Set<(input: RawMidiInput) => void>();
  private readonly portListeners = new Set<(ports: MidiPortDescriptor[]) => void>();
  readonly sent: Array<{ portId: string; bytes: number[] }> = [];
  grant: MidiAccessStatus = 'granted';

  async requestAccess(): Promise<MidiAccessStatus> {
    this.status = this.grant;
    return this.status;
  }
  getStatus() {
    return this.status;
  }
  listPorts() {
    return this.status === 'granted' ? [...this.ports] : [];
  }
  onPortsChanged(listener: (ports: MidiPortDescriptor[]) => void) {
    this.portListeners.add(listener);
    return () => this.portListeners.delete(listener);
  }
  onMessage(listener: (input: RawMidiInput) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }
  send(portId: string, bytes: Uint8Array) {
    this.sent.push({ portId, bytes: [...bytes] });
  }
  close() {
    this.messageListeners.clear();
    this.portListeners.clear();
  }
  connect(port: MidiPortDescriptor): void {
    this.ports = [...this.ports.filter((p) => p.id !== port.id), port];
    for (const l of this.portListeners) l(this.listPorts());
  }
  disconnect(portId: string): void {
    this.ports = this.ports.map((p) =>
      p.id === portId ? { ...p, state: 'disconnected' as const } : p,
    );
    for (const l of this.portListeners) l(this.listPorts());
  }
  input(portId: string, bytes: number[], timestampMs = 0): void {
    for (const l of this.messageListeners)
      l({ portId, bytes: Uint8Array.from(bytes), timestampMs });
  }
}
