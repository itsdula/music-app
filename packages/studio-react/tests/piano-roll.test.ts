import { asClipId, asNoteId, asTrackId, createMidiClip, type MidiNote } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { TimeAxis } from '../src/canvas/time-axis';
import { contentToTimeline, pitchToY, timelineToContent, yToPitch } from '../src/features/piano-roll/geometry';
import { hitTestNote, notesInRect } from '../src/features/piano-roll/hit-test';
import { moveNotes, nudgeNotes, resizeNoteEnds, resizeNoteStarts, scaleVelocities } from '../src/features/piano-roll/note-edits';

const note = (id: string, startTick: number, pitch: number, durationTicks = 480, velocity = 100): MidiNote => ({
  id: asNoteId(id),
  startTick,
  pitch,
  durationTicks,
  velocity,
});

const clip = createMidiClip({
  id: asClipId('c1'),
  trackId: asTrackId('t1'),
  startTick: 3840,
  lengthTicks: 3840,
  notes: [note('a', 0, 60), note('b', 480, 64), note('c', 960, 67, 960)],
});

describe('pitch axis', () => {
  it('maps rows and back for integer and fractional scroll', () => {
    for (const topPitch of [84, 84.5, 100.25]) {
      const axis = { topPitch, rowHeight: 12 };
      for (let p = 40; p < 84; p++) {
        const y = pitchToY(p, axis);
        expect(yToPitch(y + 0.01, axis)).toBe(p);
        expect(yToPitch(y + 11.99, axis)).toBe(p);
      }
    }
  });

  it('converts between content and timeline ticks', () => {
    const shifted = { ...clip, contentOffsetTicks: 480 };
    expect(contentToTimeline(shifted, 480)).toBe(3840);
    expect(timelineToContent(shifted, contentToTimeline(shifted, 1234))).toBe(1234);
  });
});

describe('hit testing', () => {
  const time = new TimeAxis(0.1, 3840);
  const pitch = { topPitch: 72, rowHeight: 10 };

  it('finds note bodies and edges', () => {
    const y = pitchToY(64, pitch) + 5;
    const x0 = time.tickToX(contentToTimeline(clip, 480));
    expect(hitTestNote(clip, time, pitch, x0 + 20, y)).toMatchObject({ note: { id: 'b' }, region: 'body' });
    expect(hitTestNote(clip, time, pitch, x0 + 47, y)?.region).toBe('end-edge');
    expect(hitTestNote(clip, time, pitch, x0 + 1, y)?.region).toBe('start-edge');
    expect(hitTestNote(clip, time, pitch, x0 + 20, y + 10)).toBeNull();
  });

  it('selects notes intersecting a marquee', () => {
    const ids = notesInRect(clip, time, pitch, { x0: 0, y0: 0, x1: time.tickToX(contentToTimeline(clip, 500)), y1: 400 });
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});

describe('note edits', () => {
  const all = new Set(clip.notes.map((n) => n.id));

  it('moves a group snapping the anchor and preserving offsets', () => {
    const patches = moveNotes(clip, all, asNoteId('b'), 130, 2, { gridTicks: 240 });
    expect(patches.find((p) => p.id === 'b')).toMatchObject({ startTick: 720, pitch: 66 });
    expect(patches.find((p) => p.id === 'a')).toMatchObject({ startTick: 240, pitch: 62 });
  });

  it('clamps group moves at time zero and pitch bounds without distorting chords', () => {
    // Already at time zero: a further left move is a no-op.
    expect(moveNotes(clip, all, asNoteId('a'), -10_000, 0, { gridTicks: 0 })).toEqual([]);
    const later = new Set([asNoteId('b'), asNoteId('c')]);
    const left = moveNotes(clip, later, asNoteId('b'), -10_000, 0, { gridTicks: 0 });
    expect(left).toEqual([
      { id: 'b', startTick: 0, pitch: 64 },
      { id: 'c', startTick: 480, pitch: 67 },
    ]);
    const up = moveNotes(clip, all, asNoteId('a'), 0, 100, { gridTicks: 0 });
    expect(up.map((p) => p.pitch)).toEqual([120, 124, 127]);
  });

  it('resizes ends with snapping and minimum length', () => {
    const patches = resizeNoteEnds(clip, new Set([asNoteId('a')]), asNoteId('a'), 100, { gridTicks: 240 });
    expect(patches).toEqual([{ id: 'a', durationTicks: 480 }]);
    const shrink = resizeNoteEnds(clip, new Set([asNoteId('a')]), asNoteId('a'), -2000, { gridTicks: 240 });
    expect(shrink[0]!.durationTicks).toBe(240);
  });

  it('resizes starts keeping ends fixed', () => {
    const patches = resizeNoteStarts(clip, new Set([asNoteId('c')]), asNoteId('c'), 250, { gridTicks: 240 });
    expect(patches).toEqual([{ id: 'c', startTick: 1200, durationTicks: 720 }]);
  });

  it('scales velocities within MIDI range', () => {
    expect(scaleVelocities(clip, new Set([asNoteId('a')]), 50)).toEqual([{ id: 'a', velocity: 127 }]);
    expect(scaleVelocities(clip, new Set([asNoteId('a')]), -500)).toEqual([{ id: 'a', velocity: 1 }]);
  });

  it('nudges selected notes and returns nothing when blocked', () => {
    expect(nudgeNotes(clip, new Set([asNoteId('a')]), -240, 0)).toEqual([]);
    expect(nudgeNotes(clip, new Set([asNoteId('b')]), 240, -12)).toEqual([{ id: 'b', startTick: 720, pitch: 52 }]);
  });
});
