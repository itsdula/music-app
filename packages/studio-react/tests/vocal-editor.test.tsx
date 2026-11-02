import { encodeWav } from '@studio/audio-dsp';
import type * as Commands from '@studio/commands';
import { nearestScaleNote, secondsToTicks, type AssetId, type VocalEditDoc } from '@studio/domain';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
// Test-only fixtures (not a runtime dependency of @studio/react).
import { melodyF0, synthesizeVowel } from '../../test-fixtures/src/index';
import { TimeAxis } from '../src/canvas/time-axis';
import { midiToY, vocalNoteRect } from '../src/features/vocal-editor/geometry';
import { displayTargetMidi } from '../src/features/vocal-editor/model';
import { Studio } from '../src/Studio';
import type * as UiStoreModule from '../src/state/ui-store';
import type { UiStore } from '../src/state/ui-store';
import { createTestPlatform } from './helpers/test-platform';
import { startEmptyProject } from './helpers/start';

// Capture the session's history so tests can assert recorded commands.
const captured = vi.hoisted(() => ({
  history: null as Commands.CommandHistory | null,
  uiStore: null as UiStore | null,
}));
vi.mock('@studio/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof Commands>();
  return {
    ...actual,
    createHistory: (...args: Parameters<typeof actual.createHistory>) => {
      const history = actual.createHistory(...args);
      captured.history = history;
      return history;
    },
  };
});

vi.mock('../src/state/ui-store', async (importOriginal) => {
  const actual = await importOriginal<typeof UiStoreModule>();
  return {
    ...actual,
    createUiStore: (...args: Parameters<typeof actual.createUiStore>) => {
      const store = actual.createUiStore(...args);
      captured.uiStore = store;
      return store;
    },
  };
});

const SAMPLE_RATE = 22050;
let wavBytes: Uint8Array;

beforeAll(() => {
  // Three sung notes (A3 −30¢, C4 +20¢, E4 −15¢) separated by short rests, 1.5 s total.
  const f0 = melodyF0(
    [
      { midi: 57, startSeconds: 0.1, durationSeconds: 0.38 },
      { midi: 60, startSeconds: 0.58, durationSeconds: 0.38 },
      { midi: 64, startSeconds: 1.06, durationSeconds: 0.36 },
    ],
    { detuneCents: [-30, 20, -15] },
  );
  const pcm = synthesizeVowel({
    sampleRate: SAMPLE_RATE,
    durationSeconds: 1.5,
    f0,
    vowel: 'a',
    seed: 7,
  });
  wavBytes = encodeWav(
    { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice()) },
    { bitDepth: 16 },
  );
});

function history(): Commands.CommandHistory {
  if (!captured.history) throw new Error('history not captured');
  return captured.history;
}

function uiStore(): UiStore {
  if (!captured.uiStore) throw new Error('ui store not captured');
  return captured.uiStore;
}

function vocalDoc(): VocalEditDoc {
  const docs = Object.values(history().present.vocalEdits);
  expect(docs).toHaveLength(1);
  return docs[0]!;
}

async function openAnalyzedVocal() {
  const user = userEvent.setup();
  const platform = createTestPlatform();
  render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
  await waitFor(
    () =>
      expect(screen.getByTestId('studio-root').getAttribute('data-studio-status')).toBe('ready'),
    {
      timeout: 5000,
    },
  );
  await startEmptyProject();

  // Import through the browser panel (the platform's file picker returns our WAV).
  platform.pickFiles = [{ name: 'Lead Vox.wav', mimeType: 'audio/wav', bytes: wavBytes }];
  await user.click(screen.getByTestId('import-audio'));
  await waitFor(() => expect(Object.values(history().present.clips)).toHaveLength(1));
  const assetId = Object.keys(history().present.assets)[0] as AssetId;

  // Open the imported (selected) clip with Enter in the arrangement, then the Pitch editor.
  act(() => screen.getByTestId('arrangement-lanes').focus());
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('radio', { name: 'Pitch (vocal)' }));
  expect(screen.getByText('Pitch-correct this vocal')).toBeTruthy();

  await user.click(screen.getByRole('button', { name: /Analyze vocal/ }));
  await waitFor(
    () => expect(screen.getByTestId('vocal-editor').getAttribute('data-state')).toBe('ready'),
    {
      timeout: 20_000,
    },
  );
  return { user, platform, assetId };
}

describe('vocal pitch editor', () => {
  it('analyzes an imported vocal, edits notes and toggles A/B', { timeout: 40_000 }, async () => {
    const { user, platform, assetId } = await openAnalyzedVocal();
    const doc = vocalDoc();
    expect(doc.assetId).toBe(assetId);
    expect(doc.segments).toHaveLength(3);
    expect(doc.keyCandidates.length).toBeGreaterThan(0);

    // Key picker shows the top-ranked candidate with its confidence.
    const keyTrigger = within(screen.getByTestId('vocal-key')).getByRole('combobox', {
      name: 'Key and scale',
    });
    expect(keyTrigger.textContent).toMatch(/^[A-G][#b]? \w.* · \d+%$/);

    // Notes list: one row per detected note, with note names.
    await user.click(screen.getByTestId('vocal-notes-list-toggle'));
    const rows = screen.getAllByTestId('vocal-note-row');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.children[3]!.textContent)).toEqual(['A3', 'C4', 'E4']);

    // Auto Tune amount: one keyboard step on the slider records a vocal.setCorrection entry.
    const amount = within(screen.getByTestId('vocal-amount')).getByRole('slider', {
      name: 'Auto Tune',
    });
    act(() => amount.focus());
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(vocalDoc().correction.amount).toBeCloseTo(0.01, 5));
    const last = history().entries().undo.at(-1)!;
    expect(last.label).toBe('Auto Tune Amount');
    expect(last.commands.map((c) => c.type)).toEqual(['vocal.setCorrection']);

    // Move the second note up a semitone from the keyboard.
    await user.click(rows[1]!);
    await waitFor(() => expect(rows[1]!.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByTestId('vocal-live').textContent).toContain(
      'Selected note: C4, 20 cents sharp',
    );
    await user.keyboard('{ArrowUp}');
    const second = vocalDoc().segments[1]!;
    expect(vocalDoc().noteEdits[second.id]?.targetMidi).toBe(61);
    expect(history().entries().undo.at(-1)!.commands[0]!.type).toBe('vocal.setNoteEdits');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(vocalDoc().noteEdits[second.id]?.targetMidi).toBeCloseTo(60.9, 5);

    // A/B: the corrected preview reaches the engine, then the original (override cleared).
    await waitFor(() => expect(platform.engine.overrides.get(assetId)).toBeTruthy(), {
      timeout: 10_000,
    });
    expect(platform.engine.overrides.get(assetId)!.channels[0]!.length).toBeGreaterThan(0);
    const ab = screen.getByTestId('vocal-ab');
    expect(ab.textContent).toContain('Corrected');
    await user.click(ab);
    expect(vocalDoc().enabled).toBe(false);
    expect(ab.textContent).toContain('Original');
    await waitFor(() => expect(platform.engine.overrides.get(assetId)).toBeNull(), {
      timeout: 10_000,
    });
  });

  it('supports keyboard selection, reset, merge and split', { timeout: 40_000 }, async () => {
    const { user } = await openAnalyzedVocal();
    const live = screen.getByTestId('vocal-live');
    const canvas = screen.getByTestId('vocal-canvas');
    act(() => canvas.focus());

    // Mod+A, nudge all down a semitone (one entry), Delete resets them, Esc deselects.
    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() => expect(live.textContent).toBe('3 notes selected.'));
    await user.keyboard('{ArrowDown}');
    const nudged = vocalDoc();
    for (const s of nudged.segments) {
      const target = nudged.noteEdits[s.id]?.targetMidi;
      expect(Number.isInteger(target)).toBe(true);
      expect(target!).toBeLessThan(s.detectedMidi);
    }
    expect(history().entries().undo.at(-1)!.label).toBe('Nudge Vocal Notes');
    await user.keyboard('{Delete}');
    expect(Object.keys(vocalDoc().noteEdits)).toHaveLength(0);
    expect(history().entries().undo.at(-1)!.commands[0]!.type).toBe('vocal.resetNotes');
    // The global Delete shortcut must not also delete the (still selected) clip.
    expect(Object.keys(history().present.clips)).toHaveLength(1);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(live.textContent).toBe('3 notes, none selected.'));

    // Merge the first two notes (Shift-click in the notes list, then M).
    const [a, b] = vocalDoc().segments;
    await user.click(screen.getByTestId('vocal-notes-list-toggle'));
    const rows = screen.getAllByTestId('vocal-note-row');
    await user.click(rows[0]!);
    await user.keyboard('{Shift>}');
    await user.click(rows[1]!);
    await user.keyboard('{/Shift}');
    await waitFor(() => expect(live.textContent).toBe('2 notes selected.'));
    await user.keyboard('m');
    await waitFor(() => expect(vocalDoc().segments).toHaveLength(2));
    const merged = vocalDoc().segments[0]!;
    expect(merged.startSeconds).toBeCloseTo(a!.startSeconds, 6);
    expect(merged.endSeconds).toBeCloseTo(b!.endSeconds, 6);
    expect(history().entries().undo.at(-1)!.label).toBe('Merge Vocal Notes');
    await waitFor(() => expect(live.textContent).toContain('Selected note:'));

    // Split the merged (selected) note at the playhead: seek via the ruler, then S.
    await user.click(screen.getByTestId('vocal-notes-list-toggle'));
    const ruler = screen.getByTestId('vocal-ruler');
    const mid = (a!.endSeconds + b!.startSeconds) / 2;
    const { pxPerTick, scrollTick } = uiStore().getState().vocal;
    const bpm = history().present.bpm;
    const x = (secondsToTicks(mid, bpm) - scrollTick) * pxPerTick;
    fireEvent.pointerDown(ruler, { clientX: x, clientY: 5 });
    act(() => screen.getByTestId('vocal-canvas').focus());
    await user.keyboard('s');
    await waitFor(() => expect(vocalDoc().segments).toHaveLength(3));
    const [left, right] = vocalDoc().segments;
    expect(left!.startSeconds).toBeCloseTo(a!.startSeconds, 6);
    expect(left!.endSeconds).toBeCloseTo(right!.startSeconds, 9);
    expect(left!.endSeconds).toBeCloseTo(mid, 2);
    expect(right!.endSeconds).toBeCloseTo(b!.endSeconds, 6);
    expect(new Set(vocalDoc().segments.map((s) => s.id)).has(merged.id)).toBe(false);
    expect(history().entries().undo.at(-1)!.label).toBe('Split Vocal Note');
    await waitFor(() => expect(live.textContent).toBe('2 notes selected.'));

    // Undo restores the merged note.
    act(() => {
      history().undo();
    });
    await waitFor(() => expect(vocalDoc().segments).toHaveLength(2));
  });

  it(
    'drags a note with Edit notes on as one undo entry and double-click clears it',
    { timeout: 40_000 },
    async () => {
      const { user, platform } = await openAnalyzedVocal();
      const canvas = screen.getByTestId('vocal-canvas');
      const doc = vocalDoc();
      const note = doc.segments[1]!;
      const clip = Object.values(history().present.clips)[0]!;
      if (clip.kind !== 'audio') throw new Error('expected an audio clip');
      const asset = history().present.assets[clip.assetId]!;
      const { pxPerTick, scrollTick, topPitch, rowHeight } = uiStore().getState().vocal;
      const rect = vocalNoteRect(
        note,
        displayTargetMidi(note, doc),
        new TimeAxis(pxPerTick, scrollTick),
        { topPitch, rowHeight },
        {
          startTick: clip.startTick,
          sourceStartFrame: clip.sourceStartFrame,
          lengthFrames: clip.lengthFrames,
          sampleRate: asset.sampleRate,
          bpm: history().present.bpm,
        },
      );
      const x = rect.x + rect.w / 2;
      const y = rect.y + rect.h / 2;
      const drag = (dy: number) => {
        fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: x, clientY: y + dy, pointerId: 1 });
        fireEvent.pointerUp(canvas, { clientX: x, clientY: y + dy, pointerId: 1 });
      };

      // Without Edit notes a drag only selects.
      const entries = history().entries().undo.length;
      drag(-2.2 * rowHeight);
      await waitFor(() =>
        expect(screen.getByTestId('vocal-live').textContent).toContain('Selected note: C4'),
      );
      expect(history().entries().undo.length).toBe(entries);

      await user.click(screen.getByTestId('vocal-edit-notes'));
      drag(-2.2 * rowHeight);
      const entry = history().entries().undo.at(-1)!;
      expect(entry.label).toBe('Move Vocal Note');
      expect(history().entries().undo.length).toBe(entries + 1);
      const target = vocalDoc().noteEdits[note.id]?.targetMidi;
      // Snapped to a scale degree of the detected key, about two semitones up.
      const key = vocalDoc().correction.key;
      expect(key).not.toBeNull();
      expect(target).toBe(nearestScaleNote(displayTargetMidi(note, doc) + 2.2, key!));

      fireEvent.doubleClick(canvas, {
        clientX: x,
        clientY: midiToY(target!, { topPitch, rowHeight }),
      });
      expect(vocalDoc().noteEdits[note.id]?.targetMidi).toBeUndefined();
      expect(history().entries().undo.at(-1)!.commands[0]!.type).toBe('vocal.clearTargets');

      // Advanced inspector: engine capabilities and per-note controls for the selection.
      await user.click(screen.getByTestId('vocal-advanced'));
      const inspector = screen.getByTestId('vocal-inspector');
      const formants = within(inspector).getByRole('switch', { name: 'Preserve formants' });
      expect(formants.getAttribute('aria-checked')).toBe('true');
      expect(formants.hasAttribute('disabled')).toBe(false);
      expect(within(inspector).getByTestId('vocal-note-target').textContent).toContain(
        'Sung C4 +20¢',
      );
      const drift = within(inspector).getByRole('slider', { name: 'Drift correction' });
      act(() => drift.focus());
      await user.keyboard('{ArrowRight}');
      // Slider values arrive on the next animation frame; let each step land first.
      await waitFor(() =>
        expect(vocalDoc().noteEdits[note.id]?.driftCorrection).toBeCloseTo(0.01, 5),
      );
      await user.keyboard('{ArrowRight}');
      await waitFor(() =>
        expect(vocalDoc().noteEdits[note.id]?.driftCorrection).toBeCloseTo(0.02, 5),
      );
      expect(history().entries().undo.at(-1)!.label).toBe('Drift Correction');
      await user.click(within(inspector).getByRole('switch', { name: 'Bypass (leave untouched)' }));
      expect(vocalDoc().noteEdits[note.id]?.bypass).toBe(true);

      // Export renders the corrected vocal at final quality and saves a WAV.
      await user.click(screen.getByRole('button', { name: 'Export corrected WAV' }));
      await waitFor(() => expect(platform.savedFiles).toHaveLength(1), { timeout: 10_000 });
      expect(platform.savedFiles[0]!.name).toBe('Lead Vox (corrected).wav');
      expect(new TextDecoder().decode(platform.savedFiles[0]!.bytes.slice(0, 4))).toBe('RIFF');
    },
  );
});
