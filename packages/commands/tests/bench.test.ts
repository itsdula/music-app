/**
 * Micro-benchmarks (informational, not a gate): timings are logged, and assertions only
 * check correctness and structural sharing so the test is stable on slow machines.
 */
import { performance } from 'node:perf_hooks';
import {
  asClipId,
  asNoteId,
  createMidiClip,
  createTrack,
  asTrackId,
  type MidiClip,
  type MidiNote,
  type Project,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { applyCommand, createHistory, type NotePatch } from '../src';
import { deepFreeze, makeProject } from './fixtures';

function bigClipProject(noteCount: number): Project {
  const base = makeProject();
  const notes: MidiNote[] = Array.from({ length: noteCount }, (_, i) => ({
    id: asNoteId(`n${i}`),
    startTick: i * 120,
    durationTicks: 100,
    pitch: 36 + (i % 48),
    velocity: 90,
  }));
  const clip = createMidiClip({
    id: asClipId('big'),
    trackId: base.trackOrder[0]!,
    startTick: 0,
    lengthTicks: noteCount * 120,
    notes,
  });
  return deepFreeze({ ...base, clips: { ...base.clips, [clip.id]: clip } });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

describe('benchmarks', () => {
  it('notes.update: 1,000 notes in a 5,000-note clip', () => {
    const project = bigClipProject(5000);
    const clip = project.clips[asClipId('big')] as MidiClip;
    // Every 5th note moves by a beat and changes velocity; the moves force a re-sort.
    const patches: NotePatch[] = clip.notes
      .filter((_, i) => i % 5 === 0)
      .map((n) => ({ id: n.id, startTick: n.startTick + 960, velocity: 64 }));
    expect(patches).toHaveLength(1000);

    const timings: number[] = [];
    let result = project;
    for (let i = 0; i < 25; i++) {
      const t0 = performance.now();
      result = applyCommand(project, { type: 'notes.update', clipId: clip.id, patches });
      timings.push(performance.now() - t0);
    }
    const updated = result.clips[clip.id] as MidiClip;
    expect(updated.notes).toHaveLength(5000);
    const original = new Set(clip.notes);
    expect(updated.notes.filter((n) => original.has(n)).length).toBe(4000); // untouched notes shared
    for (let i = 1; i < updated.notes.length; i++) {
      expect(updated.notes[i]!.startTick).toBeGreaterThanOrEqual(updated.notes[i - 1]!.startTick);
    }
    console.log(
      `[bench] notes.update 1000/5000 notes: median ${median(timings).toFixed(2)} ms, ` +
        `min ${Math.min(...timings).toFixed(2)} ms, max ${Math.max(...timings).toFixed(2)} ms (25 runs)`,
    );
  });

  it('200-entry undo stack shares structure between snapshots', () => {
    // 16 tracks x 12 clips x 50 notes = 9,600 notes.
    const base = makeProject();
    const tracks: Project['tracks'] = { ...base.tracks };
    const clips: Record<string, MidiClip> = {};
    const order = [...base.trackOrder];
    for (let t = 0; t < 16; t++) {
      const track = createTrack({ id: asTrackId(`bt${t}`), kind: 'instrument', index: t });
      (tracks as Record<string, typeof track>)[track.id] = track;
      order.push(track.id);
      for (let c = 0; c < 12; c++) {
        const notes = Array.from({ length: 50 }, (_, i) => ({
          id: asNoteId(`n${i}`),
          startTick: i * 240,
          durationTicks: 200,
          pitch: 48 + (i % 24),
          velocity: 100,
        }));
        const clip = createMidiClip({
          id: asClipId(`bc${t}_${c}`),
          trackId: track.id,
          startTick: c * 15_360,
          lengthTicks: 15_360,
          notes,
        });
        clips[clip.id] = clip;
      }
    }
    const initial = deepFreeze({
      ...base,
      tracks,
      trackOrder: order,
      clips: { ...base.clips, ...clips },
    });
    const clipIds = Object.keys(clips).map(asClipId);

    const heapBefore = process.memoryUsage().heapUsed;
    const history = createHistory(initial);
    const t0 = performance.now();
    for (let i = 0; i < 250; i++) {
      if (i % 2 === 0) {
        history.execute({
          type: 'track.setMixer',
          trackId: asTrackId(`bt${i % 16}`),
          mixer: { gainDb: -(i % 40) - 1 },
        });
      } else {
        const clipId = clipIds[(i * 7) % clipIds.length]!;
        history.execute({
          type: 'notes.update',
          clipId,
          patches: [{ id: asNoteId(`n${i % 50}`), velocity: 1 + (i % 120) }],
        });
      }
    }
    const elapsed = performance.now() - t0;
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    const { undo } = history.entries();
    expect(undo).toHaveLength(200);
    // Count distinct clip and note-array objects reachable from all retained snapshots.
    const clipObjects = new Set<unknown>();
    const noteArrays = new Set<unknown>();
    for (const entry of undo) {
      for (const root of [entry.before, entry.after]) {
        for (const clip of Object.values(root.clips)) {
          clipObjects.add(clip);
          if (clip.kind === 'midi') noteArrays.add(clip.notes);
        }
      }
    }
    const clipCount = Object.keys(initial.clips).length;
    // Without sharing this would be ~400 snapshots x 194 clips = 77,600 objects.
    expect(clipObjects.size).toBeLessThanOrEqual(clipCount + 125);
    expect(noteArrays.size).toBeLessThanOrEqual(clipCount + 125);
    while (history.undo());
    expect(history.present).not.toBe(initial); // oldest 50 entries were dropped
    console.log(
      `[bench] 250 executes (200 retained): ${elapsed.toFixed(1)} ms total; ` +
        `${clipObjects.size} distinct clip objects across ${undo.length * 2} snapshots ` +
        `(${clipCount} clips per snapshot); heap delta ~${(heapDelta / 1024 / 1024).toFixed(1)} MiB (no forced GC)`,
    );
  });
});
