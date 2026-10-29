import { asMappingId, asTrackId, createEmptyProject, createMidiMapping, asProjectId, type MidiMapping } from '@studio/domain';
import { MPK_MINI_MK3_CONTROLS, MPK_MINI_MK3_PROFILE_ID } from '@studio/midi-akai-mpk-mini-mk3';
import { describe, expect, it } from 'vitest';
import {
  conflictingMappingIds,
  describeSource,
  mappingsForControl,
  targetKey,
  targetOptions,
} from '../src/features/midi-controller/mapping-helpers';

const cc = (controller: number, id: string, enabled = true): MidiMapping => ({
  ...createMidiMapping({
    id: asMappingId(id),
    source: { kind: 'cc', channel: 'any', controller, mode: 'absolute' },
    device: { profileId: MPK_MINI_MK3_PROFILE_ID },
    target: { kind: 'parameter', address: { scope: 'master', param: 'gainDb' } },
  }),
  enabled,
});

describe('mapping helpers', () => {
  it('describes sources in plain language', () => {
    expect(describeSource({ kind: 'cc', channel: 'any', controller: 70, mode: 'absolute' })).toBe('CC 70 · any ch');
    expect(describeSource({ kind: 'note', channel: 10, note: 36, behavior: 'trigger' })).toBe('Note 36 · ch 10 · trigger');
    expect(describeSource({ kind: 'cc', channel: 1, controller: 20, mode: 'twosComplement' })).toContain('relative');
  });

  it('flags enabled mappings that share a control', () => {
    const ids = conflictingMappingIds([cc(70, 'a'), cc(70, 'b'), cc(71, 'c'), cc(70, 'd', false)]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('finds mappings for a physical control by its default message', () => {
    const k1 = MPK_MINI_MK3_CONTROLS.find((c) => c.id === 'knob.K1')!;
    const found = mappingsForControl([cc(70, 'a'), cc(71, 'b')], k1, MPK_MINI_MK3_PROFILE_ID);
    expect(found.map((m) => m.id)).toEqual(['a']);
  });

  it('offers selection-following, track and action targets with stable keys', () => {
    const base = createEmptyProject({ id: asProjectId('p'), now: '2026-01-01T00:00:00.000Z' });
    const trackId = asTrackId('t1');
    const project = { ...base, trackOrder: [trackId], tracks: { [trackId]: { id: trackId, kind: 'audio' as const, name: 'Vox', color: '#8B7CF6', mixer: { gainDb: 0, pan: 0, mute: false, solo: false }, armed: false, monitor: 'off' as const, effects: [] } } };
    const options = targetOptions(project);
    const keys = options.map((o) => o.key);
    expect(keys).toContain('sel:gain');
    expect(keys).toContain('track:t1:pan');
    expect(keys).toContain('action:transport.togglePlay');
    for (const option of options) expect(targetKey(option.target)).toBe(option.key);
  });
});
