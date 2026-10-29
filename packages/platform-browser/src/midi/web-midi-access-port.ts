/**
 * Web MIDI implementation of `MidiAccessPort` (Chrome/Edge, Firefox with its site-permission
 * add-on, Electron, Tauri on Windows/WebView2). Only moves bytes; all interpretation lives
 * in @studio/midi-core.
 *
 * Host notes (docs/research/platform-compatibility.md, docs/midi-device-research.md §8):
 * - Safari/WebKit has no Web MIDI → `supported` is false and status 'unsupported'.
 * - Chrome 124+ prompts for any MIDI access; denial surfaces as NotAllowedError.
 * - Firefox's `statechange` never fires (bug 1802149), so while listeners exist the port
 *   list is also polled (default every 2 s) and new inputs are attached on change.
 */
import type {
  MidiAccessPort,
  MidiAccessRequest,
  MidiAccessStatus,
  MidiPortDescriptor,
  RawMidiInput,
} from '@studio/midi-core';

export interface WebMidiNavigatorLike {
  requestMIDIAccess?: (options?: MIDIOptions) => Promise<MIDIAccess>;
}

export interface WebMidiAccessPortOptions {
  /** Defaults to the global `navigator`. Inject a fake in tests or polyfilled hosts. */
  readonly navigator?: WebMidiNavigatorLike;
  /** Hotplug polling interval while listeners exist; 0 disables polling. Default 2000. */
  readonly pollIntervalMs?: number;
}

export const DEFAULT_WEB_MIDI_POLL_INTERVAL_MS = 2000;

/** Maps a `requestMIDIAccess` rejection to an access status. */
export function mapWebMidiAccessError(error: unknown): MidiAccessStatus {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied';
    case 'NotSupportedError':
      return 'unsupported';
    default:
      return 'error';
  }
}

function describePort(port: MIDIPort, type: 'input' | 'output'): MidiPortDescriptor {
  return {
    id: port.id,
    name: port.name ?? '',
    ...(port.manufacturer ? { manufacturer: port.manufacturer } : {}),
    type,
    state: port.state === 'connected' ? 'connected' : 'disconnected',
  };
}

function signature(ports: readonly MidiPortDescriptor[]): string {
  return ports
    .map((p) => `${p.type}\u0000${p.id}\u0000${p.state}\u0000${p.name}`)
    .sort()
    .join('\n');
}

function report(error: unknown): void {
  // Listener bugs must not stop delivery to other listeners or break the host callback.
  if (typeof globalThis.reportError === 'function') {
    globalThis.reportError(error);
  } else {
    queueMicrotask(() => {
      throw error;
    });
  }
}

export function createWebMidiAccessPort(options: WebMidiAccessPortOptions = {}): MidiAccessPort {
  const nav: WebMidiNavigatorLike | undefined =
    options.navigator ?? (typeof navigator === 'undefined' ? undefined : navigator);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_WEB_MIDI_POLL_INTERVAL_MS;
  const supported = typeof nav?.requestMIDIAccess === 'function';

  let status: MidiAccessStatus = supported ? 'idle' : 'unsupported';
  let access: MIDIAccess | null = null;
  let pending: Promise<MidiAccessStatus> | null = null;
  let closed = false;
  let lastSignature = '';
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const portListeners = new Set<(ports: MidiPortDescriptor[]) => void>();
  const messageListeners = new Set<(input: RawMidiInput) => void>();
  const handlers = new Map<MIDIInput, (event: MIDIMessageEvent) => void>();

  const listPorts = (): MidiPortDescriptor[] => {
    if (!access) return [];
    const ports: MidiPortDescriptor[] = [];
    access.inputs.forEach((port) => ports.push(describePort(port, 'input')));
    access.outputs.forEach((port) => ports.push(describePort(port, 'output')));
    return ports;
  };

  const deliver = (input: RawMidiInput): void => {
    for (const listener of [...messageListeners]) {
      try {
        listener(input);
      } catch (error) {
        report(error);
      }
    }
  };

  const attachInputs = (): void => {
    if (!access) return;
    access.inputs.forEach((input) => {
      let handler = handlers.get(input);
      if (!handler) {
        const portId = input.id;
        handler = (event: MIDIMessageEvent) => {
          if (!event.data) return;
          // Copy: hosts may reuse the underlying buffer.
          deliver({ portId, bytes: new Uint8Array(event.data), timestampMs: event.timeStamp });
        };
        handlers.set(input, handler);
      }
      // Assigning onmidimessage implicitly opens the port (Web MIDI spec).
      if (input.state === 'connected' && input.onmidimessage !== handler) {
        input.onmidimessage = handler;
      }
    });
  };

  const refresh = (): void => {
    if (!access) return;
    attachInputs();
    const ports = listPorts();
    const next = signature(ports);
    if (next === lastSignature) return;
    lastSignature = next;
    for (const listener of [...portListeners]) {
      try {
        listener(ports.map((p) => ({ ...p })));
      } catch (error) {
        report(error);
      }
    }
  };

  const onStateChange = (): void => refresh();

  const updatePolling = (): void => {
    const wanted =
      access !== null &&
      pollIntervalMs > 0 &&
      (portListeners.size > 0 || messageListeners.size > 0);
    if (wanted && pollTimer === null) {
      pollTimer = setInterval(refresh, pollIntervalMs);
    } else if (!wanted && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const request = async (sysex: boolean): Promise<MidiAccessStatus> => {
    status = 'requesting';
    try {
      const granted = await (nav as Required<WebMidiNavigatorLike>).requestMIDIAccess({ sysex });
      if (closed) {
        status = 'idle';
        return status;
      }
      access = granted;
      status = 'granted';
      granted.addEventListener('statechange', onStateChange);
      refresh();
      updatePolling();
      return status;
    } catch (error) {
      status = closed ? 'idle' : mapWebMidiAccessError(error);
      return status;
    } finally {
      pending = null;
    }
  };

  return {
    supported,
    requestAccess(req: MidiAccessRequest): Promise<MidiAccessStatus> {
      if (!supported) return Promise.resolve('unsupported');
      if (access) return Promise.resolve(status);
      pending ??= request(req.sysex);
      return pending;
    },
    getStatus: () => status,
    listPorts,
    onPortsChanged(listener) {
      portListeners.add(listener);
      updatePolling();
      return () => {
        portListeners.delete(listener);
        updatePolling();
      };
    },
    onMessage(listener) {
      messageListeners.add(listener);
      updatePolling();
      return () => {
        messageListeners.delete(listener);
        updatePolling();
      };
    },
    send(portId, bytes, timestampMs) {
      if (!access) throw new Error('MIDI access has not been granted');
      const output = access.outputs.get(portId);
      if (!output) throw new Error(`Unknown MIDI output ${portId}`);
      const data = Array.from(bytes);
      if (timestampMs === undefined) output.send(data);
      else output.send(data, timestampMs);
    },
    close() {
      closed = true;
      if (access) access.removeEventListener('statechange', onStateChange);
      for (const [input, handler] of handlers) {
        if (input.onmidimessage === handler) input.onmidimessage = null;
      }
      handlers.clear();
      portListeners.clear();
      messageListeners.clear();
      access = null;
      updatePolling();
      lastSignature = '';
      status = supported ? 'idle' : 'unsupported';
    },
  };
}
