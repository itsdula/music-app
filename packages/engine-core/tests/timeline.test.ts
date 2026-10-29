import fc from 'fast-check';
import { asAssetId, asClipId, asNoteId, asTrackId, ticksToFrames } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  IntervalTree,
  TrackTimeline,
  audioClipEvents,
  buildTimelineIndex,
  buildTrackTimeline,
  lowerBoundBy,
  upperBoundBy,
  type TimelineAudioEvent,
  type TimelineNoteEvent,
} from '../src';
import { asset, audioClip, midiClip, note, project, track } from './fixtures';

const T = asTrackId('trk_a');

function audioEvent(start: number, end: number, i: number): TimelineAudioEvent {
  return {
    key: `c${i}#0`,
    clipId: asClipId(`c${i}`),
    assetId: asAssetId('ast'),
    startTick: start,
    endTick: end,
    start,
    end,
    sourceStartFrame: 0,
    frames: 1,
    sampleRate: 48000,
    clipOffsetFrames: 0,
    clipLengthFrames: 1,
    gain: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
}

function noteEvent(start: number, i: number): TimelineNoteEvent {
  return {
    clipId: asClipId('c'),
    noteId: asNoteId(`n${i}`),
    pitch: 60 + (i % 12),
    velocity: 100,
    startTick: start,
    endTick: start + 10,
  };
}

const keyOf = (e: TimelineAudioEvent) => e.key;

describe('interval tree', () => {
  it('matches brute force for containing / startingIn / overlapping (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 300 })), {
          maxLength: 80,
        }),
        fc.integer({ min: -10, max: 820 }),
        fc.integer({ min: 0, max: 200 }),
        (raw, a, span) => {
          const events = raw.map(([s, len], i) => audioEvent(s, s + len, i));
          const tree = new IntervalTree(events);
          const b = a + span;
          const valid = events.filter((e) => e.end > e.start);
          const sort = (xs: TimelineAudioEvent[]) => xs.map(keyOf).sort();
          expect(sort(tree.containing(a))).toEqual(
            sort(valid.filter((e) => e.start <= a && a < e.end)),
          );
          expect(tree.startingIn(a, b).map(keyOf)).toEqual(
            valid
              .filter((e) => e.start >= a && e.start < b)
              .sort((x, y) => x.start - y.start || x.end - y.end)
              .map(keyOf),
          );
          expect(sort(tree.overlapping(a, b))).toEqual(
            sort(span > 0 ? valid.filter((e) => e.start < b && e.end > a) : []),
          );
          expect(tree.size).toBe(valid.length);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('handles duplicates, empty trees and binary-search helpers', () => {
    const dup = new IntervalTree([audioEvent(0, 10, 1), audioEvent(0, 10, 2), audioEvent(5, 5, 3)]);
    expect(dup.containing(9).map(keyOf).sort()).toEqual(['c1#0', 'c2#0']);
    expect(dup.containing(10)).toEqual([]);
    expect(new IntervalTree<TimelineAudioEvent>([]).overlapping(0, 100)).toEqual([]);
    expect(dup.startingIn(5, 5)).toEqual([]);
    const xs = [1, 2, 2, 3];
    expect(lowerBoundBy(xs, 2, (x) => x)).toBe(1);
    expect(upperBoundBy(xs, 2, (x) => x)).toBe(3);
  });
});

describe('TrackTimeline queries vs brute force', () => {
  it('notesStartingIn / audio queries agree with linear scans (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10_000 }), { maxLength: 200 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 10_000 }), fc.integer({ min: 1, max: 4000 })), {
          maxLength: 50,
        }),
        fc.integer({ min: 0, max: 12_000 }),
        fc.integer({ min: 1, max: 3000 }),
        (noteStarts, audioRaw, a, span) => {
          const notes = noteStarts.map((s, i) => noteEvent(s, i));
          const audio = audioRaw.map(([s, len], i) => audioEvent(s, s + len, i));
          const timeline = new TrackTimeline(T, notes, audio);
          const b = a + span;
          const expectedNotes = timeline.notes.filter((n) => n.startTick >= a && n.startTick < b);
          expect(timeline.notesStartingIn(a, b)).toEqual(expectedNotes);
          expect(timeline.audioStartingIn(a, b).map(keyOf).sort()).toEqual(
            audio
              .filter((e) => e.start >= a && e.start < b)
              .map(keyOf)
              .sort(),
          );
          expect(timeline.audioOverlapping(a, b).map(keyOf).sort()).toEqual(
            audio
              .filter((e) => e.start < b && e.end > a)
              .map(keyOf)
              .sort(),
          );
          expect(timeline.notesStartingIn(b, a)).toEqual([]);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('buildTrackTimeline', () => {
  it('expands MIDI clips (offset, loop, mute) into sorted absolute events', () => {
    const looped = midiClip(
      'clp_1',
      'trk_a',
      1000,
      [note('n1', 0, 100, 60), note('n2', 200, 500, 64)],
      {
        lengthTicks: 1200,
        loopLengthTicks: 400,
      },
    );
    const muted = midiClip('clp_2', 'trk_a', 0, [note('n3', 0, 10)], { muted: true });
    const other = midiClip('clp_3', 'trk_b', 0, [note('n4', 0, 10)]);
    const timeline = buildTrackTimeline(T, [looped, muted, other], {}, 120);
    expect(timeline.notes.map((n) => [n.startTick, n.endTick, n.pitch])).toEqual([
      [1000, 1100, 60],
      [1200, 1400, 64], // cut at the loop boundary (content 400)
      [1400, 1500, 60],
      [1600, 1800, 64],
      [1800, 1900, 60],
      [2000, 2200, 64], // cut at the clip end (2200)
    ]);
  });

  it('flattens audio clips into segments with tempo-dependent ticks and loop offsets', () => {
    const a = asset('ast_1', 96_000); // 2 s at 48 kHz
    const clip = audioClip('clp_a', 'trk_a', 'ast_1', 960, 48_000 * 3, {
      sourceStartFrame: 24_000,
      loopLengthFrames: 48_000,
      gainDb: -6,
      fadeInFrames: 100,
      fadeOutFrames: 200,
    });
    const timeline = buildTrackTimeline(T, [clip], { [a.id]: a }, 120);
    const ticksPerSecond = 1920;
    expect(
      timeline.audio.map((e) => [e.startTick, e.endTick, e.clipOffsetFrames, e.sourceStartFrame]),
    ).toEqual([
      [960, 960 + ticksPerSecond, 0, 24_000],
      [960 + ticksPerSecond, 960 + 2 * ticksPerSecond, 48_000, 24_000],
      [960 + 2 * ticksPerSecond, 960 + 3 * ticksPerSecond, 96_000, 24_000],
    ]);
    const first = timeline.audio[0]!;
    expect(first.gain).toBeCloseTo(0.501187, 5);
    expect(first.key).toBe('clp_a#0');
    expect(first.clipLengthFrames).toBe(144_000);
    expect([first.fadeInFrames, first.fadeOutFrames]).toEqual([100, 200]);
    // Doubling the tempo halves tick lengths.
    const fast = buildTrackTimeline(T, [clip], { [a.id]: a }, 240);
    expect(fast.audio[0]!.endTick - fast.audio[0]!.startTick).toBe(2 * ticksPerSecond);
    expect(ticksToFrames(ticksPerSecond, 48_000, 120)).toBe(48_000);
  });

  it('skips muted audio clips and reports missing assets', () => {
    const clips = [
      audioClip('clp_m', 'trk_a', 'ast_x', 0, 100, { muted: true }),
      audioClip('clp_n', 'trk_a', 'ast_missing', 0, 100),
    ];
    const timeline = buildTrackTimeline(T, clips, {}, 120);
    expect(timeline.audio).toEqual([]);
    expect(timeline.missingAssets).toEqual(['ast_missing']);
    expect(audioClipEvents(clips[0]! as never, asset('ast_x', 100), 120)).toEqual([]);
    expect(audioClipEvents(clips[1]! as never, undefined, 120)).toEqual([]);
  });

  it('indexes every track of a project', () => {
    const p = project(
      [track('trk_a'), track('trk_b', 'audio')],
      [
        midiClip('clp_1', 'trk_a', 0, [note('n1', 0, 10)]),
        audioClip('clp_2', 'trk_b', 'ast_1', 0, 4800),
      ],
      [asset('ast_1', 4800)],
    );
    const index = buildTimelineIndex(p);
    expect([...index.keys()]).toEqual(['trk_a', 'trk_b']);
    expect(index.get(asTrackId('trk_a'))!.notes).toHaveLength(1);
    expect(index.get(asTrackId('trk_b'))!.audio).toHaveLength(1);
    // Tracks missing from trackOrder are still indexed.
    const orphan = { ...p, trackOrder: [] };
    expect([...buildTimelineIndex(orphan).keys()].sort()).toEqual(['trk_a', 'trk_b']);
  });
});
