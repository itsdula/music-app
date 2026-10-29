import fc from 'fast-check';
import { asAssetId, asClipId, asTrackId, type Project } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { diffProjects, type AudioGraphChange } from '../src';
import { asset, audioClip, effect, midiClip, note, project, track } from './fixtures';

function base(): Project {
  return project(
    [track('trk_a'), track('trk_b', 'audio')],
    [
      midiClip('clp_1', 'trk_a', 0, [note('n1', 0, 480)]),
      audioClip('clp_2', 'trk_b', 'ast_1', 0, 4800),
    ],
    [asset('ast_1', 4800)],
  );
}

const types = (changes: AudioGraphChange[]) => changes.map((c) => c.type);

describe('diffProjects', () => {
  it('returns [] for identical roots and for structurally shared copies', () => {
    const p = base();
    expect(diffProjects(p, p)).toEqual([]);
    expect(diffProjects(p, { ...p, name: 'Renamed', updatedAt: 'later' })).toEqual([]);
    // Value-equal settings objects do not produce changes.
    expect(
      diffProjects(p, {
        ...p,
        meter: { ...p.meter },
        loop: { ...p.loop },
        metronome: { ...p.metronome },
        trackOrder: [...p.trackOrder],
      }),
    ).toEqual([]);
  });

  it('emits tempo, meter, loop and metronome changes', () => {
    const p = base();
    const next: Project = {
      ...p,
      bpm: 90,
      meter: { numerator: 3, denominator: 4 },
      loop: { enabled: true, startTick: 0, endTick: 960 },
      metronome: { ...p.metronome, enabled: true },
    };
    expect(diffProjects(p, next)).toEqual([
      { type: 'tempo', bpm: 90 },
      { type: 'meter', meter: next.meter },
      { type: 'loop', loop: next.loop },
      { type: 'metronome', metronome: next.metronome },
    ]);
  });

  it('emits track add/remove/update/order in the documented order', () => {
    const p = base();
    const a = p.tracks[asTrackId('trk_a')]!;
    const updatedA = { ...a, mixer: { ...a.mixer, gainDb: -3 } };
    const c = track('trk_c', 'vocal');
    const next: Project = {
      ...p,
      trackOrder: [c.id, a.id],
      tracks: { [a.id]: updatedA, [c.id]: c },
      clips: { [asClipId('clp_1')]: p.clips[asClipId('clp_1')]! },
    };
    const changes = diffProjects(p, next);
    expect(types(changes)).toEqual([
      'track.remove',
      'track.add',
      'track.update',
      'track.order',
      'clip.remove',
    ]);
    expect(changes[0]).toEqual({ type: 'track.remove', trackId: 'trk_b' });
    expect(changes[1]).toEqual({ type: 'track.add', track: c });
    expect(changes[2]).toEqual({ type: 'track.update', track: updatedA, previous: a });
    expect(changes[3]).toEqual({ type: 'track.order', trackOrder: ['trk_c', 'trk_a'] });
    expect(changes[4]).toEqual({ type: 'clip.remove', clipId: 'clp_2', trackId: 'trk_b' });
  });

  it('emits track.order alone for a pure reorder and nothing when only the reference changed', () => {
    const p = base();
    expect(diffProjects(p, { ...p, trackOrder: [asTrackId('trk_b'), asTrackId('trk_a')] })).toEqual(
      [{ type: 'track.order', trackOrder: ['trk_b', 'trk_a'] }],
    );
    expect(diffProjects(p, { ...p, tracks: { ...p.tracks } })).toEqual([]);
  });

  it('adds tracks in trackOrder, then unordered tracks sorted by id', () => {
    const p = project([]);
    const x = track('trk_x');
    const y = track('trk_y');
    const z = track('trk_z');
    const next = { ...p, trackOrder: [z.id, x.id], tracks: { [x.id]: x, [y.id]: y, [z.id]: z } };
    expect(
      diffProjects(p, next)
        .filter((c) => c.type === 'track.add')
        .map((c) => (c.type === 'track.add' ? c.track.id : '')),
    ).toEqual(['trk_z', 'trk_x', 'trk_y']);
  });

  it('emits clip remove/add/update sorted by clip id', () => {
    const p = base();
    const clip1 = p.clips[asClipId('clp_1')]!;
    const moved = { ...clip1, startTick: 960 };
    const added = [midiClip('clp_9', 'trk_a', 0, []), midiClip('clp_5', 'trk_a', 0, [])];
    const next: Project = {
      ...p,
      clips: { [moved.id]: moved, [added[0]!.id]: added[0]!, [added[1]!.id]: added[1]! },
    };
    expect(diffProjects(p, next)).toEqual([
      { type: 'clip.remove', clipId: 'clp_2', trackId: 'trk_b' },
      { type: 'clip.add', clip: added[1] },
      { type: 'clip.add', clip: added[0] },
      { type: 'clip.update', clip: moved, previous: clip1 },
    ]);
  });

  it('emits master.update and asset add/remove', () => {
    const p = base();
    const master = { ...p.master, effects: [effect('fx_1', 'reverb')] };
    const extra = asset('ast_0', 10);
    const next: Project = { ...p, master, assets: { [extra.id]: extra } };
    expect(diffProjects(p, next)).toEqual([
      { type: 'master.update', master, previous: p.master },
      { type: 'asset.add', asset: extra },
      { type: 'asset.remove', assetId: asAssetId('ast_1') },
    ]);
    // Replacing asset metadata under the same id is not an audio change.
    expect(
      diffProjects(p, {
        ...p,
        assets: { [asAssetId('ast_1')]: { ...asset('ast_1', 4800), name: 'x' } },
      }),
    ).toEqual([]);
  });

  it('produces every change type in the global order, deterministically regardless of key order', () => {
    const p = base();
    const a = p.tracks[asTrackId('trk_a')]!;
    const c = track('trk_c');
    const next: Project = {
      ...p,
      bpm: 100,
      meter: { numerator: 7, denominator: 8 },
      loop: { ...p.loop, enabled: true },
      metronome: { ...p.metronome, gainDb: -12 },
      trackOrder: [a.id, c.id],
      tracks: { [c.id]: c, [a.id]: { ...a, armed: true } },
      clips: {
        [asClipId('clp_3')]: midiClip('clp_3', 'trk_c', 0, []),
        [asClipId('clp_1')]: { ...p.clips[asClipId('clp_1')]!, muted: true } as never,
      },
      master: { ...p.master, gainDb: -1 },
      assets: { [asAssetId('ast_2')]: asset('ast_2', 1) },
    };
    const expected = [
      'tempo',
      'meter',
      'loop',
      'metronome',
      'track.remove',
      'track.add',
      'track.update',
      'track.order',
      'clip.remove',
      'clip.add',
      'clip.update',
      'master.update',
      'asset.add',
      'asset.remove',
    ];
    expect(types(diffProjects(p, next))).toEqual(expected);
    // Same content built with reversed key insertion order → identical output.
    const reversed: Project = {
      ...next,
      tracks: Object.fromEntries(Object.entries(next.tracks).reverse()),
      clips: Object.fromEntries(Object.entries(next.clips).reverse()),
    };
    expect(diffProjects(p, reversed)).toEqual(diffProjects(p, next));
  });

  it('applying the diff to prev reproduces next (property, clip sets)', () => {
    const p = base();
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 30 }), { maxLength: 15 }),
        fc.boolean(),
        (ids, keepOld) => {
          const clips = Object.fromEntries(
            ids.map((i) => {
              const clip = midiClip(`clp_${i}`, 'trk_a', i * 10, []);
              return [clip.id, clip];
            }),
          );
          const next: Project = { ...p, clips: keepOld ? { ...p.clips, ...clips } : clips };
          const state = new Map(Object.entries(p.clips));
          for (const change of diffProjects(p, next)) {
            if (change.type === 'clip.remove') state.delete(change.clipId);
            else if (change.type === 'clip.add' || change.type === 'clip.update')
              state.set(change.clip.id, change.clip);
          }
          expect(Object.fromEntries([...state].sort())).toEqual(
            Object.fromEntries(Object.entries(next.clips).sort()),
          );
        },
      ),
    );
  });
});
