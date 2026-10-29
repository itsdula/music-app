import { describe, expect, it } from 'vitest';
import {
  asMappingId,
  asTrackId,
  createMidiMapping,
  type CreateMappingInput,
  type MidiMapping,
  type ParameterAddress,
} from '@studio/domain';
import {
  decodeRelative,
  isToggleAction,
  MappingEngine,
  matchesDevice,
  shouldInvokeAction,
  type MappingEffect,
  type ParameterValueReader,
} from '../src';
import { cc, ev, noteOff, noteOn } from './helpers';

const CUTOFF: ParameterAddress = { scope: 'selectedInstrument', param: 'cutoffHz' };
const GAIN: ParameterAddress = { scope: 'selectedTrack', param: 'gainDb' };

class Params implements ParameterValueReader {
  private readonly values = new Map<string, number>();
  set(address: ParameterAddress, value: number): void {
    this.values.set(JSON.stringify(address), value);
  }
  getNormalized(address: ParameterAddress): number | undefined {
    return this.values.get(JSON.stringify(address));
  }
  apply(effects: MappingEffect[]): void {
    for (const e of effects) if (e.kind === 'setParameter') this.set(e.address, e.normalized);
  }
}

let nextId = 0;
function mapping(input: Omit<CreateMappingInput, 'id'> & { enabled?: boolean }): MidiMapping {
  const m = createMidiMapping({ id: asMappingId(`m${nextId++}`), ...input });
  return input.enabled === false ? { ...m, enabled: false } : m;
}

function engineWith(...mappings: MidiMapping[]): MappingEngine {
  const engine = new MappingEngine();
  engine.setMappings(mappings);
  return engine;
}

const values = (effects: MappingEffect[]): number[] =>
  effects.map((e) => (e.kind === 'setParameter' ? e.normalized : e.value));

describe('MappingEngine — absolute CC', () => {
  const knob = mapping({
    source: { kind: 'cc', channel: 1, controller: 74, mode: 'absolute' },
    target: { kind: 'parameter', address: CUTOFF },
  });

  it('maps 0..127 to 0..1 and reports the mapping id and address', () => {
    const engine = engineWith(knob);
    const params = new Params();
    expect(engine.process(ev(cc(74, 0)), params)).toEqual([
      { kind: 'setParameter', mappingId: knob.id, address: CUTOFF, normalized: 0 },
    ]);
    expect(values(engine.process(ev(cc(74, 127)), params))).toEqual([1]);
    expect(values(engine.process(ev(cc(74, 64)), params))[0]).toBeCloseTo(64 / 127);
  });

  it('applies range, invert and curve', () => {
    const shaped = mapping({
      source: { kind: 'cc', channel: 1, controller: 74, mode: 'absolute' },
      target: { kind: 'parameter', address: CUTOFF },
      transform: { min: 0.25, max: 0.75, invert: true, curve: 'exponential' },
    });
    const engine = engineWith(shaped);
    const params = new Params();
    expect(values(engine.process(ev(cc(74, 0)), params))[0]).toBeCloseTo(0.75);
    expect(values(engine.process(ev(cc(74, 127)), params))[0]).toBeCloseTo(0.25);
    const mid = values(engine.process(ev(cc(74, 64)), params))[0]!;
    expect(mid).toBeGreaterThan(0.5); // exponential is below linear, inverted → above
  });

  it('ignores other controllers and channels', () => {
    const engine = engineWith(knob);
    const params = new Params();
    expect(engine.process(ev(cc(75, 10)), params)).toEqual([]);
    expect(engine.process(ev(cc(74, 10, 2)), params)).toEqual([]);
    expect(engine.process(ev(noteOn(74)), params)).toEqual([]);
  });

  it('channel "any" accepts every channel', () => {
    const any = mapping({
      source: { kind: 'cc', channel: 'any', controller: 1, mode: 'absolute' },
      target: { kind: 'parameter', address: CUTOFF },
    });
    const engine = engineWith(any);
    expect(engine.process(ev(cc(1, 5, 16)), new Params())).toHaveLength(1);
  });

  it('skips disabled mappings and supports several mappings per control', () => {
    const disabled = mapping({
      source: { kind: 'cc', channel: 1, controller: 74, mode: 'absolute' },
      target: { kind: 'parameter', address: GAIN },
      enabled: false,
    });
    const second = mapping({
      source: { kind: 'cc', channel: 1, controller: 74, mode: 'absolute' },
      target: { kind: 'parameter', address: GAIN },
    });
    const engine = engineWith(knob, disabled, second);
    expect(engine.process(ev(cc(74, 1)), new Params()).map((e) => e.mappingId)).toEqual([
      knob.id,
      second.id,
    ]);
    expect(engine.getMappings()).toHaveLength(3);
  });
});

describe('MappingEngine — device filtering', () => {
  const byProfile = mapping({
    source: { kind: 'cc', channel: 'any', controller: 70, mode: 'absolute' },
    target: { kind: 'parameter', address: GAIN },
    device: { profileId: 'akai.mpk-mini-mk3' },
  });
  const byPort = mapping({
    source: { kind: 'cc', channel: 'any', controller: 70, mode: 'absolute' },
    target: { kind: 'parameter', address: CUTOFF },
    device: { portName: 'Other Synth' },
  });

  it('matches profile id or exact port name; null and {} match any device', () => {
    const engine = engineWith(byProfile, byPort);
    const params = new Params();
    const mpk = engine.process(ev(cc(70, 1), { profileId: 'akai.mpk-mini-mk3' }), params);
    expect(mpk.map((e) => e.mappingId)).toEqual([byProfile.id]);
    const other = engine.process(ev(cc(70, 1), { portName: 'Other Synth' }), params);
    expect(other.map((e) => e.mappingId)).toEqual([byPort.id]);
    expect(engine.process(ev(cc(70, 1), { portName: 'Other Synth 2' }), params)).toEqual([]);
    expect(matchesDevice(null, ev(cc(1, 1)))).toBe(true);
    expect(matchesDevice({}, ev(cc(1, 1)))).toBe(true);
    expect(matchesDevice({ profileId: 'x' }, ev(cc(1, 1)))).toBe(false);
  });
});

describe('MappingEngine — pickup takeover', () => {
  const knob = mapping({
    source: { kind: 'cc', channel: 1, controller: 70, mode: 'absolute' },
    target: { kind: 'parameter', address: GAIN },
    transform: { takeover: 'pickup' },
  });

  it('ignores input until it crosses the current value from below, then follows', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 0.5);
    expect(engine.process(ev(cc(70, 10)), params)).toEqual([]);
    expect(engine.process(ev(cc(70, 40)), params)).toEqual([]);
    const crossing = engine.process(ev(cc(70, 70)), params);
    expect(values(crossing)[0]).toBeCloseTo(70 / 127);
    params.apply(crossing);
    const follow = engine.process(ev(cc(70, 72)), params);
    expect(values(follow)[0]).toBeCloseTo(72 / 127);
  });

  it('picks up when crossing from above', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 0.5);
    expect(engine.process(ev(cc(70, 120)), params)).toEqual([]);
    expect(values(engine.process(ev(cc(70, 30)), params))[0]).toBeCloseTo(30 / 127);
  });

  it('picks up when the first value is within one step of the parameter', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 64 / 127);
    expect(engine.process(ev(cc(70, 65)), params)).toHaveLength(1);
  });

  it('re-arms when the parameter is changed elsewhere', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 0);
    params.apply(engine.process(ev(cc(70, 0)), params));
    params.apply(engine.process(ev(cc(70, 5)), params));
    params.set(GAIN, 0.9); // UI moved it
    expect(engine.process(ev(cc(70, 6)), params)).toEqual([]);
    expect(engine.process(ev(cc(70, 127)), params)).toHaveLength(1);
  });

  it('resetTakeover re-arms pickup (all or one mapping)', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 0.5);
    params.apply(engine.process(ev(cc(70, 64)), params));
    engine.resetTakeover('other-id');
    expect(engine.process(ev(cc(70, 66)), params)).toHaveLength(1);
    params.set(GAIN, 66 / 127);
    engine.resetTakeover();
    params.set(GAIN, 0.1);
    expect(engine.process(ev(cc(70, 100)), params)).toEqual([]);
    engine.resetTakeover(knob.id);
    expect(engine.process(ev(cc(70, 99)), params)).toEqual([]);
  });

  it('follows immediately when the parameter value is unknown', () => {
    const engine = engineWith(knob);
    expect(engine.process(ev(cc(70, 99)), new Params())).toHaveLength(1);
  });

  it('immediate takeover always follows', () => {
    const immediate = mapping({
      source: { kind: 'cc', channel: 1, controller: 70, mode: 'absolute' },
      target: { kind: 'parameter', address: GAIN },
    });
    const engine = engineWith(immediate);
    const params = new Params();
    params.set(GAIN, 0.5);
    expect(engine.process(ev(cc(70, 0)), params)).toHaveLength(1);
  });

  it('keeps takeover state across setMappings for unchanged mappings only', () => {
    const engine = engineWith(knob);
    const params = new Params();
    params.set(GAIN, 0.5);
    params.apply(engine.process(ev(cc(70, 64)), params));
    engine.setMappings([knob]);
    expect(engine.process(ev(cc(70, 65)), params)).toHaveLength(1);
    params.apply(engine.process(ev(cc(70, 65)), params));
    engine.setMappings([{ ...knob, source: { ...knob.source, channel: 'any' } }]);
    params.set(GAIN, 0.1);
    expect(engine.process(ev(cc(70, 100)), params)).toEqual([]);
    engine.resetAll();
    expect(engine.process(ev(cc(70, 99)), params)).toEqual([]);
  });
});

describe('MappingEngine — relative encoders', () => {
  it.each([
    ['twosComplement', 1, 1],
    ['twosComplement', 3, 3],
    ['twosComplement', 127, -1],
    ['twosComplement', 65, -63],
    ['signedBit', 1, 1],
    ['signedBit', 65, -1],
    ['signedBit', 67, -3],
    ['binaryOffset', 65, 1],
    ['binaryOffset', 63, -1],
    ['binaryOffset', 64, 0],
  ] as const)('decodes %s value %i as %i steps', (encoding, raw, steps) => {
    expect(decodeRelative(raw, encoding)).toBe(steps);
  });

  const rel = (mode: 'twosComplement' | 'signedBit' | 'binaryOffset', invert = false) =>
    mapping({
      source: { kind: 'cc', channel: 1, controller: 20, mode },
      target: { kind: 'parameter', address: CUTOFF },
      transform: { relativeStep: 0.1, invert, min: 0, max: 1 },
    });

  it.each([
    ['twosComplement', 1, 127],
    ['signedBit', 1, 65],
    ['binaryOffset', 65, 63],
  ] as const)('%s increments and decrements from the current value', (mode, up, down) => {
    const engine = engineWith(rel(mode));
    const params = new Params();
    params.set(CUTOFF, 0.5);
    params.apply(engine.process(ev(cc(20, up)), params));
    expect(params.getNormalized(CUTOFF)).toBeCloseTo(0.6);
    params.apply(engine.process(ev(cc(20, down)), params));
    params.apply(engine.process(ev(cc(20, down)), params));
    expect(params.getNormalized(CUTOFF)).toBeCloseTo(0.4);
  });

  it('clamps to the range, respects invert, ignores zero steps', () => {
    const engine = engineWith(rel('twosComplement', true));
    const params = new Params();
    params.set(CUTOFF, 0.05);
    params.apply(engine.process(ev(cc(20, 1)), params));
    expect(params.getNormalized(CUTOFF)).toBe(0);
    expect(engine.process(ev(cc(20, 0)), params)).toEqual([]);
  });

  it('starts from the range minimum when the value is unknown', () => {
    const engine = engineWith(rel('binaryOffset'));
    expect(values(engine.process(ev(cc(20, 66)), new Params()))[0]).toBeCloseTo(0.2);
  });

  it('relative to an action fires on positive steps only', () => {
    const m = mapping({
      source: { kind: 'cc', channel: 1, controller: 20, mode: 'twosComplement' },
      target: { kind: 'action', action: 'track.selectNext' },
    });
    const engine = engineWith(m);
    expect(values(engine.process(ev(cc(20, 1)), new Params()))).toEqual([1]);
    expect(engine.process(ev(cc(20, 127)), new Params())).toEqual([]);
  });
});

describe('MappingEngine — notes', () => {
  const noteMapping = (behavior: 'trigger' | 'gate' | 'toggle', action = false) =>
    mapping({
      source: { kind: 'note', channel: 10, note: 36, behavior },
      target: action
        ? { kind: 'action', action: 'transport.togglePlay' }
        : { kind: 'parameter', address: { scope: 'selectedTrack', param: 'mute' } },
      transform: { min: 0.2, max: 0.8 },
    });

  it('trigger fires on note-on only (range max)', () => {
    const engine = engineWith(noteMapping('trigger'));
    const p = new Params();
    expect(values(engine.process(ev(noteOn(36, 90, 10)), p))).toEqual([0.8]);
    expect(engine.process(ev(noteOff(36, 10)), p)).toEqual([]);
  });

  it('gate is on while held', () => {
    const engine = engineWith(noteMapping('gate'));
    const p = new Params();
    expect(values(engine.process(ev(noteOn(36, 90, 10)), p))).toEqual([0.8]);
    expect(values(engine.process(ev(noteOff(36, 10)), p))[0]).toBeCloseTo(0.2);
  });

  it('toggle flips per mapping on each note-on', () => {
    const a = noteMapping('toggle');
    const b = noteMapping('toggle');
    const engine = engineWith(a, b);
    const p = new Params();
    expect(values(engine.process(ev(noteOn(36, 90, 10)), p))).toEqual([0.8, 0.8]);
    expect(engine.process(ev(noteOff(36, 10)), p)).toEqual([]);
    const second = values(engine.process(ev(noteOn(36, 90, 10)), p));
    expect(second[0]).toBeCloseTo(0.2);
  });

  it('ignores other notes and channels', () => {
    const engine = engineWith(noteMapping('trigger'));
    expect(engine.process(ev(noteOn(37, 90, 10)), new Params())).toEqual([]);
    expect(engine.process(ev(noteOn(36, 90, 1)), new Params())).toEqual([]);
  });

  it('emits action effects with value 1/0', () => {
    const engine = engineWith(noteMapping('gate', true));
    const p = new Params();
    const press = engine.process(ev(noteOn(36, 90, 10)), p);
    expect(press).toEqual([
      { kind: 'action', mappingId: press[0]?.mappingId, action: 'transport.togglePlay', value: 1 },
    ]);
    expect(values(engine.process(ev(noteOff(36, 10)), p))).toEqual([0]);
    const toggle = engineWith(noteMapping('toggle', true));
    expect(values(toggle.process(ev(noteOn(36, 1, 10)), p))).toEqual([1]);
    expect(values(toggle.process(ev(noteOn(36, 1, 10)), p))).toEqual([0]);
  });
});

describe('MappingEngine — pitch bend, program change, CC → action', () => {
  it('maps pitch bend to 0..1', () => {
    const m = mapping({
      source: { kind: 'pitchBend', channel: 1 },
      target: { kind: 'parameter', address: CUTOFF },
    });
    const engine = engineWith(m);
    const p = new Params();
    expect(values(engine.process(ev({ type: 'pitchBend', channel: 1, value: -8192 }), p))).toEqual([
      0,
    ]);
    expect(values(engine.process(ev({ type: 'pitchBend', channel: 1, value: 8191 }), p))).toEqual([
      1,
    ]);
    expect(
      values(engine.process(ev({ type: 'pitchBend', channel: 1, value: 0 }), p))[0],
    ).toBeCloseTo(0.5, 3);
    expect(engine.process(ev({ type: 'pitchBend', channel: 2, value: 0 }), p)).toEqual([]);
    expect(engine.process(ev(cc(1, 1)), p)).toEqual([]);
  });

  it('program change with a specific program triggers; without maps the program number', () => {
    const specific = mapping({
      source: { kind: 'programChange', channel: 10, program: 3 },
      target: { kind: 'action', action: 'transport.record' },
    });
    const specificParam = mapping({
      source: { kind: 'programChange', channel: 10, program: 3 },
      target: { kind: 'parameter', address: CUTOFF },
    });
    const anyProgram = mapping({
      source: { kind: 'programChange', channel: 'any' },
      target: { kind: 'parameter', address: GAIN },
    });
    const engine = engineWith(specific, specificParam, anyProgram);
    const p = new Params();
    const pc = (program: number, channel = 10) => ev({ type: 'programChange', channel, program });
    expect(values(engine.process(pc(3), p))).toEqual([1, 1, 3 / 127]);
    expect(values(engine.process(pc(127), p))).toEqual([1]);
    expect(engine.process(pc(3, 1), p).map((e) => e.mappingId)).toEqual([anyProgram.id]);
    expect(engine.process(ev(noteOn(3)), p)).toEqual([]);
  });

  it('CC → action emits press/release edges at the half-way point', () => {
    const m = mapping({
      source: { kind: 'cc', channel: 1, controller: 64, mode: 'absolute' },
      target: { kind: 'action', action: 'transport.play' },
    });
    const engine = engineWith(m);
    const p = new Params();
    expect(values(engine.process(ev(cc(64, 127)), p))).toEqual([1]);
    expect(engine.process(ev(cc(64, 100)), p)).toEqual([]);
    expect(values(engine.process(ev(cc(64, 0)), p))).toEqual([0]);
    expect(engine.process(ev(cc(64, 10)), p)).toEqual([]);
  });
});

describe('action helpers', () => {
  it('identifies toggle actions and invocation semantics', () => {
    expect(isToggleAction('transport.togglePlay')).toBe(true);
    expect(isToggleAction('track.toggleMuteSelected')).toBe(true);
    expect(isToggleAction('transport.play')).toBe(false);
    const effect = {
      kind: 'action',
      mappingId: asMappingId('x'),
      action: 'transport.play',
      value: 0,
    } as const;
    expect(shouldInvokeAction(effect)).toBe(false);
    expect(shouldInvokeAction({ ...effect, value: 1 })).toBe(true);
    expect(shouldInvokeAction({ ...effect, action: 'transport.toggleLoop' })).toBe(true);
  });

  it('uses track ids in addresses untouched', () => {
    const address: ParameterAddress = { scope: 'track', trackId: asTrackId('t1'), param: 'pan' };
    const m = mapping({
      source: { kind: 'cc', channel: 1, controller: 10, mode: 'absolute' },
      target: { kind: 'parameter', address },
    });
    const [effect] = engineWith(m).process(ev(cc(10, 127)), new Params());
    expect(effect).toMatchObject({ address });
  });
});
