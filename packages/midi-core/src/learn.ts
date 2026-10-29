/**
 * MIDI Learn: wait for the user to move a control, then propose a mapping for a target.
 *
 * Clock-free and timer-free: time comes from the injected `now()`; the timeout is
 * evaluated whenever `handle`, `getState` or `checkTimeout` is called (the UI can call
 * `checkTimeout` from its own timer to show the timeout without MIDI traffic).
 *
 * Relative-encoder detection: a CC is captured immediately as `absolute`. If more values
 * from the same controller arrive within `relativeDetectionWindowMs` and they repeat
 * around 1/127 (two's complement) or 63/65 (binary offset), the captured proposal is
 * upgraded and subscribers are notified. Absolute knobs only send on change, so a repeat
 * of the same value is the distinguishing signal. Commit the proposal after the user
 * confirms (or after the window) to benefit from the refinement. `signedBit` is never
 * guessed — it is ambiguous with the other encodings; users pick it explicitly.
 */
import {
  DEFAULT_VALUE_TRANSFORM,
  type MappingScope,
  type MappingTarget,
  type MidiControlSource,
  type MidiMapping,
  type RelativeEncoding,
} from '@studio/domain';
import { isToggleAction } from './mapping-engine';
import type { MidiInputEvent, MidiLearnState } from './types';

export interface MidiLearnOptions {
  readonly now: () => number;
  /** Listening timeout; default 15 s. 0 or Infinity disables it. */
  readonly timeoutMs?: number;
  /** Window after a CC capture in which relative encoders are detected; default 600 ms. */
  readonly relativeDetectionWindowMs?: number;
  /** Scope of the proposed mapping; default 'project'. */
  readonly scope?: MappingScope;
}

export interface MidiLearnSession {
  start(target: MappingTarget): MidiLearnState;
  cancel(): MidiLearnState;
  handle(event: MidiInputEvent): MidiLearnState;
  getState(): MidiLearnState;
  /** Applies the timeout without an incoming event; returns the (possibly idle) state. */
  checkTimeout(): MidiLearnState;
  subscribe(listener: (state: MidiLearnState) => void): () => void;
}

export const DEFAULT_LEARN_TIMEOUT_MS = 15_000;
export const DEFAULT_RELATIVE_DETECTION_WINDOW_MS = 600;
/** Pitch bend must move this far from centre to count (ignores a resting joystick). */
export const LEARN_PITCH_BEND_THRESHOLD = 1024;
const RELATIVE_MIN_VALUES = 3;

interface CcCandidate {
  readonly portId: string;
  readonly channel: number;
  readonly controller: number;
  readonly firstAtMs: number;
  readonly values: number[];
}

/** Guesses a relative encoding from the first values a controller sent, if any. */
export function detectRelativeEncoding(values: readonly number[]): RelativeEncoding | null {
  if (values.length < RELATIVE_MIN_VALUES) return null;
  let repeats = false;
  for (let i = 1; i < values.length; i++) if (values[i] === values[i - 1]) repeats = true;
  if (!repeats) return null;
  const twos = values.every((v) => (v >= 1 && v <= 3) || (v >= 125 && v <= 127));
  if (twos) return 'twosComplement';
  const offset = values.every((v) => (v >= 61 && v <= 63) || (v >= 65 && v <= 67));
  if (offset) return 'binaryOffset';
  return null;
}

export function createMidiLearnSession(options: MidiLearnOptions): MidiLearnSession {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LEARN_TIMEOUT_MS;
  const windowMs = options.relativeDetectionWindowMs ?? DEFAULT_RELATIVE_DETECTION_WINDOW_MS;
  const scope = options.scope ?? 'project';
  const listeners = new Set<(state: MidiLearnState) => void>();
  let state: MidiLearnState = { phase: 'idle' };
  let candidate: CcCandidate | null = null;

  const set = (next: MidiLearnState): MidiLearnState => {
    state = next;
    for (const listener of [...listeners]) listener(state);
    return state;
  };

  const timedOut = (): boolean =>
    state.phase === 'listening' &&
    timeoutMs > 0 &&
    Number.isFinite(timeoutMs) &&
    options.now() - state.startedAtMs >= timeoutMs;

  const checkTimeout = (): MidiLearnState => {
    if (timedOut()) {
      candidate = null;
      return set({ phase: 'idle' });
    }
    return state;
  };

  const propose = (
    event: MidiInputEvent,
    target: MappingTarget,
    source: MidiControlSource,
  ): Omit<MidiMapping, 'id'> => {
    const absoluteCcToParameter =
      source.kind === 'cc' && source.mode === 'absolute' && target.kind === 'parameter';
    return {
      source,
      device:
        event.profileId !== undefined
          ? { profileId: event.profileId }
          : { portName: event.portName },
      target,
      transform: {
        ...DEFAULT_VALUE_TRANSFORM,
        takeover: absoluteCcToParameter ? 'pickup' : DEFAULT_VALUE_TRANSFORM.takeover,
      },
      scope,
      enabled: true,
      label: sourceLabel(event, source),
    };
  };

  const capture = (event: MidiInputEvent, target: MappingTarget): MidiLearnState => {
    const message = event.message;
    let source: MidiControlSource;
    switch (message.type) {
      case 'controlChange':
        source = {
          kind: 'cc',
          channel: message.channel,
          controller: message.controller,
          mode: 'absolute',
        };
        candidate = {
          portId: event.portId,
          channel: message.channel,
          controller: message.controller,
          firstAtMs: options.now(),
          values: [message.value],
        };
        break;
      case 'noteOn':
        source = {
          kind: 'note',
          channel: message.channel,
          note: message.note,
          behavior:
            target.kind === 'action' && isToggleAction(target.action) ? 'toggle' : 'trigger',
        };
        break;
      case 'pitchBend':
        if (Math.abs(message.value) < LEARN_PITCH_BEND_THRESHOLD) return state;
        source = { kind: 'pitchBend', channel: message.channel };
        break;
      case 'programChange':
        source = { kind: 'programChange', channel: message.channel, program: message.program };
        break;
      default:
        // Clock, active sensing, other system messages, note-offs and aftertouch are noise.
        return state;
    }
    return set({ phase: 'captured', target, mapping: propose(event, target, source) });
  };

  const refine = (event: MidiInputEvent): MidiLearnState => {
    const message = event.message;
    if (
      state.phase !== 'captured' ||
      candidate === null ||
      message.type !== 'controlChange' ||
      event.portId !== candidate.portId ||
      message.channel !== candidate.channel ||
      message.controller !== candidate.controller
    ) {
      return state;
    }
    if (options.now() - candidate.firstAtMs > windowMs) {
      candidate = null;
      return state;
    }
    candidate.values.push(message.value);
    const encoding = detectRelativeEncoding(candidate.values);
    const current = state.mapping;
    if (encoding === null || current.source.kind !== 'cc' || current.source.mode === encoding) {
      return state;
    }
    const source: MidiControlSource = { ...current.source, mode: encoding };
    return set({
      phase: 'captured',
      target: state.target,
      mapping: {
        ...current,
        source,
        transform: { ...current.transform, takeover: 'immediate' },
        label: sourceLabel(event, source),
      },
    });
  };

  return {
    start(target) {
      candidate = null;
      return set({ phase: 'listening', target, startedAtMs: options.now() });
    },
    cancel() {
      candidate = null;
      return state.phase === 'idle' ? state : set({ phase: 'idle' });
    },
    handle(event) {
      if (state.phase === 'captured') return refine(event);
      if (state.phase !== 'listening') return state;
      if (timedOut()) return checkTimeout();
      return capture(event, state.target);
    },
    getState() {
      return checkTimeout();
    },
    checkTimeout,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function sourceLabel(event: MidiInputEvent, source: MidiControlSource): string {
  const device = event.portName || event.portId;
  const control = event.control ? `${event.control.controlId} · ` : '';
  switch (source.kind) {
    case 'cc':
      return `${device}: ${control}CC ${source.controller} ch ${String(source.channel)}${source.mode === 'absolute' ? '' : ` (relative, ${source.mode})`}`;
    case 'note':
      return `${device}: ${control}Note ${source.note} ch ${String(source.channel)}`;
    case 'pitchBend':
      return `${device}: ${control}Pitch Bend ch ${String(source.channel)}`;
    case 'programChange':
      return `${device}: ${control}Program ${String(source.program ?? 'any')} ch ${String(source.channel)}`;
  }
}
