import { describe, expect, it } from 'vitest';
import type { MidiMessage } from '@studio/midi-core';
import {
  controlIdsForLayoutElement,
  isMpkMiniMk3Port,
  matchMpkMiniMk3PortName,
  MPK_MINI_MK3_ALIAS_MATCH_SCORE,
  MPK_MINI_MK3_CAPABILITIES,
  MPK_MINI_MK3_CONTROLS,
  MPK_MINI_MK3_EXACT_MATCH_SCORE,
  MPK_MINI_MK3_KEY_LEGENDS,
  MPK_MINI_MK3_LAYOUT,
  MPK_MINI_MK3_PANEL_LEGENDS,
  mpkMiniMk3Profile,
  mpkPadControlId,
} from '../src';

const control = (id: string) => {
  const c = MPK_MINI_MK3_CONTROLS.find((x) => x.id === id);
  if (!c) throw new Error(`missing control ${id}`);
  return c;
};

describe('port matching', () => {
  it.each([
    'MPK mini 3',
    'MPK mini 3 MIDI 1',
    'MPK mini 3 MIDI 2',
    'mpk mini 3',
    'MPK  Mini   3',
    'MPKmini3',
    'MPK_mini_3',
    'MPK-mini-3 Port 1',
    '2- MPK mini 3',
    'MPK mini 3:MPK mini 3 MIDI 1 24:0',
  ])('matches %j with the exact score', (name) => {
    expect(matchMpkMiniMk3PortName(name)).toBe(MPK_MINI_MK3_EXACT_MATCH_SCORE);
    expect(isMpkMiniMk3Port({ name })).toBe(true);
  });

  it.each(['MPK mini mk3', 'MPK Mini MKIII', 'MPK mini III', 'MPK Mini MK 3'])(
    'matches marketing alias %j with a lower score',
    (name) => {
      expect(matchMpkMiniMk3PortName(name)).toBe(MPK_MINI_MK3_ALIAS_MATCH_SCORE);
    },
  );

  it.each([
    'MPK mini Plus',
    'MPK mini Plus MIDI 1',
    'MPK mini Play',
    'MPK mini Play mk3',
    'MPK Mini Play MK3 MIDI 1',
    'Play mk3',
    'MPK Mini Mk II',
    'MPK mini mk2',
    'MPKmini2',
    'MPK mini IV',
    'MPK mini 4',
    'MPK mini',
    'MPK mini 30',
    'MPK225',
    'MPK249',
    'Launchkey Mini MK3',
    'Midi Through Port-0',
    '',
  ])('rejects %j', (name) => {
    expect(matchMpkMiniMk3PortName(name)).toBe(0);
    expect(isMpkMiniMk3Port({ name })).toBe(false);
  });

  it('profile.matchPort uses the port name', () => {
    expect(
      mpkMiniMk3Profile.matchPort({
        id: 'x',
        name: 'MPK mini 3',
        type: 'input',
        state: 'connected',
      }),
    ).toBe(100);
  });
});

describe('controls', () => {
  it('has the dossier inventory: 25 keys, 16 pad assignments, 8 knobs, 2 axes, pedal, 10 buttons', () => {
    const count = (kind: string) => MPK_MINI_MK3_CONTROLS.filter((c) => c.kind === kind).length;
    expect(count('key')).toBe(25);
    expect(count('pad')).toBe(16);
    expect(count('knob')).toBe(8);
    expect(count('joystickX')).toBe(1);
    expect(count('joystickY')).toBe(1);
    expect(count('pedal')).toBe(1);
    expect(count('button')).toBe(10);
    expect(MPK_MINI_MK3_CONTROLS.map((c) => c.label)).not.toContain('SHIFT');
  });

  it('every control has verification metadata and a note; none claims hardware verification', () => {
    for (const c of MPK_MINI_MK3_CONTROLS) {
      expect(c.verification).not.toBe('verified-hardware');
      expect(c.note?.length ?? 0).toBeGreaterThan(20);
    }
  });

  it('knobs send CC 70–77 absolute, classified as documented', () => {
    for (let i = 0; i < 8; i++) {
      const knob = control(`knob.K${i + 1}`);
      expect(knob.defaultSource).toEqual({
        kind: 'cc',
        channel: 'any',
        controller: 70 + i,
        mode: 'absolute',
      });
      expect(knob.verification).toBe('documented');
      expect(knob.note).toMatch(/third-party vendor/);
    }
  });

  it('pads send notes 36–43 / 44–51 on channel 10, community-sourced', () => {
    for (let i = 0; i < 8; i++) {
      expect(control(mpkPadControlId('A', i + 1)).defaultSource).toEqual({
        kind: 'note',
        channel: 10,
        note: 36 + i,
        behavior: 'gate',
      });
      expect(control(mpkPadControlId('B', i + 1)).defaultSource).toEqual({
        kind: 'note',
        channel: 10,
        note: 44 + i,
        behavior: 'gate',
      });
      expect(control(mpkPadControlId('B', i + 1)).verification).toBe('community');
    }
  });

  it('keys are on channel 1 (unverified), joystick X = pitch bend, Y = CC1, sustain CC64 unverified', () => {
    expect(control('key.0').defaultSource).toEqual({
      kind: 'note',
      channel: 1,
      note: 48,
      behavior: 'gate',
    });
    expect(control('key.0').label).toBe('Key 1 (C3)');
    expect(control('key.24').defaultSource).toMatchObject({ note: 72 });
    expect(control('key.0').verification).toBe('unverified');
    expect(control('joystick.x').defaultSource).toEqual({ kind: 'pitchBend', channel: 'any' });
    expect(control('joystick.y').defaultSource).toEqual({
      kind: 'cc',
      channel: 'any',
      controller: 1,
      mode: 'absolute',
    });
    expect(control('pedal.sustain').defaultSource).toMatchObject({ controller: 64 });
    expect(control('pedal.sustain').verification).toBe('unverified');
  });

  it('buttons send nothing by default and say so', () => {
    const buttons = MPK_MINI_MK3_CONTROLS.filter((c) => c.kind === 'button');
    expect(buttons.map((b) => b.label)).toEqual([
      'ARPEGGIATOR ON/OFF',
      'TAP TEMPO',
      'OCT -',
      'OCT +',
      'FULL LEVEL',
      'NOTE REPEAT',
      'BANK A/B',
      'CC',
      'PROG CHANGE',
      'PROG SELECT',
    ]);
    for (const b of buttons) {
      expect(b.defaultSource).toBeUndefined();
      expect(b.note).toMatch(/internally/);
    }
  });
});

describe('identify', () => {
  const id = (message: MidiMessage) => mpkMiniMk3Profile.identify(message);

  it('identifies keys and pads with press/release values', () => {
    expect(id({ type: 'noteOn', channel: 1, note: 60, velocity: 90 })).toMatchObject({
      controlId: 'key.12',
      value: 1,
    });
    expect(id({ type: 'noteOff', channel: 1, note: 48, velocity: 0 })).toMatchObject({
      controlId: 'key.0',
      value: 0,
    });
    expect(id({ type: 'noteOn', channel: 10, note: 36, velocity: 127 })).toMatchObject({
      controlId: 'pad.A1',
      value: 1,
    });
    expect(id({ type: 'noteOn', channel: 10, note: 51, velocity: 1 })).toMatchObject({
      controlId: 'pad.B8',
    });
    expect(id({ type: 'noteOff', channel: 10, note: 44, velocity: 0 })).toMatchObject({
      controlId: 'pad.B1',
      value: 0,
    });
  });

  it('identifies every knob, the joystick axes and the pedal', () => {
    for (let i = 0; i < 8; i++) {
      expect(
        id({ type: 'controlChange', channel: 1, controller: 70 + i, value: 127 }),
      ).toMatchObject({ controlId: `knob.K${i + 1}`, value: 1 });
    }
    expect(id({ type: 'controlChange', channel: 3, controller: 74, value: 0 })).toMatchObject({
      controlId: 'knob.K5',
      value: 0,
    });
    expect(id({ type: 'pitchBend', channel: 1, value: -8192 })).toMatchObject({
      controlId: 'joystick.x',
      value: 0,
    });
    expect(id({ type: 'pitchBend', channel: 1, value: 8191 })?.value).toBe(1);
    expect(id({ type: 'controlChange', channel: 1, controller: 1, value: 64 })?.value).toBeCloseTo(
      64 / 127,
    );
    expect(id({ type: 'controlChange', channel: 1, controller: 64, value: 127 })).toMatchObject({
      controlId: 'pedal.sustain',
      value: 1,
    });
    expect(id({ type: 'controlChange', channel: 1, controller: 64, value: 0 })?.value).toBe(0);
  });

  it('returns null for anything outside the default program', () => {
    expect(id({ type: 'noteOn', channel: 1, note: 47, velocity: 1 })).toBeNull(); // octave-shifted
    expect(id({ type: 'noteOn', channel: 1, note: 36, velocity: 1 })).toBeNull(); // pad note on keys channel
    expect(id({ type: 'noteOn', channel: 10, note: 60, velocity: 1 })).toBeNull();
    expect(id({ type: 'controlChange', channel: 10, controller: 16, value: 127 })).toBeNull(); // pad CC mode
    expect(id({ type: 'programChange', channel: 10, program: 1 })).toBeNull();
    expect(id({ type: 'clock' })).toBeNull();
  });

  it('keeps the original message', () => {
    const message: MidiMessage = { type: 'controlChange', channel: 1, controller: 70, value: 5 };
    expect(id(message)?.message).toBe(message);
  });
});

describe('default mappings', () => {
  it('maps K1–K8 to track gain/pan and instrument params with pickup takeover', () => {
    const mappings = mpkMiniMk3Profile.defaultMappings();
    expect(mappings.map((m) => [m.source, m.target])).toEqual([
      [
        { kind: 'cc', channel: 'any', controller: 70, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedTrack', param: 'gainDb' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 71, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedTrack', param: 'pan' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 72, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'cutoffHz' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 73, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'resonance' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 74, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'attack' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 75, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'release' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 76, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'filterEnvAmount' } },
      ],
      [
        { kind: 'cc', channel: 'any', controller: 77, mode: 'absolute' },
        { kind: 'parameter', address: { scope: 'selectedInstrument', param: 'osc2Mix' } },
      ],
    ]);
    for (const [i, m] of mappings.entries()) {
      expect(m.transform.takeover).toBe('pickup');
      expect(m.device).toEqual({ profileId: 'akai.mpk-mini-mk3' });
      expect(m.scope).toBe('global');
      expect(m.label).toMatch(new RegExp(`^MPK Mini MK3 K${i + 1} → `));
    }
  });

  it('does not map keys, pads or the joystick', () => {
    const sources = mpkMiniMk3Profile.defaultMappings().map((m) => m.source);
    expect(sources.every((s) => s.kind === 'cc')).toBe(true);
    expect(sources.some((s) => s.kind === 'cc' && s.controller === 1)).toBe(false);
  });
});

describe('layout', () => {
  it('is an original model with the dossier reference and no brand elements', () => {
    expect(MPK_MINI_MK3_LAYOUT.aspectRatio).toBeCloseTo(1.753, 3);
    expect(MPK_MINI_MK3_LAYOUT.referenceNote).toMatch(/docs\/midi-device-research\.md/);
    const legends = MPK_MINI_MK3_LAYOUT.elements
      .flatMap((e) => [e.legend, e.secondaryLegend])
      .join(' ');
    expect(legends).not.toMatch(/AKAI|MPK/i);
  });

  it('contains 25 keys (15 white, 10 black), 8 pads, 8 knobs, 10 buttons, joystick and display', () => {
    const count = (shape: string) =>
      MPK_MINI_MK3_LAYOUT.elements.filter((e) => e.shape === shape).length;
    expect(count('key-white')).toBe(15);
    expect(count('key-black')).toBe(10);
    expect(count('pad')).toBe(8);
    expect(count('knob')).toBe(8);
    expect(count('button')).toBe(10);
    expect(count('joystick')).toBe(1);
    expect(count('display')).toBe(1);
    const ids = MPK_MINI_MK3_LAYOUT.elements.map((e) => e.controlId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places pads 5–8 above pads 1–4 and K1–K4 above K5–K8, keys left to right', () => {
    const rect = (id: string) => MPK_MINI_MK3_LAYOUT.elements.find((e) => e.controlId === id)!.rect;
    expect(rect('pad.5').y).toBeLessThan(rect('pad.1').y);
    expect(rect('pad.1').x).toBeLessThan(rect('pad.2').x);
    expect(rect('knob.K1').y).toBeLessThan(rect('knob.K5').y);
    for (let i = 1; i < 25; i++) expect(rect(`key.${i}`).x).toBeGreaterThan(rect(`key.${i - 1}`).x);
    expect(MPK_MINI_MK3_KEY_LEGENDS).toHaveLength(25);
  });

  it('round controls are square in physical units', () => {
    for (const e of MPK_MINI_MK3_LAYOUT.elements) {
      if (e.shape !== 'knob' && e.shape !== 'pad' && e.shape !== 'joystick') continue;
      expect(e.rect.h).toBeCloseTo(e.rect.w * MPK_MINI_MK3_LAYOUT.aspectRatio, 3);
    }
  });

  it('maps group elements to controls', () => {
    expect(controlIdsForLayoutElement('pad.3')).toEqual(['pad.A3', 'pad.B3']);
    expect(controlIdsForLayoutElement('joystick')).toEqual(['joystick.x', 'joystick.y']);
    expect(controlIdsForLayoutElement('display.oled')).toEqual([]);
    expect(controlIdsForLayoutElement('knob.K1')).toEqual(['knob.K1']);
  });

  it('panel legends lie inside the panel', () => {
    for (const legend of MPK_MINI_MK3_PANEL_LEGENDS) {
      expect(legend.rect.x + legend.rect.w).toBeLessThanOrEqual(1);
      expect(legend.rect.y + legend.rect.h).toBeLessThanOrEqual(1);
    }
  });
});

describe('capabilities', () => {
  it('covers the required feature list', () => {
    const ids = MPK_MINI_MK3_CAPABILITIES.map((c) => c.id);
    for (const required of [
      'note-input',
      'velocity',
      'pad-banks',
      'knobs-absolute',
      'knobs-relative',
      'joystick',
      'sustain',
      'program-switching',
      'arpeggiator',
      'note-repeat',
      'clock-out',
      'program-read-write',
      'oled',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('is honest about verification and support', () => {
    const cap = (id: string) => MPK_MINI_MK3_CAPABILITIES.find((c) => c.id === id)!;
    expect(MPK_MINI_MK3_CAPABILITIES.every((c) => c.verification !== 'verified-hardware')).toBe(
      true,
    );
    expect(cap('program-read-write').support).toBe('unsupported');
    expect(cap('program-read-write').note).toMatch(/SysEx/);
    expect(cap('clock-out')).toMatchObject({ support: 'experimental', verification: 'unverified' });
    expect(cap('arpeggiator').note).toMatch(/External/);
    expect(cap('oled').support).toBe('unsupported');
    expect(cap('sustain').verification).toBe('unverified');
    expect(cap('knobs-relative').verification).toBe('unverified');
    expect(mpkMiniMk3Profile.capabilities).toBe(MPK_MINI_MK3_CAPABILITIES);
  });
});

describe('profile', () => {
  it('has the frozen identity', () => {
    expect(mpkMiniMk3Profile.id).toBe('akai.mpk-mini-mk3');
    expect(mpkMiniMk3Profile.displayName).toBe('AKAI Professional MPK Mini MK3');
    expect(mpkMiniMk3Profile.manufacturer).toBe('AKAI Professional');
    expect(mpkMiniMk3Profile.layout).toBe(MPK_MINI_MK3_LAYOUT);
  });
});
