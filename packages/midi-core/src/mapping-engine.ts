/**
 * Turns validated MIDI input into mapping effects (parameter changes and actions).
 *
 * The engine is pure apart from small per-mapping runtime state (pickup takeover, note
 * toggles, CC→action edges). It never mutates the project: the application applies the
 * returned effects through its command layer.
 *
 * Contract for `ParameterValueReader`: it must reflect effects applied from earlier
 * `process` calls (apply effects synchronously before handling the next event), otherwise
 * pickup takeover treats the stale value as an external change.
 */
import type {
  MappingTarget,
  MidiChannelFilter,
  MidiControlSource,
  MidiDeviceSelector,
  MidiMapping,
  MidiValueTransform,
  RelativeEncoding,
  StudioActionId,
} from '@studio/domain';
import { applyValueTransform } from './curves';
import type { MidiMessage } from './messages';
import type { MappingEffect, MidiInputEvent, ParameterValueReader } from './types';

/** Pickup tolerance: one 7-bit step (plus float slack). */
export const PICKUP_TOLERANCE = 1 / 127 + 1e-9;
/** A parameter further than this from the last values we sent was changed elsewhere. */
const DIVERGENCE_TOLERANCE = 1.5 / 127;

const clamp01 = (value: number): number => (value <= 0 ? 0 : value >= 1 ? 1 : value);

export function matchesDevice(selector: MidiDeviceSelector | null, event: MidiInputEvent): boolean {
  if (selector === null) return true;
  const { profileId, portName } = selector;
  if (profileId === undefined && portName === undefined) return true;
  if (profileId !== undefined && event.profileId === profileId) return true;
  return portName !== undefined && event.portName === portName;
}

export function matchesChannel(filter: MidiChannelFilter, channel: number): boolean {
  return filter === 'any' || filter === channel;
}

/**
 * Decodes a relative-encoder CC value into signed steps.
 * - twosComplement: 1..63 = +1..+63, 65..127 = −63..−1 (64 = −64)
 * - signedBit: bit 6 is the sign; 1..63 = +1..+63, 65..127 = −1..−63
 * - binaryOffset: 64 = 0; 65.. = +1.., ..63 = ..−1
 */
export function decodeRelative(value: number, encoding: RelativeEncoding): number {
  const v = value & 0x7f;
  switch (encoding) {
    case 'twosComplement':
      return v < 64 ? v : v - 128;
    case 'signedBit':
      return v & 0x40 ? -(v & 0x3f) : v & 0x3f;
    case 'binaryOffset':
      return v - 64;
  }
}

/** Actions that flip state each time they are invoked (named `*.toggle*`). */
export function isToggleAction(action: StudioActionId): boolean {
  return /\.toggle/.test(action);
}

/**
 * How applications should interpret an `action` effect: toggle-type actions are invoked
 * on every effect (each effect is a state change: press, release of a gate, or a toggle
 * flip); other actions are invoked only when `value` is 1 (press/trigger).
 */
export function shouldInvokeAction(effect: Extract<MappingEffect, { kind: 'action' }>): boolean {
  return isToggleAction(effect.action) || effect.value >= 0.5;
}

interface MappingRuntimeState {
  pickedUp: boolean;
  /** Previous incoming target value while waiting for pickup (target space). */
  lastIncoming?: number;
  /** Last two values sent, to detect external parameter changes. */
  sent: number[];
  toggle: boolean;
  /** CC/pitch-bend → action edge state. */
  pressed: boolean;
}

type ProcessResult = { normalized: number } | { action: number } | null;

export class MappingEngine {
  private mappings: readonly MidiMapping[] = [];
  private readonly state = new Map<string, MappingRuntimeState>();

  /** Replaces the mapping set. Runtime state is kept for mappings whose id and source persist. */
  setMappings(mappings: readonly MidiMapping[]): void {
    const next = new Map<string, MidiMapping>(mappings.map((m) => [m.id, m]));
    for (const [id] of this.state) {
      const previous = this.mappings.find((m) => m.id === id);
      const current = next.get(id);
      if (!current || !previous || !sameSourceAndTarget(previous, current)) this.state.delete(id);
    }
    this.mappings = [...mappings];
  }

  getMappings(): readonly MidiMapping[] {
    return this.mappings;
  }

  /**
   * Re-arms pickup takeover (all mappings, or one) — call after loading a project,
   * switching the selected track, or any bulk parameter change.
   */
  resetTakeover(mappingId?: string): void {
    for (const [id, state] of this.state) {
      if (mappingId !== undefined && id !== mappingId) continue;
      state.pickedUp = false;
      delete state.lastIncoming;
      state.sent = [];
    }
  }

  /** Resets every runtime state (takeover, toggles, edges). */
  resetAll(): void {
    this.state.clear();
  }

  process(event: MidiInputEvent, reader: ParameterValueReader): MappingEffect[] {
    const effects: MappingEffect[] = [];
    for (const mapping of this.mappings) {
      if (!mapping.enabled || !matchesDevice(mapping.device, event)) continue;
      const result = this.evaluate(mapping, event.message, reader);
      if (result === null) continue;
      effects.push(toEffect(mapping, result));
    }
    return effects;
  }

  private stateFor(id: string): MappingRuntimeState {
    let state = this.state.get(id);
    if (!state) {
      state = { pickedUp: false, sent: [], toggle: false, pressed: false };
      this.state.set(id, state);
    }
    return state;
  }

  private evaluate(
    mapping: MidiMapping,
    message: MidiMessage,
    reader: ParameterValueReader,
  ): ProcessResult {
    const source = mapping.source;
    switch (source.kind) {
      case 'cc':
        if (
          message.type !== 'controlChange' ||
          message.controller !== source.controller ||
          !matchesChannel(source.channel, message.channel)
        ) {
          return null;
        }
        return source.mode === 'absolute'
          ? this.absolute(mapping, message.value / 127, reader, true)
          : this.relative(mapping, source.mode, message.value, reader);
      case 'pitchBend':
        if (message.type !== 'pitchBend' || !matchesChannel(source.channel, message.channel)) {
          return null;
        }
        return this.absolute(mapping, (message.value + 8192) / 16383, reader, false);
      case 'note':
        return this.note(mapping, source, message);
      case 'programChange':
        if (message.type !== 'programChange' || !matchesChannel(source.channel, message.channel)) {
          return null;
        }
        if (source.program === undefined) {
          return this.absolute(mapping, message.program / 127, reader, false);
        }
        if (message.program !== source.program) return null;
        return mapping.target.kind === 'action'
          ? { action: 1 }
          : { normalized: applyValueTransform(1, mapping.transform) };
    }
  }

  private absolute(
    mapping: MidiMapping,
    position: number,
    reader: ParameterValueReader,
    allowPickup: boolean,
  ): ProcessResult {
    const target = mapping.target;
    if (target.kind === 'action') {
      const state = this.stateFor(mapping.id);
      const pressed = position >= 0.5;
      if (pressed === state.pressed) return null;
      state.pressed = pressed;
      return { action: pressed ? 1 : 0 };
    }
    const value = applyValueTransform(position, mapping.transform);
    if (!allowPickup || mapping.transform.takeover !== 'pickup') return { normalized: value };
    return this.pickup(mapping.id, value, reader.getNormalized(target.address));
  }

  private pickup(id: string, value: number, current: number | undefined): ProcessResult {
    const state = this.stateFor(id);
    if (current === undefined) {
      // Unknown parameter value (e.g. nothing selected): nothing to protect, follow.
      return this.follow(state, value);
    }
    if (
      state.pickedUp &&
      state.sent.length > 0 &&
      state.sent.every((sent) => Math.abs(sent - current) > DIVERGENCE_TOLERANCE)
    ) {
      // The parameter moved elsewhere (UI, automation, undo): re-arm.
      state.pickedUp = false;
      state.sent = [];
      delete state.lastIncoming;
    }
    if (!state.pickedUp) {
      const previous = state.lastIncoming;
      const close = Math.abs(value - current) <= PICKUP_TOLERANCE;
      const crossed = previous !== undefined && (previous - current) * (value - current) <= 0;
      if (!close && !crossed) {
        state.lastIncoming = value;
        return null;
      }
      state.pickedUp = true;
    }
    return this.follow(state, value);
  }

  private follow(state: MappingRuntimeState, value: number): ProcessResult {
    state.lastIncoming = value;
    state.sent = [value, ...state.sent].slice(0, 2);
    return { normalized: value };
  }

  private relative(
    mapping: MidiMapping,
    encoding: RelativeEncoding,
    raw: number,
    reader: ParameterValueReader,
  ): ProcessResult {
    const steps = decodeRelative(raw, encoding);
    if (steps === 0) return null;
    const target = mapping.target;
    const transform = mapping.transform;
    const direction = transform.invert ? -steps : steps;
    if (target.kind === 'action') return direction > 0 ? { action: 1 } : null;
    const lo = Math.min(transform.min, transform.max);
    const hi = Math.max(transform.min, transform.max);
    const current = reader.getNormalized(target.address) ?? lo;
    const next = Math.min(hi, Math.max(lo, current + direction * transform.relativeStep));
    return { normalized: clamp01(next) };
  }

  private note(
    mapping: MidiMapping,
    source: Extract<MidiControlSource, { kind: 'note' }>,
    message: MidiMessage,
  ): ProcessResult {
    if (
      (message.type !== 'noteOn' && message.type !== 'noteOff') ||
      message.note !== source.note ||
      !matchesChannel(source.channel, message.channel)
    ) {
      return null;
    }
    const on = message.type === 'noteOn';
    let level: 0 | 1;
    switch (source.behavior) {
      case 'trigger':
        if (!on) return null;
        level = 1;
        break;
      case 'gate':
        level = on ? 1 : 0;
        break;
      case 'toggle': {
        if (!on) return null;
        const state = this.stateFor(mapping.id);
        state.toggle = !state.toggle;
        level = state.toggle ? 1 : 0;
        break;
      }
    }
    return mapping.target.kind === 'action'
      ? { action: level }
      : { normalized: levelValue(level, mapping.transform) };
  }
}

function levelValue(level: 0 | 1, transform: MidiValueTransform): number {
  return applyValueTransform(level, transform);
}

function sameTarget(a: MappingTarget, b: MappingTarget): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameSourceAndTarget(a: MidiMapping, b: MidiMapping): boolean {
  return JSON.stringify(a.source) === JSON.stringify(b.source) && sameTarget(a.target, b.target);
}

function toEffect(mapping: MidiMapping, result: NonNullable<ProcessResult>): MappingEffect {
  const target = mapping.target;
  const level = 'action' in result ? result.action : result.normalized;
  if (target.kind === 'action') {
    return {
      kind: 'action',
      mappingId: mapping.id,
      action: target.action,
      value: level >= 0.5 ? 1 : 0,
    };
  }
  return {
    kind: 'setParameter',
    mappingId: mapping.id,
    address: target.address,
    normalized: level,
  };
}
