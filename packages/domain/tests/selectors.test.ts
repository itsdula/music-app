import { describe, expect, it } from 'vitest';
import {
  PPQ,
  anyTrackSoloed,
  arrangementEndTick,
  asAssetId,
  asClipId,
  asNoteId,
  asProjectId,
  asTrackId,
  audioClipFrameAtTick,
  audioClipLengthTicks,
  audioClipSegments,
  clipEndTick,
  clipKindForTrack,
  clipLengthTicks,
  clipsOnTrack,
  createAudioClip,
  createEmptyProject,
  createMidiClip,
  createTrack,
  expandMidiClipNotes,
  getClip,
  isTrackAudible,
  orderedTracks,
  type AssetRef,
  type AudioClip,
  type MidiClip,
  type MidiNote,
  type Project,
} from '../src';

const note = (id: string, startTick: number, durationTicks: number, pitch = 60): MidiNote => ({
  id: asNoteId(id),
  startTick,
  durationTicks,
  pitch,
  velocity: 100,
});

const midiClip = (overrides: Partial<MidiClip> = {}): MidiClip => ({
  ...createMidiClip({
    id: asClipId('c1'),
    trackId: asTrackId('t1'),
    startTick: 1000,
    lengthTicks: 400,
  }),
  ...overrides,
});

const asset: AssetRef = {
  id: asAssetId('a1'),
  name: 'Take',
  kind: 'audio',
  mimeType: 'audio/wav',
  sampleRate: 48_000,
  channels: 1,
  frames: 96_000,
  contentHash: 'abc',
  byteLength: 192_000,
  source: 'recording',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const audioClip = (overrides: Partial<AudioClip> = {}): AudioClip => ({
  ...createAudioClip({
    id: asClipId('ac'),
    trackId: asTrackId('t2'),
    assetId: asset.id,
    startTick: 0,
    lengthFrames: 48_000,
  }),
  ...overrides,
});

function sampleProject(): Project {
  const base = createEmptyProject({ id: asProjectId('p'), now: '2026-01-01T00:00:00.000Z' });
  const t1 = createTrack({ id: asTrackId('t1'), kind: 'instrument' });
  const t2 = createTrack({ id: asTrackId('t2'), kind: 'audio' });
  const c1 = midiClip({ startTick: 2000 });
  const c0 = midiClip({ id: asClipId('c0'), startTick: 0 });
  const c2 = midiClip({ id: asClipId('c2'), startTick: 0 });
  const ac = audioClip({ startTick: 4000 });
  return {
    ...base,
    trackOrder: [t2.id, asTrackId('ghost'), t1.id],
    tracks: { [t1.id]: t1, [t2.id]: t2 },
    clips: { [c1.id]: c1, [c0.id]: c0, [c2.id]: c2, [ac.id]: ac },
    assets: { [asset.id]: asset },
  };
}

describe('project selectors', () => {
  it('orders tracks and skips dangling ids', () => {
    expect(orderedTracks(sampleProject()).map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('lists clips on a track by start then id', () => {
    expect(clipsOnTrack(sampleProject(), asTrackId('t1')).map((c) => c.id)).toEqual([
      'c0',
      'c2',
      'c1',
    ]);
    expect(clipsOnTrack(sampleProject(), asTrackId('none'))).toEqual([]);
  });

  it('computes clip lengths and ends for both kinds', () => {
    const p = sampleProject();
    expect(clipLengthTicks(p.clips[asClipId('c1')]!, p)).toBe(400);
    expect(clipEndTick(p.clips[asClipId('c1')]!, p)).toBe(2400);
    // 48 000 frames at 48 kHz = 1 s = 2 beats at 120 BPM.
    expect(clipLengthTicks(p.clips[asClipId('ac')]!, p)).toBe(PPQ * 2);
    expect(clipEndTick(p.clips[asClipId('ac')]!, p)).toBe(4000 + PPQ * 2);
    expect(clipEndTick(p.clips[asClipId('ac')]!, { ...p, bpm: 60 })).toBe(4000 + PPQ);
    expect(arrangementEndTick(p)).toBe(4000 + PPQ * 2);
    expect(arrangementEndTick({ ...p, clips: {} })).toBe(0);
  });

  it('falls back to 48 kHz when the asset is unknown', () => {
    expect(audioClipLengthTicks(audioClip({ lengthFrames: 48_000 }), undefined, 120)).toBe(PPQ * 2);
    expect(audioClipLengthTicks(audioClip(), { ...asset, sampleRate: 24_000 }, 120)).toBe(PPQ * 4);
  });

  it('resolves solo/mute audibility', () => {
    const p = sampleProject();
    const t1 = p.tracks[asTrackId('t1')]!;
    expect(anyTrackSoloed(p)).toBe(false);
    expect(isTrackAudible(t1, false)).toBe(true);
    expect(isTrackAudible({ ...t1, mixer: { ...t1.mixer, mute: true } }, false)).toBe(false);
    expect(isTrackAudible(t1, true)).toBe(false);
    const soloed = { ...t1, mixer: { ...t1.mixer, solo: true } };
    expect(isTrackAudible(soloed, true)).toBe(true);
    expect(isTrackAudible({ ...soloed, mixer: { ...soloed.mixer, mute: true } }, true)).toBe(false);
    expect(anyTrackSoloed({ ...p, tracks: { ...p.tracks, [t1.id]: soloed } })).toBe(true);
  });

  it('maps track kinds to clip kinds and looks clips up', () => {
    const p = sampleProject();
    expect(clipKindForTrack(p.tracks[asTrackId('t1')]!)).toBe('midi');
    expect(clipKindForTrack(p.tracks[asTrackId('t2')]!)).toBe('audio');
    expect(clipKindForTrack(createTrack({ id: asTrackId('v'), kind: 'vocal' }))).toBe('audio');
    expect(getClip(p, asClipId('c1'))?.id).toBe('c1');
    expect(getClip(p, asClipId('zz'))).toBeUndefined();
  });
});

describe('expandMidiClipNotes', () => {
  it('returns nothing for an empty clip', () => {
    expect(expandMidiClipNotes(midiClip())).toEqual([]);
    expect(expandMidiClipNotes(midiClip({ loopLengthTicks: 100 }))).toEqual([]);
  });

  it('places notes at the clip position', () => {
    const clip = midiClip({ notes: [note('a', 0, 100), note('b', 200, 50, 64)] });
    expect(
      expandMidiClipNotes(clip).map((n) => [n.note.id, n.startTick, n.endTick, n.iteration]),
    ).toEqual([
      ['a', 1000, 1100, 0],
      ['b', 1200, 1250, 0],
    ]);
  });

  it('applies the content offset and drops notes starting before the window', () => {
    const clip = midiClip({
      contentOffsetTicks: 100,
      notes: [note('early', 50, 200), note('a', 100, 10), note('b', 300, 10)],
    });
    expect(expandMidiClipNotes(clip).map((n) => [n.note.id, n.startTick, n.endTick])).toEqual([
      ['a', 1000, 1010],
      ['b', 1200, 1210],
    ]);
  });

  it('shortens notes crossing the clip end and drops notes past it', () => {
    const clip = midiClip({
      notes: [note('long', 300, 500), note('after', 400, 10), note('x', 399, 1)],
    });
    expect(expandMidiClipNotes(clip).map((n) => [n.note.id, n.startTick, n.endTick])).toEqual([
      ['long', 1300, 1400],
      ['x', 1399, 1400],
    ]);
  });

  it('repeats loop content, cutting notes at loop boundaries', () => {
    const clip = midiClip({
      lengthTicks: 250,
      loopLengthTicks: 100,
      notes: [note('a', 0, 30), note('cross', 80, 50, 62), note('outside', 120, 10)],
    });
    expect(
      expandMidiClipNotes(clip).map((n) => [n.note.id, n.startTick, n.endTick, n.iteration]),
    ).toEqual([
      ['a', 1000, 1030, 0],
      ['cross', 1080, 1100, 0],
      ['a', 1100, 1130, 1],
      ['cross', 1180, 1200, 1],
      ['a', 1200, 1230, 2],
    ]);
  });

  it('combines loops with a content offset', () => {
    const clip = midiClip({
      lengthTicks: 200,
      contentOffsetTicks: 150,
      loopLengthTicks: 100,
      notes: [note('a', 0, 10), note('b', 60, 10)],
    });
    // Window is content [150, 350): b@160, a@200, b@260, a@300.
    expect(expandMidiClipNotes(clip).map((n) => [n.note.id, n.startTick, n.iteration])).toEqual([
      ['b', 1010, 1],
      ['a', 1050, 2],
      ['b', 1110, 2],
      ['a', 1150, 3],
    ]);
  });

  it('sorts output by start, pitch and id', () => {
    const clip = midiClip({
      notes: [note('z', 0, 10, 60), note('y', 0, 10, 60), note('x', 0, 10, 50)],
    });
    expect(expandMidiClipNotes(clip).map((n) => n.note.id)).toEqual(['x', 'y', 'z']);
  });

  it('treats a non-positive loop length as no loop', () => {
    const clip = midiClip({ loopLengthTicks: 0, notes: [note('a', 300, 10)] });
    expect(expandMidiClipNotes(clip)).toHaveLength(1);
  });
});

describe('audioClipSegments', () => {
  it('returns a single read without looping', () => {
    expect(
      audioClipSegments(audioClip({ startTick: 960, sourceStartFrame: 100 }), asset, 120),
    ).toEqual([{ timelineStartTick: 960, sourceStartFrame: 100, frames: 48_000 }]);
  });

  it('clamps reads to the asset length and drops empty reads', () => {
    expect(
      audioClipSegments(audioClip({ sourceStartFrame: 90_000, lengthFrames: 10_000 }), asset, 120),
    ).toEqual([{ timelineStartTick: 0, sourceStartFrame: 90_000, frames: 6000 }]);
    expect(audioClipSegments(audioClip({ sourceStartFrame: 96_000 }), asset, 120)).toEqual([]);
  });

  it('splits looping clips into one read per iteration', () => {
    const clip = audioClip({ startTick: 100, lengthFrames: 60_000, loopLengthFrames: 24_000 });
    expect(audioClipSegments(clip, asset, 120)).toEqual([
      { timelineStartTick: 100, sourceStartFrame: 0, frames: 24_000 },
      { timelineStartTick: 100 + PPQ, sourceStartFrame: 0, frames: 24_000 },
      { timelineStartTick: 100 + PPQ * 2, sourceStartFrame: 0, frames: 12_000 },
    ]);
  });

  it('limits loop reads to the available source', () => {
    const clip = audioClip({
      sourceStartFrame: 90_000,
      lengthFrames: 20_000,
      loopLengthFrames: 10_000,
    });
    expect(audioClipSegments(clip, asset, 120)).toEqual([
      { timelineStartTick: 0, sourceStartFrame: 90_000, frames: 6000 },
      { timelineStartTick: PPQ / 2.4, sourceStartFrame: 90_000, frames: 6000 },
    ]);
    expect(audioClipSegments({ ...clip, sourceStartFrame: 100_000 }, asset, 120)).toEqual([]);
  });

  it('computes the source frame at a timeline tick', () => {
    const clip = audioClip({ startTick: 960, sourceStartFrame: 1000 });
    expect(audioClipFrameAtTick(clip, asset, 120, 960)).toBe(1000);
    expect(audioClipFrameAtTick(clip, asset, 120, 1920)).toBe(25_000);
    expect(audioClipFrameAtTick(clip, asset, 120, 0)).toBe(-23_000);
  });
});
