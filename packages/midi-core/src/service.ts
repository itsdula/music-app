/**
 * Orchestrates a host `MidiAccessPort`: validates raw input, annotates it with device
 * profile information, tracks sounding notes, and exposes a stable device list.
 *
 * Guarantees:
 * - Raw bytes are untrusted. Invalid input is dropped and reported to error listeners;
 *   nothing is thrown into the host callback. Listener exceptions are isolated too.
 * - When an input port disconnects (or the service is disposed) every note it left
 *   sounding gets a synthetic noteOff (and held sustain a synthetic CC64 = 0), delivered
 *   to subscribers like normal input, so instruments never hang.
 * - SysEx is never requested and never sent.
 */
import { err, ok, type Result } from '@studio/domain';
import { ActiveNoteTracker, type ActiveNoteRelease } from './active-notes';
import { formatMidiBytes } from './describe';
import type { MidiDeviceProfile } from './device-profile';
import { CC, type MidiMessage, type MidiParseError } from './messages';
import { encodeMidiMessage, parseMidiMessage } from './parse';
import type { MidiAccessPort, MidiAccessStatus, MidiPortDescriptor, RawMidiInput } from './port';
import type { MidiInputEvent } from './types';

export interface MidiDevice {
  readonly port: MidiPortDescriptor;
  readonly profile?: MidiDeviceProfile;
  /** Port name, disambiguated as "Name (2)", "Name (3)" … among same-type ports. */
  readonly displayName: string;
}

export type MidiServiceError =
  | {
      readonly kind: 'invalid-input';
      readonly portId: string;
      readonly portName: string;
      readonly error: MidiParseError;
      /** Sanitized hex preview of the offending bytes (truncated). */
      readonly bytes: string;
      readonly timestampMs: number;
    }
  | { readonly kind: 'listener-failed'; readonly message: string }
  | { readonly kind: 'send-failed'; readonly portId: string; readonly message: string }
  | { readonly kind: 'access-failed'; readonly message: string };

export type MidiSendErrorCode =
  | 'sysex-not-allowed'
  | 'unknown-port'
  | 'not-an-output'
  | 'disconnected'
  | 'invalid-message'
  | 'send-failed';

export interface MidiSendError {
  readonly code: MidiSendErrorCode;
  readonly message: string;
}

export interface MidiPanicOptions {
  /**
   * Also send Sustain Off (CC64 = 0) and All Notes Off (CC123) on all 16 channels to
   * output ports. Off by default: Studio never sends to hardware unless asked.
   */
  readonly sendAllNotesOffToOutputs?: boolean;
  /** Restrict the outputs that receive All Notes Off (default: every connected output). */
  readonly outputPortIds?: readonly string[];
}

export interface MidiPanicResult {
  readonly releasedNotes: number;
  readonly outputsNotified: number;
}

export interface MidiServiceOptions {
  readonly port: MidiAccessPort;
  readonly profiles: readonly MidiDeviceProfile[];
  readonly now: () => number;
}

type Listener<T> = (value: T) => void;

const typeOrder = (type: MidiPortDescriptor['type']): number => (type === 'input' ? 0 : 1);
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export class MidiService {
  private readonly port: MidiAccessPort;
  private readonly profiles: readonly MidiDeviceProfile[];
  private readonly now: () => number;
  private readonly tracker = new ActiveNoteTracker();
  private readonly listeners = new Set<Listener<MidiInputEvent>>();
  private readonly deviceListeners = new Set<Listener<MidiDevice[]>>();
  private readonly errorListeners = new Set<Listener<MidiServiceError>>();
  private readonly unsubscribers: Array<() => void> = [];
  /** Stable duplicate-name ordinals: port id → ordinal (1 = no suffix). */
  private readonly ordinals = new Map<string, number>();
  private devices: MidiDevice[] = [];
  private devicesById = new Map<string, MidiDevice>();
  private disposed = false;

  constructor(options: MidiServiceOptions) {
    this.port = options.port;
    this.profiles = options.profiles;
    this.now = options.now;
    this.unsubscribers.push(
      this.port.onMessage((input) => this.handleRaw(input)),
      this.port.onPortsChanged((ports) => this.updatePorts(ports)),
    );
    this.updatePorts(this.safeListPorts(), false);
  }

  get supported(): boolean {
    return this.port.supported;
  }

  /** Requests MIDI access. SysEx is never requested (the parameter type enforces it). */
  async requestAccess(
    _request: { readonly sysex: false } = { sysex: false },
  ): Promise<MidiAccessStatus> {
    if (!this.port.supported) return 'unsupported';
    let status: MidiAccessStatus;
    try {
      status = await this.port.requestAccess({ sysex: false });
    } catch (error) {
      this.reportError({ kind: 'access-failed', message: describeError(error) });
      return 'error';
    }
    if (status === 'granted') this.updatePorts(this.safeListPorts());
    return status;
  }

  getStatus(): MidiAccessStatus {
    return this.port.supported ? this.port.getStatus() : 'unsupported';
  }

  /** Inputs first, then outputs; each sorted by display name. */
  listDevices(): MidiDevice[] {
    return [...this.devices];
  }

  getDevice(portId: string): MidiDevice | undefined {
    return this.devicesById.get(portId);
  }

  subscribe(listener: Listener<MidiInputEvent>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeDevices(listener: Listener<MidiDevice[]>): () => void {
    this.deviceListeners.add(listener);
    return () => {
      this.deviceListeners.delete(listener);
    };
  }

  subscribeErrors(listener: Listener<MidiServiceError>): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  /** Number of notes currently sounding (as seen from input), optionally for one port. */
  activeNoteCount(portId?: string): number {
    return this.tracker.activeCount(portId);
  }

  /**
   * Releases every sounding note: synthetic noteOffs (and sustain-offs) go to subscribers.
   * Hardware outputs are only touched when `sendAllNotesOffToOutputs` is set.
   */
  panic(options: MidiPanicOptions = {}): MidiPanicResult {
    const releasedNotes = this.releaseNotes();
    let outputsNotified = 0;
    if (options.sendAllNotesOffToOutputs) {
      const wanted = options.outputPortIds ? new Set(options.outputPortIds) : null;
      for (const device of this.devices) {
        const { port } = device;
        if (port.type !== 'output' || port.state !== 'connected') continue;
        if (wanted && !wanted.has(port.id)) continue;
        let okAll = true;
        for (let channel = 1; channel <= 16; channel++) {
          for (const controller of [CC.sustain, CC.allNotesOff]) {
            const sent = this.send(port.id, {
              type: 'controlChange',
              channel,
              controller,
              value: 0,
            });
            okAll &&= sent.ok;
          }
        }
        if (okAll) outputsNotified++;
      }
    }
    return { releasedNotes, outputsNotified };
  }

  /** Sends a message to an output port. Never sends SysEx; never throws. */
  send(
    portId: string,
    message: MidiMessage,
    timestampMs?: number,
  ): Result<undefined, MidiSendError> {
    if (message.type === 'sysex') {
      return err({ code: 'sysex-not-allowed', message: 'Studio never sends SysEx' });
    }
    const device = this.devicesById.get(portId);
    if (!device) return err({ code: 'unknown-port', message: `Unknown MIDI port ${portId}` });
    if (device.port.type !== 'output') {
      return err({ code: 'not-an-output', message: `${device.displayName} is not an output` });
    }
    if (device.port.state !== 'connected') {
      return err({ code: 'disconnected', message: `${device.displayName} is disconnected` });
    }
    let bytes: Uint8Array;
    try {
      bytes = encodeMidiMessage(message);
    } catch (error) {
      return err({ code: 'invalid-message', message: describeError(error) });
    }
    try {
      this.port.send(portId, bytes, timestampMs);
    } catch (error) {
      const message = describeError(error);
      this.reportError({ kind: 'send-failed', portId, message });
      return err({ code: 'send-failed', message });
    }
    return ok(undefined);
  }

  /**
   * Releases sounding notes (delivered to subscribers), detaches from the port and drops
   * all listeners. The port itself belongs to the platform and is not closed.
   */
  dispose(): void {
    if (this.disposed) return;
    this.releaseNotes();
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.listeners.clear();
    this.deviceListeners.clear();
    this.errorListeners.clear();
  }

  private handleRaw(input: RawMidiInput): void {
    if (this.disposed) return;
    const device = this.devicesById.get(input.portId);
    const portName = device?.port.name ?? '';
    const parsed = parseMidiMessage(input.bytes);
    if (!parsed.ok) {
      this.reportError({
        kind: 'invalid-input',
        portId: input.portId,
        portName,
        error: parsed.error,
        bytes: formatMidiBytes(input.bytes),
        timestampMs: input.timestampMs,
      });
      return;
    }
    const message = parsed.value;
    const profile = device?.profile;
    let control: MidiInputEvent['control'];
    if (profile) {
      try {
        control = profile.identify(message) ?? undefined;
      } catch (error) {
        this.reportError({ kind: 'listener-failed', message: describeError(error) });
      }
    }
    const event: MidiInputEvent = {
      portId: input.portId,
      portName,
      ...(profile ? { profileId: profile.id } : {}),
      message,
      timestampMs: input.timestampMs,
      ...(control ? { control } : {}),
    };
    this.tracker.handle(event);
    this.emit(event);
  }

  private emit(event: MidiInputEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.reportError({ kind: 'listener-failed', message: describeError(error) });
      }
    }
  }

  private releaseNotes(portId?: string): number {
    const notes = this.tracker.releaseAll(portId);
    const pedals = this.tracker.releaseSustain(portId);
    const timestampMs = this.now();
    const toEvent = (release: ActiveNoteRelease<MidiMessage>): MidiInputEvent => ({
      portId: release.portId,
      portName: release.portName,
      ...(release.profileId !== undefined ? { profileId: release.profileId } : {}),
      message: release.message,
      timestampMs,
    });
    for (const release of [...notes, ...pedals]) this.emit(toEvent(release));
    return notes.length;
  }

  private safeListPorts(): MidiPortDescriptor[] {
    try {
      return this.port.listPorts();
    } catch (error) {
      this.reportError({ kind: 'access-failed', message: describeError(error) });
      return [];
    }
  }

  private updatePorts(ports: readonly MidiPortDescriptor[], notify = true): void {
    if (this.disposed) return;
    const previous = this.devicesById;
    const present = new Set(ports.map((p) => p.id));

    // Release notes from inputs that went away or disconnected.
    for (const [id, device] of previous) {
      if (device.port.type !== 'input') continue;
      const now = ports.find((p) => p.id === id);
      if (!now || now.state !== 'connected') this.releaseNotes(id);
    }

    // Forget ordinals of ports that vanished from the host's list.
    for (const id of [...this.ordinals.keys()]) if (!present.has(id)) this.ordinals.delete(id);

    // Assign ordinals: existing ports keep theirs; new ones (sorted by id) take the
    // lowest free ordinal for their (type, name).
    const groupKey = (p: MidiPortDescriptor): string => `${p.type}\u0000${p.name}`;
    const used = new Map<string, Set<number>>();
    for (const p of ports) {
      const ordinal = this.ordinals.get(p.id);
      if (ordinal === undefined) continue;
      const set = used.get(groupKey(p)) ?? new Set<number>();
      set.add(ordinal);
      used.set(groupKey(p), set);
    }
    for (const p of [...ports].sort((a, b) => cmp(a.id, b.id))) {
      if (this.ordinals.has(p.id)) continue;
      const set = used.get(groupKey(p)) ?? new Set<number>();
      let ordinal = 1;
      while (set.has(ordinal)) ordinal++;
      set.add(ordinal);
      used.set(groupKey(p), set);
      this.ordinals.set(p.id, ordinal);
    }

    const devices = ports.map((port): MidiDevice => {
      const ordinal = this.ordinals.get(port.id) ?? 1;
      const profile = this.matchProfile(port);
      const baseName = port.name || port.id;
      return {
        port: { ...port },
        ...(profile ? { profile } : {}),
        displayName: ordinal > 1 ? `${baseName} (${ordinal})` : baseName,
      };
    });
    devices.sort(
      (a, b) =>
        typeOrder(a.port.type) - typeOrder(b.port.type) ||
        cmp(a.displayName.toLowerCase(), b.displayName.toLowerCase()) ||
        cmp(a.port.id, b.port.id),
    );

    const changed = !sameDevices(this.devices, devices);
    this.devices = devices;
    this.devicesById = new Map(devices.map((d) => [d.port.id, d]));
    if (changed && notify) {
      const snapshot = this.listDevices();
      for (const listener of [...this.deviceListeners]) {
        try {
          listener(snapshot);
        } catch (error) {
          this.reportError({ kind: 'listener-failed', message: describeError(error) });
        }
      }
    }
  }

  private matchProfile(port: MidiPortDescriptor): MidiDeviceProfile | undefined {
    let best: MidiDeviceProfile | undefined;
    let bestScore = 0;
    for (const profile of this.profiles) {
      let score: number;
      try {
        score = profile.matchPort(port);
      } catch {
        score = 0; // A faulty profile must not break device listing.
      }
      if (score > bestScore) {
        best = profile;
        bestScore = score;
      }
    }
    return best;
  }

  private reportError(error: MidiServiceError): void {
    for (const listener of [...this.errorListeners]) {
      try {
        listener(error);
      } catch {
        // An error listener failing must not cascade; there is nowhere left to report it.
      }
    }
  }
}

function sameDevices(a: readonly MidiDevice[], b: readonly MidiDevice[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((d, i) => {
    const o = b[i];
    return (
      o !== undefined &&
      d.port.id === o.port.id &&
      d.port.state === o.port.state &&
      d.port.name === o.port.name &&
      d.port.type === o.port.type &&
      d.displayName === o.displayName &&
      d.profile?.id === o.profile?.id
    );
  });
}
