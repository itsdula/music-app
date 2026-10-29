import { describe, expect, it } from 'vitest';
import { DEFAULT_VALUE_TRANSFORM, type MappingTarget } from '@studio/domain';
import {
  createMidiLearnSession,
  detectRelativeEncoding,
  type MidiLearnState,
  type MidiMessage,
} from '../src';
import { cc, ev, noteOff, noteOn } from './helpers';

const CUTOFF: MappingTarget = {
  kind: 'parameter',
  address: { scope: 'selectedInstrument', param: 'cutoffHz' },
};
const TOGGLE_PLAY: MappingTarget = { kind: 'action', action: 'transport.togglePlay' };
const RECORD: MappingTarget = { kind: 'action', action: 'transport.record' };

function setup(options: { timeoutMs?: number } = {}) {
  let time = 1000;
  const session = createMidiLearnSession({ now: () => time, ...options });
  const states: MidiLearnState[] = [];
  const unsubscribe = session.subscribe((s) => states.push(s));
  return {
    session,
    states,
    unsubscribe,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const captured = (state: MidiLearnState) => {
  if (state.phase !== 'captured') throw new Error(`expected captured, got ${state.phase}`);
  return state.mapping;
};

describe('MIDI learn', () => {
  it('starts idle and ignores events while idle', () => {
    const { session } = setup();
    expect(session.getState()).toEqual({ phase: 'idle' });
    expect(session.handle(ev(cc(1, 1)))).toEqual({ phase: 'idle' });
  });

  it('captures an absolute CC with pickup takeover and a port-name selector', () => {
    const { session, states } = setup();
    expect(session.start(CUTOFF)).toEqual({
      phase: 'listening',
      target: CUTOFF,
      startedAtMs: 1000,
    });
    const mapping = captured(session.handle(ev(cc(74, 30, 2))));
    expect(mapping).toEqual({
      source: { kind: 'cc', channel: 2, controller: 74, mode: 'absolute' },
      device: { portName: 'Test Keys' },
      target: CUTOFF,
      transform: { ...DEFAULT_VALUE_TRANSFORM, takeover: 'pickup' },
      scope: 'project',
      enabled: true,
      label: 'Test Keys: CC 74 ch 2',
    });
    expect(states.map((s) => s.phase)).toEqual(['listening', 'captured']);
  });

  it('uses the profile id when the event has one and names the identified control', () => {
    const { session } = setup();
    session.start(CUTOFF);
    const event = ev(cc(70, 5), {
      profileId: 'akai.mpk-mini-mk3',
      control: { controlId: 'knob.K1', value: 5 / 127, message: cc(70, 5) },
    });
    const mapping = captured(session.handle(event));
    expect(mapping.device).toEqual({ profileId: 'akai.mpk-mini-mk3' });
    expect(mapping.label).toBe('Test Keys: knob.K1 · CC 70 ch 1');
  });

  it('absolute CC to an action target keeps immediate takeover', () => {
    const { session } = setup();
    session.start(RECORD);
    expect(captured(session.handle(ev(cc(20, 127)))).transform.takeover).toBe('immediate');
  });

  it.each<[string, MidiMessage]>([
    ['clock', { type: 'clock' }],
    ['active sensing', { type: 'activeSensing' }],
    ['start', { type: 'start' }],
    ['song position', { type: 'songPosition', sixteenths: 4 }],
    ['sysex', { type: 'sysex', bytes: Uint8Array.of(0xf0, 0xf7) }],
    ['note off', noteOff(60)],
    ['channel aftertouch', { type: 'channelPressure', channel: 1, pressure: 50 }],
    ['poly aftertouch', { type: 'polyPressure', channel: 1, note: 60, pressure: 50 }],
    ['pitch bend near centre', { type: 'pitchBend', channel: 1, value: 300 }],
  ])('ignores %s', (_name, message) => {
    const { session } = setup();
    session.start(CUTOFF);
    expect(session.handle(ev(message)).phase).toBe('listening');
  });

  it('captures notes: toggle for toggle actions, trigger otherwise', () => {
    const a = setup();
    a.session.start(TOGGLE_PLAY);
    const toggle = captured(a.session.handle(ev(noteOn(36, 90, 10))));
    expect(toggle.source).toEqual({ kind: 'note', channel: 10, note: 36, behavior: 'toggle' });
    expect(toggle.transform).toEqual(DEFAULT_VALUE_TRANSFORM);
    expect(toggle.label).toBe('Test Keys: Note 36 ch 10');

    const b = setup();
    b.session.start(RECORD);
    expect(captured(b.session.handle(ev(noteOn(40)))).source).toMatchObject({
      behavior: 'trigger',
    });
    const c = setup();
    c.session.start(CUTOFF);
    expect(captured(c.session.handle(ev(noteOn(40)))).source).toMatchObject({
      behavior: 'trigger',
    });
  });

  it('captures pitch bend once moved away from centre', () => {
    const { session } = setup();
    session.start(CUTOFF);
    const mapping = captured(session.handle(ev({ type: 'pitchBend', channel: 3, value: -4000 })));
    expect(mapping.source).toEqual({ kind: 'pitchBend', channel: 3 });
    expect(mapping.transform.takeover).toBe('immediate');
    expect(mapping.label).toBe('Test Keys: Pitch Bend ch 3');
  });

  it('captures program changes (e.g. pads in PROG CHANGE mode)', () => {
    const { session } = setup();
    session.start(RECORD);
    const mapping = captured(
      session.handle(ev({ type: 'programChange', channel: 10, program: 4 })),
    );
    expect(mapping.source).toEqual({ kind: 'programChange', channel: 10, program: 4 });
    expect(mapping.label).toBe('Test Keys: Program 4 ch 10');
  });

  it('times out back to idle (via handle, getState or checkTimeout)', () => {
    const t1 = setup({ timeoutMs: 500 });
    t1.session.start(CUTOFF);
    t1.advance(499);
    expect(t1.session.checkTimeout().phase).toBe('listening');
    t1.advance(1);
    expect(t1.session.handle(ev(cc(1, 1)))).toEqual({ phase: 'idle' });
    expect(t1.states.map((s) => s.phase)).toEqual(['listening', 'idle']);

    const t2 = setup({ timeoutMs: 500 });
    t2.session.start(CUTOFF);
    t2.advance(600);
    expect(t2.session.getState()).toEqual({ phase: 'idle' });

    const never = setup({ timeoutMs: 0 });
    never.session.start(CUTOFF);
    never.advance(1e9);
    expect(never.session.getState().phase).toBe('listening');
  });

  it('cancel returns to idle and notifies once', () => {
    const { session, states, unsubscribe } = setup();
    session.start(CUTOFF);
    expect(session.cancel()).toEqual({ phase: 'idle' });
    expect(session.cancel()).toEqual({ phase: 'idle' });
    expect(states.map((s) => s.phase)).toEqual(['listening', 'idle']);
    unsubscribe();
    session.start(CUTOFF);
    expect(states).toHaveLength(2);
  });

  it('upgrades a CC capture to twosComplement when values repeat around 1/127', () => {
    const { session, states, advance } = setup();
    session.start(CUTOFF);
    session.handle(ev(cc(70, 1)));
    advance(50);
    session.handle(ev(cc(70, 1)));
    advance(50);
    const mapping = captured(session.handle(ev(cc(70, 1))));
    expect(mapping.source).toEqual({
      kind: 'cc',
      channel: 1,
      controller: 70,
      mode: 'twosComplement',
    });
    expect(mapping.transform.takeover).toBe('immediate');
    expect(mapping.label).toBe('Test Keys: CC 70 ch 1 (relative, twosComplement)');
    expect(states.map((s) => s.phase)).toEqual(['listening', 'captured', 'captured']);
    // Further identical values do not re-notify.
    session.handle(ev(cc(70, 127)));
    expect(states).toHaveLength(3);
  });

  it('upgrades to binaryOffset when values repeat around 63/65', () => {
    const { session } = setup();
    session.start(CUTOFF);
    session.handle(ev(cc(71, 65)));
    session.handle(ev(cc(71, 65)));
    expect(captured(session.handle(ev(cc(71, 66)))).source).toMatchObject({ mode: 'binaryOffset' });
  });

  it('keeps absolute for monotonic knob values and after the detection window', () => {
    const a = setup();
    a.session.start(CUTOFF);
    a.session.handle(ev(cc(70, 1)));
    a.session.handle(ev(cc(70, 2)));
    expect(captured(a.session.handle(ev(cc(70, 3)))).source).toMatchObject({ mode: 'absolute' });

    const b = setup();
    b.session.start(CUTOFF);
    b.session.handle(ev(cc(70, 1)));
    b.advance(700);
    b.session.handle(ev(cc(70, 1)));
    b.session.handle(ev(cc(70, 1)));
    expect(captured(b.session.getState()).source).toMatchObject({ mode: 'absolute' });
  });

  it('ignores other controllers/ports while refining and never times out once captured', () => {
    const { session, advance } = setup({ timeoutMs: 100 });
    session.start(CUTOFF);
    session.handle(ev(cc(70, 1)));
    session.handle(ev(cc(71, 1)));
    session.handle(ev(cc(70, 1), { portId: 'other' }));
    session.handle(ev(noteOn(1)));
    advance(1000);
    expect(captured(session.getState()).source).toMatchObject({ controller: 70, mode: 'absolute' });
  });

  it('detectRelativeEncoding needs repeats and a cluster', () => {
    expect(detectRelativeEncoding([1, 1])).toBeNull();
    expect(detectRelativeEncoding([1, 2, 3])).toBeNull();
    expect(detectRelativeEncoding([127, 127, 126])).toBe('twosComplement');
    expect(detectRelativeEncoding([63, 63, 63])).toBe('binaryOffset');
    expect(detectRelativeEncoding([40, 40, 40])).toBeNull();
  });

  it('supports a configurable scope', () => {
    const session = createMidiLearnSession({ now: () => 0, scope: 'global' });
    session.start(CUTOFF);
    expect(captured(session.handle(ev(cc(1, 1)))).scope).toBe('global');
  });

  it('labels by port id when the port has no name', () => {
    const session = createMidiLearnSession({ now: () => 0 });
    session.start(CUTOFF);
    expect(captured(session.handle(ev(cc(1, 1), { portName: '' }))).label).toBe('in-1: CC 1 ch 1');
  });
});
