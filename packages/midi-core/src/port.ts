/**
 * Host adapter port for MIDI I/O (Web MIDI in browsers/Electron; a native bridge, e.g.
 * Rust `midir`, for Tauri). Implementations only move bytes — all interpretation happens
 * in this package so behaviour is identical across hosts.
 */

export interface MidiPortDescriptor {
  /** Host-assigned id; stable for the session, not guaranteed across sessions. */
  readonly id: string;
  readonly name: string;
  readonly manufacturer?: string;
  readonly type: 'input' | 'output';
  readonly state: 'connected' | 'disconnected';
}

/** Untrusted raw input exactly as delivered by the host. */
export interface RawMidiInput {
  readonly portId: string;
  readonly bytes: Uint8Array;
  /** Host high-resolution clock, milliseconds (performance.now() domain in browsers). */
  readonly timestampMs: number;
}

export type MidiAccessStatus =
  'unsupported' | 'idle' | 'requesting' | 'granted' | 'denied' | 'error';

export interface MidiAccessRequest {
  readonly sysex: boolean;
}

export interface MidiAccessPort {
  /** False when the host has no MIDI capability at all (e.g. Safari without Web MIDI). */
  readonly supported: boolean;
  requestAccess(request: MidiAccessRequest): Promise<MidiAccessStatus>;
  getStatus(): MidiAccessStatus;
  listPorts(): MidiPortDescriptor[];
  /** Fires on hotplug/connection changes with the full current port list. */
  onPortsChanged(listener: (ports: MidiPortDescriptor[]) => void): () => void;
  /** Receives messages from every connected input port. */
  onMessage(listener: (input: RawMidiInput) => void): () => void;
  /** Sends bytes to an output port, optionally scheduled at a host timestamp (ms). */
  send(portId: string, bytes: Uint8Array, timestampMs?: number): void;
  close(): void;
}
