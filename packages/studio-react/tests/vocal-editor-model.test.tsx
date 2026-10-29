import {
  DEFAULT_VOCAL_CORRECTION,
  asAssetId,
  asVocalNoteId,
  type MusicalKey,
  type VocalEditDoc,
  type VocalNoteId,
  type VocalNoteSegment,
} from '@studio/domain';
import { describe, expect, it, vi } from 'vitest';
import { TimeAxis } from '../src/canvas/time-axis';
import { pitchToY } from '../src/features/piano-roll/geometry';
import type { VocalActions } from '../src/features/vocal-editor/actions';
import {
  clipSourceWindow,
  fitVocalViewport,
  hitTestVocalNote,
  midiToY,
  sourceSecondsToTick,
  tickToSourceSeconds,
  vocalNoteRect,
  vocalNotesInRect,
  yToMidi,
  type ClipTimeMapping,
} from '../src/features/vocal-editor/geometry';
import { handleVocalKey } from '../src/features/vocal-editor/keys';
import { drawVocalEditor } from '../src/features/vocal-editor/renderer';
import {
  NO_KEY_VALUE,
  adjacentPair,
  centsFromNearest,
  chooseSplit,
  decodeKeyValue,
  describeNoteForScreenReader,
  displayTargetMidi,
  formatCents,
  formatSemitones,
  keyOptions,
  nudgeTargetMidi,
  pitchLabel,
  snapModeFor,
  snapTargetMidi,
  summarizeSelection,
} from '../src/features/vocal-editor/model';

const segment = (
  id: string,
  start: number,
  end: number,
  midi: number,
  confidence = 0.9,
): VocalNoteSegment => ({
  id: asVocalNoteId(id),
  startSeconds: start,
  endSeconds: end,
  detectedMidi: midi,
  confidence,
  vibratoDepthCents: 0,
  vibratoRateHz: 0,
  driftCents: 0,
});

const SEGMENTS = [
  segment('a', 0.1, 0.5, 56.7),
  segment('b', 0.6, 1.0, 60.2),
  segment('c', 1.1, 1.4, 63.85, 0.3),
];

function makeDoc(patch: Partial<VocalEditDoc> = {}): VocalEditDoc {
  return {
    assetId: asAssetId('ast_1'),
    analysisKey: 'k',
    algorithmVersion: 'v',
    segments: SEGMENTS,
    noteEdits: {},
    correction: DEFAULT_VOCAL_CORRECTION,
    enabled: true,
    keyCandidates: [
      { key: { tonic: 9, scale: 'naturalMinor' }, confidence: 0.62 },
      { key: { tonic: 0, scale: 'major' }, confidence: 0.31 },
    ],
    ...patch,
  };
}

const C_MAJOR: MusicalKey = { tonic: 0, scale: 'major' };

describe('vocal geometry', () => {
  const map: ClipTimeMapping = {
    startTick: 3840,
    sourceStartFrame: 22050,
    lengthFrames: 44100,
    sampleRate: 44100,
    bpm: 120,
  };

  it('maps source seconds to timeline ticks through the clip and back', () => {
    // Source 0.5 s is the clip start (sourceStartFrame = 0.5 s).
    expect(sourceSecondsToTick(0.5, map)).toBeCloseTo(3840, 9);
    // 120 bpm, 960 PPQ: one second = 1920 ticks.
    expect(sourceSecondsToTick(1.5, map)).toBeCloseTo(3840 + 1920, 9);
    for (const s of [0, 0.25, 0.5, 1.234, 7])
      expect(tickToSourceSeconds(sourceSecondsToTick(s, map), map)).toBeCloseTo(s, 9);
    expect(clipSourceWindow(map)).toEqual({ start: 0.5, end: 1.5 });
  });

  it('places fractional pitches on row centres', () => {
    const axis = { topPitch: 72.5, rowHeight: 12 };
    expect(midiToY(60, axis)).toBeCloseTo(pitchToY(60, axis) + 6, 9);
    expect(midiToY(60.5, axis)).toBeCloseTo(pitchToY(60, axis), 9); // boundary with C#4's row
    for (const m of [40, 60.25, 71.9]) expect(yToMidi(midiToY(m, axis), axis)).toBeCloseTo(m, 9);
  });

  it('builds note rects, hit-tests the topmost note and selects by marquee', () => {
    const time = new TimeAxis(0.1, 3840);
    const pitch = { topPitch: 72, rowHeight: 10 };
    const rects = SEGMENTS.map((s) =>
      vocalNoteRect(s, Math.round(s.detectedMidi), time, pitch, map),
    );
    const b = rects[1]!;
    expect(b.x).toBeCloseTo(time.tickToX(sourceSecondsToTick(0.6, map)), 9);
    expect(b.w).toBeCloseTo(0.4 * 1920 * 0.1, 6);
    expect(b.y + b.h / 2).toBeCloseTo(midiToY(60, pitch), 9);
    expect(hitTestVocalNote(rects, b.x + 2, b.y + b.h / 2)?.id).toBe('b');
    expect(hitTestVocalNote(rects, b.x + 2, b.y - 20)).toBeNull();
    const all = vocalNotesInRect(rects, { x0: -1000, y0: -1000, x1: 5000, y1: 5000 });
    expect(all).toEqual(['a', 'b', 'c']);
    expect(
      vocalNotesInRect(rects, { x0: b.x + b.w - 1, y0: b.y + 1, x1: b.x + 1, y1: b.y + 2 }),
    ).toEqual(['b']);
  });

  it('fits the clip horizontally and centres the sung range vertically', () => {
    const fit = fitVocalViewport({
      startTick: 1000,
      endTick: 3000,
      widthPx: 1000,
      heightPx: 200,
      rowHeight: 10,
      minMidi: 55,
      maxMidi: 65,
    });
    expect(fit.pxPerTick).toBeCloseTo(940 / 2000, 9);
    expect(fit.scrollTick).toBeCloseTo(1000 - 30 / fit.pxPerTick, 9);
    expect(fit.topPitch).toBe(70); // centre 60 + 20 visible rows / 2
    expect(
      fitVocalViewport({
        startTick: 0,
        endTick: 10,
        widthPx: 1,
        heightPx: 50,
        rowHeight: 10,
        minMidi: null,
        maxMidi: null,
      }).scrollTick,
    ).toBe(0);
  });
});

describe('vocal targets and snapping', () => {
  it('displays the auto target scaled by amount, manual targets fully, bypassed notes as sung', () => {
    const doc = makeDoc({ correction: { ...DEFAULT_VOCAL_CORRECTION, amount: 0.5 } });
    expect(displayTargetMidi(SEGMENTS[1]!, doc)).toBeCloseTo(60.1, 9);
    const withKey = makeDoc({
      correction: { ...DEFAULT_VOCAL_CORRECTION, amount: 1, key: C_MAJOR },
    });
    expect(displayTargetMidi(SEGMENTS[2]!, withKey)).toBe(64); // 63.85 → E (in C major)
    expect(displayTargetMidi(segment('x', 0, 1, 61.2), withKey)).toBe(62); // C#+20¢ → nearest scale note D
    const edited = makeDoc({
      noteEdits: {
        [asVocalNoteId('a')]: {
          targetMidi: 59,
          driftCorrection: 0,
          modulationScale: 1,
          transitionMs: 60,
          bypass: false,
        },
        [asVocalNoteId('b')]: {
          targetMidi: 62,
          driftCorrection: 0,
          modulationScale: 1,
          transitionMs: 60,
          bypass: true,
        },
      },
    });
    expect(displayTargetMidi(SEGMENTS[0]!, edited)).toBe(59);
    expect(displayTargetMidi(SEGMENTS[1]!, edited)).toBe(60.2);
  });

  it('snaps to semitones, scale degrees or whole cents', () => {
    expect(snapModeFor(null, false)).toBe('semitone');
    expect(snapModeFor({ tonic: 0, scale: 'chromatic' }, false)).toBe('semitone');
    expect(snapModeFor(C_MAJOR, false)).toBe('scale');
    expect(snapModeFor(C_MAJOR, true)).toBe('free');
    expect(snapTargetMidi(61.4, null, 'semitone')).toBe(61);
    expect(snapTargetMidi(61.4, C_MAJOR, 'scale')).toBe(62);
    expect(snapTargetMidi(61.237, C_MAJOR, 'free')).toBe(61.24);
    expect(snapTargetMidi(130, null, 'semitone')).toBe(127);
    expect(snapTargetMidi(-3, C_MAJOR, 'free')).toBe(0);
  });

  it('nudges to the next semitone or by 10 cents', () => {
    expect(nudgeTargetMidi(60.3, 1, false)).toBe(61);
    expect(nudgeTargetMidi(60.3, -1, false)).toBe(60);
    expect(nudgeTargetMidi(60, 1, false)).toBe(61);
    expect(nudgeTargetMidi(60, -1, false)).toBe(59);
    expect(nudgeTargetMidi(60, 1, true)).toBe(60.1);
    expect(nudgeTargetMidi(60.05, -1, true)).toBe(59.95);
    expect(nudgeTargetMidi(127, 1, false)).toBe(127);
  });

  it('formats cents, pitches and offsets', () => {
    expect(centsFromNearest(56.7)).toBe(-30);
    expect(formatCents(-30)).toBe('−30¢');
    expect(formatCents(12)).toBe('+12¢');
    expect(formatCents(0)).toBe('±0¢');
    expect(pitchLabel(60.2)).toBe('C4 +20¢');
    expect(formatSemitones(2.14)).toBe('+2 st 14¢');
    expect(formatSemitones(-0.3)).toBe('−30¢');
    expect(formatSemitones(0)).toBe('unchanged');
  });

  it('describes notes and the selection for screen readers', () => {
    const doc = makeDoc();
    expect(describeNoteForScreenReader(SEGMENTS[0]!, doc)).toBe(
      'A3, 30 cents flat, automatic target A3 −30¢',
    );
    expect(summarizeSelection([], doc)).toBe('3 notes, none selected.');
    expect(summarizeSelection([SEGMENTS[1]!], doc)).toBe(
      'Selected note: C4, 20 cents sharp, automatic target C4 +20¢.',
    );
    expect(summarizeSelection(SEGMENTS, doc)).toBe('3 notes selected.');
  });
});

describe('key choices', () => {
  it('lists suggestions with confidence first, then chromatic and all major/minor keys', () => {
    const doc = makeDoc({
      correction: { ...DEFAULT_VOCAL_CORRECTION, key: { tonic: 9, scale: 'naturalMinor' } },
    });
    const { options, value } = keyOptions(doc.keyCandidates, doc.correction.key);
    expect(options[0]).toEqual({ value: 's:9:naturalMinor', label: 'A Minor · 62%' });
    expect(options[1]?.label).toBe('C Major · 31%');
    expect(options[2]).toEqual({ value: NO_KEY_VALUE, label: 'Chromatic (no key)' });
    expect(options[3]?.disabled).toBe(true);
    expect(options).toHaveLength(2 + 1 + 1 + 24);
    expect(value).toBe('s:9:naturalMinor');
    expect(new Set(options.map((o) => o.value)).size).toBe(options.length);
  });

  it('selects chromatic, plain keys and appends custom scales', () => {
    expect(keyOptions([], null).value).toBe(NO_KEY_VALUE);
    expect(keyOptions([], { tonic: 2, scale: 'major' }).value).toBe('k:2:major');
    const custom = keyOptions([], { tonic: 4, scale: 'dorian' });
    expect(custom.value).toBe('c:4:dorian');
    expect(custom.options.at(-1)).toEqual({ value: 'c:4:dorian', label: 'E Dorian' });
  });

  it('decodes option values', () => {
    expect(decodeKeyValue('s:9:naturalMinor')).toEqual({ tonic: 9, scale: 'naturalMinor' });
    expect(decodeKeyValue('c:4:dorian')).toEqual({ tonic: 4, scale: 'dorian' });
    expect(decodeKeyValue(NO_KEY_VALUE)).toBeNull();
    expect(decodeKeyValue('k:12:major')).toBeNull();
    expect(decodeKeyValue('k:1:nope')).toBeNull();
  });
});

describe('split and merge rules', () => {
  const ids = (...names: string[]) => new Set<VocalNoteId>(names.map(asVocalNoteId));

  it('merges only exactly two neighbouring notes', () => {
    expect(adjacentPair(SEGMENTS, ids('a', 'b'))?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(adjacentPair([SEGMENTS[2]!, SEGMENTS[1]!], ids('b', 'c'))?.map((s) => s.id)).toEqual([
      'b',
      'c',
    ]);
    expect(adjacentPair(SEGMENTS, ids('a', 'c'))).toBeNull();
    expect(adjacentPair(SEGMENTS, ids('a'))).toBeNull();
    expect(adjacentPair(SEGMENTS, ids('a', 'b', 'c'))).toBeNull();
  });

  it('splits a selected note at the playhead, else at the pointer', () => {
    expect(chooseSplit(SEGMENTS, ids('b'), [0.8, 0.3])).toEqual({
      segment: SEGMENTS[1],
      atSeconds: 0.8,
    });
    expect(chooseSplit(SEGMENTS, ids('a'), [0.8, 0.3])).toEqual({
      segment: SEGMENTS[0],
      atSeconds: 0.3,
    });
    expect(chooseSplit(SEGMENTS, ids('a'), [0.8, null])).toBeNull();
    expect(chooseSplit(SEGMENTS, ids('b'), [0.605])).toBeNull(); // too close to the edge
    expect(chooseSplit(SEGMENTS, ids(), [0.8])).toBeNull();
  });
});

describe('vocal canvas renderer', () => {
  /** Records method calls; property writes are accepted silently. */
  function recordingContext() {
    const calls: string[] = [];
    const target: Record<string, unknown> = {};
    const ctx = new Proxy(target, {
      get(_t, prop: string) {
        if (prop in target) return target[prop];
        if (prop === 'measureText') return (text: string) => ({ width: text.length * 6 });
        return (...args: unknown[]) => {
          calls.push(prop === 'setLineDash' ? `setLineDash:${JSON.stringify(args[0])}` : prop);
        };
      },
      set(_t, prop: string, value) {
        target[prop] = value;
        return true;
      },
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it('draws notes, contours, bands and labels without touching React', () => {
    const map: ClipTimeMapping = {
      startTick: 0,
      sourceStartFrame: 0,
      lengthFrames: 66150,
      sampleRate: 44100,
      bpm: 120,
    };
    const time = new TimeAxis(0.2, 0);
    const pitch = { topPitch: 72, rowHeight: 12 };
    const doc = makeDoc({
      correction: { ...DEFAULT_VOCAL_CORRECTION, key: C_MAJOR, amount: 0.5 },
      noteEdits: {
        [asVocalNoteId('a')]: {
          targetMidi: 57,
          driftCorrection: 0,
          modulationScale: 1,
          transitionMs: 60,
          bypass: false,
        },
        [asVocalNoteId('b')]: {
          driftCorrection: 0,
          modulationScale: 1,
          transitionMs: 60,
          bypass: true,
        },
      },
    });
    const notes = SEGMENTS.map((s) => {
      const displayMidi = displayTargetMidi(s, doc);
      return {
        segment: s,
        displayMidi,
        moved: s.id === 'a',
        bypassed: s.id === 'b',
        rect: vocalNoteRect(s, displayMidi, time, pitch, map),
      };
    });
    const frames = 300;
    const detected = Float64Array.from({ length: frames }, (_, i) =>
      i % 50 < 40 ? 60 + Math.sin(i / 5) * 0.3 : Number.NaN,
    );
    const { ctx, calls } = recordingContext();
    drawVocalEditor(ctx, 800, 300, {
      time,
      pitch,
      meter: { numerator: 4, denominator: 4 },
      map,
      notes,
      selected: new Set([asVocalNoteId('a')]),
      hovered: asVocalNoteId('c'),
      marquee: { x0: 10, y0: 10, x1: 50, y1: 40 },
      track: { firstFrameSeconds: 0, hopSeconds: 0.005, frameCount: frames },
      detected,
      target: Float32Array.from(detected, (m) => (Number.isFinite(m) ? Math.round(m) : Number.NaN)),
      nonPitched: [
        { startSeconds: 0.5, endSeconds: 0.6, kind: 'breath' },
        { startSeconds: 1.0, endSeconds: 1.1, kind: 'silence' },
      ],
      scalePitchClasses: new Set([0, 2, 4, 5, 7, 9, 11]),
      tonic: 0,
      correctionAudible: true,
    });
    expect(calls).toContain('setLineDash:[3,3]'); // ghost of the moved note
    expect(calls).toContain('setLineDash:[3,2]'); // low-confidence note c
    expect(calls).toContain('clip'); // hatch of the bypassed note
    expect(calls.filter((c) => c === 'fillText')).toHaveLength(2); // selected a + hovered c
    expect(calls).toContain('strokeRect'); // marquee
  });
});

describe('vocal editor keyboard', () => {
  function fakeActions(selected: number): VocalActions {
    return {
      doc: vi.fn(),
      selection: () => new Set(Array.from({ length: selected }, (_, i) => asVocalNoteId(`n${i}`))),
      select: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
      nudge: vi.fn(() => true),
      resetSelected: vi.fn(() => true),
      clearTargets: vi.fn(() => true),
      patchSelected: vi.fn(() => true),
      split: vi.fn(() => true),
      merge: vi.fn(() => true),
    };
  }
  const key = (
    k: string,
    mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
  ) => ({
    key: k,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  });

  it('maps keys to note actions', () => {
    const actions = fakeActions(1);
    const times = () => [1.2, null];
    expect(handleVocalKey(key('ArrowUp'), actions, times)).toBe(true);
    expect(actions.nudge).toHaveBeenLastCalledWith(1, false);
    expect(handleVocalKey(key('ArrowDown', { shiftKey: true }), actions, times)).toBe(true);
    expect(actions.nudge).toHaveBeenLastCalledWith(-1, true);
    expect(handleVocalKey(key('Backspace'), actions, times)).toBe(true);
    expect(actions.resetSelected).toHaveBeenCalled();
    expect(handleVocalKey(key('s'), actions, times)).toBe(true);
    expect(actions.split).toHaveBeenCalledWith([1.2, null]);
    expect(handleVocalKey(key('M'), actions, times)).toBe(true);
    expect(actions.merge).toHaveBeenCalled();
    expect(handleVocalKey(key('a', { ctrlKey: true }), actions, times)).toBe(true);
    expect(actions.selectAll).toHaveBeenCalled();
    expect(handleVocalKey(key('Escape'), actions, times)).toBe(true);
    expect(actions.clearSelection).toHaveBeenCalled();
  });

  it('lets unrelated keys and empty-selection arrows through', () => {
    const actions = fakeActions(0);
    const times = () => [];
    expect(handleVocalKey(key('ArrowUp'), actions, times)).toBe(false);
    expect(handleVocalKey(key('Escape'), actions, times)).toBe(false);
    expect(handleVocalKey(key(' '), actions, times)).toBe(false);
    expect(handleVocalKey(key('s', { ctrlKey: true }), actions, times)).toBe(false);
    // Delete is always consumed so it never deletes the clip behind the editor.
    expect(handleVocalKey(key('Delete'), actions, times)).toBe(true);
  });
});
