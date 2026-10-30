import { applyCommand } from '@studio/commands';
import {
  asClipId,
  asNoteId,
  asProjectId,
  asTrackId,
  clipEndTick,
  createEmptyProject,
  createMidiClip,
  createTrack,
  type MidiClip,
  type Project,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { TimeAxis } from '../src/canvas/time-axis';
import { loopExtendCommands } from '../src/features/arrangement/clip-gestures';
import {
  CLIP_HEADER_HEIGHT,
  clipBoxes,
  hitTestClip,
  layoutRows,
} from '../src/features/arrangement/geometry';
import { fitPitchAxis, pitchToY, visibleRowCount } from '../src/features/piano-roll/geometry';
import { hitTestNote } from '../src/features/piano-roll/hit-test';
import { isClipLooping, setClipLoopCommand } from '../src/lib/clip-commands';
import { revealClipInEditor, showClipOnSelect } from '../src/lib/editor-navigation';
import { createUiStore } from '../src/state/ui-store';

const trackId = asTrackId('t1');

function projectWith(clips: MidiClip[]): Project {
  let project = createEmptyProject({ id: asProjectId('p'), now: '2026-10-29T00:00:00.000Z' });
  project = applyCommand(project, {
    type: 'track.add',
    track: createTrack({ id: trackId, kind: 'instrument', index: 0 }),
  });
  return clips.length > 0 ? applyCommand(project, { type: 'clip.add', clips }) : project;
}

describe('arrangement clip hit zones', () => {
  // 0.05 px per tick: a 960-tick beat is 48 px, a 3840-tick bar is 192 px.
  const axis = new TimeAxis(0.05, 0);
  const long = createMidiClip({ id: asClipId('long'), trackId, startTick: 0, lengthTicks: 3840 });
  const short = createMidiClip({
    id: asClipId('short'),
    trackId,
    startTick: 7680,
    lengthTicks: 80,
  });
  const project = projectWith([long, short]);
  const rows = layoutRows([project.tracks[trackId]!], 64, 0);
  const boxes = clipBoxes(project, rows, axis, 2000, 400);
  const lower = 2 + CLIP_HEADER_HEIGHT + 10;

  it('reports body, trim edges and the loop handle (top-right corner)', () => {
    expect(hitTestClip(boxes, 96, lower)?.region).toBe('body');
    expect(hitTestClip(boxes, 1, lower)?.region).toBe('start-edge');
    expect(hitTestClip(boxes, 190, lower)?.region).toBe('end-edge');
    expect(hitTestClip(boxes, 190, 6)?.region).toBe('loop-end');
    expect(hitTestClip(boxes, 1, 6)?.region).toBe('start-edge');
  });

  it('keeps edges grabbable on a 4 px clip, including just outside it', () => {
    const box = boxes.find((b) => b.clip.id === 'short')!;
    expect(box.w).toBe(4);
    expect(hitTestClip(boxes, box.x - 3, lower)).toMatchObject({
      box: { clip: { id: 'short' } },
      region: 'start-edge',
    });
    expect(hitTestClip(boxes, box.x + box.w + 3, lower)?.region).toBe('end-edge');
    expect(hitTestClip(boxes, box.x + box.w / 2, lower)?.region).toBe('body');
    expect(hitTestClip(boxes, box.x + box.w + 6, lower)).toBeNull();
  });

  it('prefers the clip under the pointer over a neighbour edge slop', () => {
    // Just inside the long clip's end: its own end edge, not empty space.
    expect(hitTestClip(boxes, 191, lower)?.box.clip.id).toBe('long');
    expect(hitTestClip(boxes, 193, lower)?.box.clip.id).toBe('long'); // slop
    expect(hitTestClip(boxes, 400, lower)).toBeNull();
  });
});

describe('loop handle drag', () => {
  const clip = createMidiClip({
    id: asClipId('c'),
    trackId,
    startTick: 0,
    lengthTicks: 3840,
    notes: [{ id: asNoteId('n'), startTick: 0, durationTicks: 480, pitch: 60, velocity: 100 }],
  });
  const project = projectWith([clip]);

  it('turns looping on and extends the clip when dragged past the end (one gesture)', () => {
    const commands = loopExtendCommands(project, clip.id, 3840 * 2 + 50, 240);
    expect(commands.map((c) => c.type)).toEqual(['clip.updateMidi', 'clip.trimEnd']);
    const next = commands.reduce(applyCommand, project);
    const extended = next.clips[clip.id] as MidiClip;
    expect(extended.loopLengthTicks).toBe(3840);
    expect(clipEndTick(extended, next)).toBe(7680);
  });

  it('only trims when shortening, and is a no-op at the current end', () => {
    expect(loopExtendCommands(project, clip.id, 1920, 0).map((c) => c.type)).toEqual([
      'clip.trimEnd',
    ]);
    expect(loopExtendCommands(project, clip.id, 3840, 0)).toEqual([]);
  });

  it('toggles looping with the visible content as the loop', () => {
    const trimmed = { ...clip, contentOffsetTicks: 480, lengthTicks: 1920 };
    expect(setClipLoopCommand(trimmed, true)).toEqual({
      type: 'clip.updateMidi',
      clipId: clip.id,
      patch: { loopLengthTicks: 2400 },
    });
    expect(setClipLoopCommand(trimmed, false)).toBeNull();
    expect(isClipLooping({ ...clip, loopLengthTicks: 960 })).toBe(true);
  });
});

describe('piano roll vertical fit', () => {
  it('shows at least two octaves centred on C4 for an empty clip', () => {
    const axis = fitPitchAxis([], 200);
    expect(visibleRowCount(200, axis.rowHeight)).toBeGreaterThanOrEqual(25);
    const center = pitchToY(60, axis) + axis.rowHeight / 2;
    expect(Math.abs(center - 100)).toBeLessThanOrEqual(axis.rowHeight);
  });

  it('fits the note range with margin and a row height within bounds', () => {
    const axis = fitPitchAxis([48, 50, 79], 600);
    expect(axis.rowHeight).toBeGreaterThanOrEqual(7);
    expect(axis.rowHeight).toBeLessThanOrEqual(16);
    expect(pitchToY(79, axis)).toBeGreaterThanOrEqual(0);
    expect(pitchToY(48, axis) + axis.rowHeight).toBeLessThanOrEqual(600);
  });

  it('uses larger rows when there is room and the compact minimum when there is not', () => {
    expect(fitPitchAxis([60, 64], 800).rowHeight).toBe(16);
    expect(fitPitchAxis([60, 64], 120).rowHeight).toBe(7);
  });
});

describe('note hit zones', () => {
  const clip = createMidiClip({
    id: asClipId('c'),
    trackId,
    startTick: 0,
    lengthTicks: 3840,
    notes: [{ id: asNoteId('tiny'), startTick: 960, durationTicks: 60, pitch: 60, velocity: 100 }],
  });
  const time = new TimeAxis(0.1, 0); // the note is 6 px wide at x = 96
  const pitch = { topPitch: 72, rowHeight: 10 };
  const y = pitchToY(60, pitch) + 5;

  it('keeps both edges of a short note resizable', () => {
    expect(hitTestNote(clip, time, pitch, 94, y)?.region).toBe('start-edge');
    expect(hitTestNote(clip, time, pitch, 103, y)?.region).toBe('end-edge');
    expect(hitTestNote(clip, time, pitch, 99, y)?.region).toBe('body');
    expect(hitTestNote(clip, time, pitch, 110, y)).toBeNull();
  });
});

describe('opening clips in the editor', () => {
  const clipId = asClipId('c');

  it('a selection click shows the clip without leaving the Mixer tab', () => {
    const store = createUiStore();
    store.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel: 'mixer' } }));
    store.setState((s) => showClipOnSelect(s, clipId));
    expect(store.getState().selection.editorClipId).toBe(clipId);
    expect(store.getState().panels.bottomPanel).toBe('mixer');
  });

  it('a selection click keeps the Track tab, so the track devices stay in view', () => {
    const store = createUiStore();
    store.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel: 'track' } }));
    store.setState((s) => showClipOnSelect(s, clipId));
    expect(store.getState().selection.editorClipId).toBe(clipId);
    expect(store.getState().panels.bottomPanel).toBe('track');
  });

  it('a selection click opens a hidden bottom panel on the clip tab', () => {
    const store = createUiStore();
    store.setState((s) => ({
      ...s,
      panels: { ...s.panels, bottomOpen: false, bottomPanel: 'mixer' },
    }));
    store.setState((s) => showClipOnSelect(s, clipId));
    expect(store.getState().panels).toMatchObject({ bottomOpen: true, bottomPanel: 'clip' });
  });

  it('an explicit open always reveals the clip tab', () => {
    const store = createUiStore();
    store.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel: 'controller' } }));
    store.setState((s) => revealClipInEditor(s, clipId));
    expect(store.getState().panels).toMatchObject({ bottomOpen: true, bottomPanel: 'clip' });
  });
});
