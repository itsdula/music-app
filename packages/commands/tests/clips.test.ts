import {
  asAssetId,
  asClipId,
  asTrackId,
  checkProjectInvariants,
  clipEndTick,
  expandMidiClipNotes,
  type AudioClip,
  type Clip,
  type MidiClip,
  type Project,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../src';
import {
  apply,
  deepFreeze,
  expectCommandError,
  expectNoop,
  ids,
  makeAsset,
  makeAudioClip,
  makeMidiClip,
  makeProject,
  note,
} from './fixtures';

const NEW = asClipId('clp_new');

const midiOf = (p: Project, id = ids.midi) => p.clips[id] as MidiClip;
const audioOf = (p: Project, id = ids.audioClip) => p.clips[id] as AudioClip;

function withClip(p: Project, clip: Clip): Project {
  return deepFreeze({ ...p, clips: { ...p.clips, [clip.id]: clip } });
}

function expectValid(p: Project): void {
  expect(checkProjectInvariants(p)).toEqual([]);
}

describe('clip.add', () => {
  it('adds MIDI clips to instrument tracks with sorted, clamped notes', () => {
    const p = makeProject();
    const clip = makeMidiClip({
      id: NEW,
      notes: [note('b', 100, 10, 64, 300), note('a', 0, 10, 60, 0)],
    });
    const next = apply(p, { type: 'clip.add', clips: [clip] });
    const added = midiOf(next, NEW);
    expect(added.notes.map((n) => [n.id, n.velocity])).toEqual([
      ['a', 1],
      ['b', 127],
    ]);
    expect(next.clips[ids.midi]).toBe(p.clips[ids.midi]);
    expect(next.tracks).toBe(p.tracks);
    expectValid(next);
  });

  it('keeps already-valid clips by reference and adds several at once', () => {
    const p = makeProject();
    const a = makeMidiClip({ id: asClipId('a') });
    const b = makeAudioClip({ id: asClipId('b'), trackId: ids.vocal });
    const next = apply(p, { type: 'clip.add', clips: [a, b] });
    expect(next.clips[a.id]).toBe(a);
    expect(next.clips[b.id]).toBe(b);
    expectValid(next);
  });

  it('clamps audio clips to their asset, and clamps fades and gain', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'clip.add',
      clips: [
        makeAudioClip({
          id: NEW,
          sourceStartFrame: 400_000,
          lengthFrames: 200_000,
          fadeInFrames: 70_000,
          fadeOutFrames: 70_000,
          gainDb: 40,
        }),
      ],
    });
    expect(audioOf(next, NEW)).toMatchObject({
      lengthFrames: 80_000,
      fadeInFrames: 70_000,
      fadeOutFrames: 10_000,
      gainDb: 6,
    });
    expectValid(next);
    const looping = apply(p, {
      type: 'clip.add',
      clips: [makeAudioClip({ id: NEW, lengthFrames: 2_000_000, loopLengthFrames: 48_000 })],
    });
    expect(audioOf(looping, NEW).lengthFrames).toBe(2_000_000);
  });

  it('is a no-op for an empty list', () => {
    expectNoop(makeProject(), { type: 'clip.add', clips: [] });
  });

  it('rejects kind mismatches and missing references', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'clip.add', clips: [makeMidiClip({ id: NEW, trackId: ids.audio })] },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'clip.add', clips: [makeAudioClip({ id: NEW, trackId: ids.inst })] },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'clip.add', clips: [makeMidiClip({ id: NEW, trackId: asTrackId('x') })] },
      'not-found',
    );
    expectCommandError(
      p,
      { type: 'clip.add', clips: [makeAudioClip({ id: NEW, assetId: asAssetId('x') })] },
      'not-found',
    );
  });

  it('rejects duplicate ids and invalid geometry', () => {
    const p = makeProject();
    const bad = (overrides: Partial<MidiClip>) =>
      ({ type: 'clip.add', clips: [makeMidiClip({ id: NEW, ...overrides })] }) as const;
    const badAudio = (overrides: Partial<AudioClip>) =>
      ({ type: 'clip.add', clips: [makeAudioClip({ id: NEW, ...overrides })] }) as const;
    expectCommandError(p, { type: 'clip.add', clips: [makeMidiClip()] }, 'invalid-argument');
    expectCommandError(
      p,
      { type: 'clip.add', clips: [makeMidiClip({ id: NEW }), makeMidiClip({ id: NEW })] },
      'invalid-argument',
    );
    expectCommandError(p, bad({ id: asClipId('') }), 'invalid-argument');
    expectCommandError(p, bad({ startTick: -1 }), 'invalid-argument');
    expectCommandError(p, bad({ startTick: 1.5 }), 'invalid-argument');
    expectCommandError(p, bad({ lengthTicks: 0 }), 'invalid-argument');
    expectCommandError(p, bad({ contentOffsetTicks: -5 }), 'invalid-argument');
    expectCommandError(p, bad({ loopLengthTicks: 0 }), 'invalid-argument');
    expectCommandError(p, bad({ color: 'blue' }), 'invalid-argument');
    expectCommandError(p, bad({ notes: [note('a', 0, 10, 128)] }), 'invalid-argument');
    expectCommandError(p, bad({ notes: [note('a', 0), note('a', 10)] }), 'invalid-argument');
    expectCommandError(p, bad({ notes: [note('a', 0, 0)] }), 'invalid-argument');
    expectCommandError(p, badAudio({ sourceStartFrame: 480_000 }), 'invalid-argument');
    expectCommandError(p, badAudio({ sourceStartFrame: -1 }), 'invalid-argument');
    expectCommandError(p, badAudio({ lengthFrames: 0 }), 'invalid-argument');
    expectCommandError(p, badAudio({ loopLengthFrames: 0.5 }), 'invalid-argument');
    expectCommandError(p, badAudio({ fadeInFrames: 1.5 }), 'invalid-argument');
    expectCommandError(p, badAudio({ gainDb: Number.NaN }), 'invalid-argument');
  });
});

describe('clip.remove', () => {
  it('removes clips and shares the rest', () => {
    const p = makeProject();
    const next = apply(p, { type: 'clip.remove', clipIds: [ids.midi, ids.midi] });
    expect(Object.keys(next.clips)).toEqual([ids.audioClip]);
    expect(next.clips[ids.audioClip]).toBe(p.clips[ids.audioClip]);
    expect(next.tracks).toBe(p.tracks);
  });

  it('requires every id to exist and is a no-op for an empty list', () => {
    const p = makeProject();
    expectCommandError(p, { type: 'clip.remove', clipIds: [ids.midi, asClipId('x')] }, 'not-found');
    expectNoop(p, { type: 'clip.remove', clipIds: [] });
  });
});

describe('clip.move', () => {
  it('moves clips in time and across compatible tracks', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'clip.move',
      moves: [
        { clipId: ids.midi, startTick: 0 },
        { clipId: ids.audioClip, startTick: 9600, trackId: ids.vocal },
      ],
    });
    expect(midiOf(next)).toMatchObject({ startTick: 0, trackId: ids.inst });
    expect(midiOf(next).notes).toBe(midiOf(p).notes);
    expect(audioOf(next)).toMatchObject({ startTick: 9600, trackId: ids.vocal });
    expectValid(next);
  });

  it('allows overlapping clips', () => {
    const p = apply(makeProject(), {
      type: 'clip.add',
      clips: [makeMidiClip({ id: NEW, startTick: 0 })],
    });
    const next = apply(p, { type: 'clip.move', moves: [{ clipId: NEW, startTick: 1000 }] });
    expectValid(next);
  });

  it('is a no-op when nothing moves', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'clip.move',
      moves: [{ clipId: ids.midi, startTick: 960, trackId: ids.inst }],
    });
    expectNoop(p, { type: 'clip.move', moves: [] });
  });

  it('validates moves', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: ids.midi, startTick: -1 }] },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 10.5 }] },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'clip.move',
        moves: [
          { clipId: ids.midi, startTick: 0 },
          { clipId: ids.midi, startTick: 5 },
        ],
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: asClipId('x'), startTick: 0 }] },
      'not-found',
    );
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 0, trackId: ids.audio }] },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: ids.audioClip, startTick: 0, trackId: ids.inst }] },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 0, trackId: asTrackId('x') }] },
      'not-found',
    );
  });
});

describe('clip.updateMidi', () => {
  it('patches properties and sets/clears loops', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'clip.updateMidi',
      clipId: ids.midi,
      patch: { name: 'Verse', color: '#ABCDEF', muted: true, loopLengthTicks: 960 },
    });
    expect(midiOf(next)).toMatchObject({
      name: 'Verse',
      color: '#ABCDEF',
      muted: true,
      loopLengthTicks: 960,
    });
    expect(midiOf(next).notes).toBe(midiOf(p).notes);
    const cleared = apply(next, {
      type: 'clip.updateMidi',
      clipId: ids.midi,
      patch: { loopLengthTicks: null },
    });
    expect('loopLengthTicks' in midiOf(cleared)).toBe(false);
  });

  it('is a no-op for identical values and for clearing a missing loop', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'clip.updateMidi',
      clipId: ids.midi,
      patch: { name: 'MIDI Clip', muted: false },
    });
    expectNoop(p, { type: 'clip.updateMidi', clipId: ids.midi, patch: { loopLengthTicks: null } });
  });

  it('validates input and clip kind', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: ids.midi, patch: { loopLengthTicks: 0 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: ids.midi, patch: { loopLengthTicks: 1.5 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: ids.midi, patch: { color: '#GGGGGG' } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: ids.midi, patch: { name: 5 as unknown as string } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: ids.audioClip, patch: { muted: true } },
      'kind-mismatch',
    );
    expectCommandError(
      p,
      { type: 'clip.updateMidi', clipId: asClipId('x'), patch: {} },
      'not-found',
    );
  });
});

describe('clip.updateAudio', () => {
  it('moves a looped clip back inside its asset when looping is turned off', () => {
    const asset = makeProject().assets[audioOf(makeProject()).assetId]!;
    // A looped clip whose window was trimmed past the end of the audio.
    const p = withClip(
      makeProject(),
      makeAudioClip({
        sourceStartFrame: asset.frames + 500,
        lengthFrames: 4000,
        loopLengthFrames: 2000,
      }),
    );
    const next = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { loopLengthFrames: null },
    });
    const clip = audioOf(next);
    expect(clip.loopLengthFrames).toBeUndefined();
    expect(clip.sourceStartFrame + clip.lengthFrames).toBeLessThanOrEqual(asset.frames);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('patches gain with clamping and shares the rest', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { gainDb: -99, name: 'Riff' },
    });
    expect(audioOf(next)).toMatchObject({ gainDb: -60, name: 'Riff' });
    expect(next.clips[ids.midi]).toBe(p.clips[ids.midi]);
  });

  it('clamps an edited fade against the fade that was not edited', () => {
    const p = withClip(makeProject(), makeAudioClip({ fadeOutFrames: 10_000 }));
    const fadeIn = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { fadeInFrames: 90_000 },
    });
    expect(audioOf(fadeIn)).toMatchObject({ fadeInFrames: 86_000, fadeOutFrames: 10_000 });
    // Growing the fade-out is limited by the (unedited) fade-in: it clamps back to 10 000,
    // so nothing changes and the project is returned as-is.
    expectNoop(fadeIn, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { fadeOutFrames: 50_000 },
    });
    const shorterOut = apply(fadeIn, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { fadeOutFrames: 4000 },
    });
    expect(audioOf(shorterOut)).toMatchObject({ fadeInFrames: 86_000, fadeOutFrames: 4000 });
    const both = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { fadeInFrames: 60_000, fadeOutFrames: 60_000 },
    });
    expect(audioOf(both)).toMatchObject({ fadeInFrames: 60_000, fadeOutFrames: 36_000 });
    const negative = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { fadeOutFrames: -5 },
    });
    expect(audioOf(negative).fadeOutFrames).toBe(0);
    expectValid(both);
  });

  it('sets loops and clamps the length to the asset when a loop is cleared', () => {
    const p = withClip(
      makeProject(),
      makeAudioClip({ lengthFrames: 1_000_000, loopLengthFrames: 48_000, fadeOutFrames: 900_000 }),
    );
    const cleared = apply(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { loopLengthFrames: null },
    });
    expect(audioOf(cleared)).toMatchObject({ lengthFrames: 432_000, fadeOutFrames: 432_000 });
    expect('loopLengthFrames' in audioOf(cleared)).toBe(false);
    expectValid(cleared);
    const looped = apply(cleared, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { loopLengthFrames: 24_000 },
    });
    expect(audioOf(looped).loopLengthFrames).toBe(24_000);
  });

  it('is a no-op for identical values', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'clip.updateAudio',
      clipId: ids.audioClip,
      patch: { gainDb: 0, fadeInFrames: 0, loopLengthFrames: null },
    });
  });

  it('validates input and clip kind', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { fadeInFrames: 0.5 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { fadeOutFrames: Number.NaN } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { loopLengthFrames: -1 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { gainDb: Number.NaN } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.updateAudio', clipId: ids.midi, patch: { gainDb: 0 } },
      'kind-mismatch',
    );
    const orphan = deepFreeze({ ...p, assets: {} });
    expectCommandError(
      orphan,
      { type: 'clip.updateAudio', clipId: ids.audioClip, patch: { gainDb: 1 } },
      'not-found',
    );
  });
});

describe('clip.trimStart (MIDI)', () => {
  it('moves the left edge right, advancing the content offset', () => {
    const p = makeProject();
    const next = apply(p, { type: 'clip.trimStart', clipId: ids.midi, startTick: 1200 });
    expect(midiOf(next)).toMatchObject({
      startTick: 1200,
      contentOffsetTicks: 240,
      lengthTicks: 3600,
    });
    expect(midiOf(next).notes).toBe(midiOf(p).notes);
    expect(next.clips[ids.audioClip]).toBe(p.clips[ids.audioClip]);
    expectValid(next);
  });

  it('extends left only as far as content tick 0', () => {
    const p = apply(makeProject(), { type: 'clip.trimStart', clipId: ids.midi, startTick: 1200 });
    const back = apply(p, { type: 'clip.trimStart', clipId: ids.midi, startTick: 0 });
    expect(midiOf(back)).toMatchObject({
      startTick: 960,
      contentOffsetTicks: 0,
      lengthTicks: 3840,
    });
    expectNoop(back, { type: 'clip.trimStart', clipId: ids.midi, startTick: 100 });
    expectNoop(back, { type: 'clip.trimStart', clipId: ids.midi, startTick: 960 });
  });

  it('keeps timeline positions of the remaining notes', () => {
    const p = makeProject();
    const before = expandMidiClipNotes(midiOf(p)).filter((n) => n.startTick >= 1440);
    const after = expandMidiClipNotes(
      midiOf(apply(p, { type: 'clip.trimStart', clipId: ids.midi, startTick: 1440 })),
    );
    expect(after.map((n) => [n.note.id, n.startTick])).toEqual(
      before.map((n) => [n.note.id, n.startTick]),
    );
  });

  it('must stay before the clip end', () => {
    const p = makeProject();
    expect(
      midiOf(apply(p, { type: 'clip.trimStart', clipId: ids.midi, startTick: 4799 })).lengthTicks,
    ).toBe(1);
    expectCommandError(
      p,
      { type: 'clip.trimStart', clipId: ids.midi, startTick: 4800 },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.trimStart', clipId: ids.midi, startTick: 1000.5 },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.trimStart', clipId: ids.midi, startTick: -1 },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.trimStart', clipId: asClipId('x'), startTick: 0 },
      'not-found',
    );
  });
});

describe('clip.trimStart (audio)', () => {
  it('advances the source start by the tick delta converted to frames', () => {
    const next = apply(makeProject(), {
      type: 'clip.trimStart',
      clipId: ids.audioClip,
      startTick: 2400,
    });
    expect(audioOf(next)).toMatchObject({
      startTick: 2400,
      sourceStartFrame: 60_000,
      lengthFrames: 84_000,
    });
    expect(clipEndTick(audioOf(next), next)).toBe(5760);
    expectValid(next);
  });

  it('reveals earlier source when extending left', () => {
    const next = apply(makeProject(), {
      type: 'clip.trimStart',
      clipId: ids.audioClip,
      startTick: 0,
    });
    expect(audioOf(next)).toMatchObject({
      startTick: 0,
      sourceStartFrame: 0,
      lengthFrames: 144_000,
    });
  });

  it('stops at source frame 0 and adjusts the applied start consistently', () => {
    const p = withClip(makeProject(), makeAudioClip({ sourceStartFrame: 24_000 }));
    const next = apply(p, { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 0 });
    expect(audioOf(next)).toMatchObject({
      startTick: 960,
      sourceStartFrame: 0,
      lengthFrames: 120_000,
    });
    expect(clipEndTick(audioOf(next), next)).toBe(5760);
    const atZero = withClip(makeProject(), makeAudioClip({ sourceStartFrame: 0 }));
    expectNoop(atZero, { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 0 });
  });

  it('keeps at least one frame and re-clamps fades', () => {
    const p = withClip(makeProject(), makeAudioClip({ fadeInFrames: 90_000, fadeOutFrames: 6000 }));
    const trimmed = apply(p, { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 2400 });
    expect(audioOf(trimmed)).toMatchObject({
      lengthFrames: 84_000,
      fadeInFrames: 84_000,
      fadeOutFrames: 0,
    });
    const tiny = apply(p, { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 5759 });
    expect(audioOf(tiny).lengthFrames).toBe(25);
    expectValid(tiny);
    expectCommandError(
      p,
      { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 5760 },
      'invalid-argument',
    );
  });

  it('never leaves less than one frame when rounding reaches the end', () => {
    // 1 frame at 1 kHz and 400 BPM is 6.4 ticks; trimming to start + 6 rounds to the whole clip.
    const base = makeProject();
    const p = deepFreeze({
      ...base,
      bpm: 400,
      assets: { ...base.assets, [ids.take]: makeAsset({ sampleRate: 1000, frames: 1000 }) },
      clips: {
        [ids.audioClip]: makeAudioClip({ startTick: 0, sourceStartFrame: 0, lengthFrames: 2 }),
      },
      vocalEdits: {},
    });
    const next = apply(p, { type: 'clip.trimStart', clipId: ids.audioClip, startTick: 12 });
    expect(audioOf(next)).toMatchObject({ startTick: 12, sourceStartFrame: 1, lengthFrames: 1 });
  });
});

describe('clip.trimEnd', () => {
  it('sets the MIDI length from the end tick', () => {
    const p = makeProject();
    expect(
      midiOf(apply(p, { type: 'clip.trimEnd', clipId: ids.midi, endTick: 2000 })).lengthTicks,
    ).toBe(1040);
    expectNoop(p, { type: 'clip.trimEnd', clipId: ids.midi, endTick: 4800 });
    expectCommandError(
      p,
      { type: 'clip.trimEnd', clipId: ids.midi, endTick: 960 },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.trimEnd', clipId: ids.midi, endTick: 2000.5 },
      'invalid-argument',
    );
  });

  it('converts audio ends to frames at the current tempo', () => {
    const p = makeProject();
    expect(
      audioOf(apply(p, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 3840 }))
        .lengthFrames,
    ).toBe(48_000);
    const slow = deepFreeze({ ...p, bpm: 60 });
    expect(
      audioOf(apply(slow, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 2880 }))
        .lengthFrames,
    ).toBe(48_000);
    expectNoop(p, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 5760 });
  });

  it('clamps non-looping audio to the asset and re-clamps fades', () => {
    const p = withClip(
      makeProject(),
      makeAudioClip({ fadeInFrames: 50_000, fadeOutFrames: 40_000 }),
    );
    const extended = apply(p, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 1_000_000 });
    expect(audioOf(extended).lengthFrames).toBe(432_000);
    expectValid(extended);
    const shortened = apply(p, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 3840 });
    expect(audioOf(shortened)).toMatchObject({
      lengthFrames: 48_000,
      fadeInFrames: 48_000,
      fadeOutFrames: 0,
    });
    const looping = withClip(makeProject(), makeAudioClip({ loopLengthFrames: 48_000 }));
    expect(
      audioOf(apply(looping, { type: 'clip.trimEnd', clipId: ids.audioClip, endTick: 1_000_000 }))
        .lengthFrames,
    ).toBe((1_000_000 - 1920) * 25);
  });
});

describe('clip.split', () => {
  it('splits MIDI clips sharing the notes array', () => {
    const p = makeProject();
    const next = apply(p, { type: 'clip.split', clipId: ids.midi, atTick: 2400, newClipId: NEW });
    const left = midiOf(next);
    const right = midiOf(next, NEW);
    expect(left).toMatchObject({
      id: ids.midi,
      startTick: 960,
      lengthTicks: 1440,
      contentOffsetTicks: 0,
    });
    expect(right).toMatchObject({
      id: NEW,
      startTick: 2400,
      lengthTicks: 2400,
      contentOffsetTicks: 1440,
    });
    expect(right.notes).toBe(midiOf(p).notes);
    expect(left.notes).toBe(midiOf(p).notes);
    // No note crosses tick 2400, so the halves play exactly what the original played.
    const halves = [...expandMidiClipNotes(left), ...expandMidiClipNotes(right)];
    expect(halves.map((n) => [n.note.id, n.startTick, n.endTick])).toEqual(
      expandMidiClipNotes(midiOf(p)).map((n) => [n.note.id, n.startTick, n.endTick]),
    );
    expectValid(next);
  });

  it('preserves MIDI loops and offsets', () => {
    const p = withClip(
      makeProject(),
      makeMidiClip({ loopLengthTicks: 960, contentOffsetTicks: 100 }),
    );
    const next = apply(p, { type: 'clip.split', clipId: ids.midi, atTick: 1000, newClipId: NEW });
    expect(midiOf(next)).toMatchObject({
      lengthTicks: 40,
      loopLengthTicks: 960,
      contentOffsetTicks: 100,
    });
    expect(midiOf(next, NEW)).toMatchObject({
      lengthTicks: 3800,
      loopLengthTicks: 960,
      contentOffsetTicks: 140,
    });
  });

  it('splits audio clips, advancing the right source start and dividing fades', () => {
    const p = withClip(
      makeProject(),
      makeAudioClip({ fadeInFrames: 1000, fadeOutFrames: 2000, loopLengthFrames: 96_000 }),
    );
    const next = apply(p, {
      type: 'clip.split',
      clipId: ids.audioClip,
      atTick: 2880,
      newClipId: NEW,
    });
    expect(audioOf(next)).toMatchObject({
      startTick: 1920,
      sourceStartFrame: 48_000,
      lengthFrames: 24_000,
      fadeInFrames: 1000,
      fadeOutFrames: 0,
      loopLengthFrames: 96_000,
    });
    expect(audioOf(next, NEW)).toMatchObject({
      id: NEW,
      startTick: 2880,
      sourceStartFrame: 72_000,
      lengthFrames: 72_000,
      fadeInFrames: 0,
      fadeOutFrames: 2000,
      loopLengthFrames: 96_000,
    });
    expectValid(next);
  });

  it('clamps fades that no longer fit the halves', () => {
    const p = withClip(
      makeProject(),
      makeAudioClip({ fadeInFrames: 50_000, fadeOutFrames: 46_000 }),
    );
    const next = apply(p, {
      type: 'clip.split',
      clipId: ids.audioClip,
      atTick: 2880,
      newClipId: NEW,
    });
    expect(audioOf(next).fadeInFrames).toBe(24_000);
    expect(audioOf(next, NEW).fadeOutFrames).toBe(46_000);
    expectValid(next);
  });

  it('requires a position strictly inside the clip and a fresh id', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.midi, atTick: 960, newClipId: NEW },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.midi, atTick: 4800, newClipId: NEW },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.audioClip, atTick: 5760, newClipId: NEW },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.midi, atTick: 1000.5, newClipId: NEW },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.midi, atTick: 2000, newClipId: ids.audioClip },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.midi, atTick: 2000, newClipId: ids.midi },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'clip.split', clipId: asClipId('x'), atTick: 2000, newClipId: NEW },
      'not-found',
    );
  });

  it('rejects splitting a one-frame audio clip', () => {
    const base = makeProject();
    const p = deepFreeze({
      ...base,
      bpm: 400,
      assets: { ...base.assets, [ids.take]: makeAsset({ sampleRate: 1000, frames: 1000 }) },
      clips: {
        [ids.audioClip]: makeAudioClip({ startTick: 0, sourceStartFrame: 0, lengthFrames: 1 }),
      },
      vocalEdits: {},
    });
    expectCommandError(
      p,
      { type: 'clip.split', clipId: ids.audioClip, atTick: 3, newClipId: NEW },
      'invalid-argument',
      /too short/,
    );
  });

  it('does not mutate the input project', () => {
    const p = makeProject();
    const snapshot = JSON.stringify(p);
    applyCommand(p, { type: 'clip.split', clipId: ids.midi, atTick: 2000, newClipId: NEW });
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});
