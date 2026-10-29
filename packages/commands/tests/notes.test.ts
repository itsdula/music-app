import {
  asClipId,
  asNoteId,
  checkProjectInvariants,
  type MidiClip,
  type Project,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  apply,
  deepFreeze,
  expectCommandError,
  expectNoop,
  ids,
  makeMidiClip,
  makeProject,
  note,
} from './fixtures';

const notesOf = (p: Project) => (p.clips[ids.midi] as MidiClip).notes;
const order = (p: Project) => notesOf(p).map((n) => n.id);

describe('notes.add', () => {
  it('merges new notes into sorted order, keeping existing note objects', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'notes.add',
      clipId: ids.midi,
      notes: [note('z', 2000, 10, 50), note('a', 480, 10, 60), note('m', 0, 10, 60)],
    });
    // Ties on start and pitch break by id, so 'm' sorts before 'n1'.
    expect(order(next)).toEqual(['m', 'n1', 'a', 'n2', 'n3', 'n4', 'z']);
    expect(notesOf(next)[1]).toBe(notesOf(p)[0]);
    expect(next.clips[ids.audioClip]).toBe(p.clips[ids.audioClip]);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('clamps and rounds velocity', () => {
    const next = apply(makeProject(), {
      type: 'notes.add',
      clipId: ids.midi,
      notes: [note('lo', 0, 10, 10, 0), note('hi', 0, 10, 11, 300), note('mid', 0, 10, 12, 64.6)],
    });
    const byId = new Map(notesOf(next).map((n) => [n.id, n.velocity]));
    expect([byId.get(asNoteId('lo')), byId.get(asNoteId('hi')), byId.get(asNoteId('mid'))]).toEqual(
      [1, 127, 65],
    );
  });

  it('rejects invalid notes and duplicate ids', () => {
    const p = makeProject();
    const add = (...notes: ReturnType<typeof note>[]) =>
      ({ type: 'notes.add', clipId: ids.midi, notes }) as const;
    expectCommandError(p, add(note('n1', 0)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0), note('x', 5)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 10, 128)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 10, -1)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 10, 60.5)), 'invalid-argument');
    expectCommandError(p, add(note('x', -1)), 'invalid-argument');
    expectCommandError(p, add(note('x', 1.5)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 0)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 2.5)), 'invalid-argument');
    expectCommandError(p, add(note('', 0)), 'invalid-argument');
    expectCommandError(p, add(note('x', 0, 10, 60, Number.NaN)), 'invalid-argument');
  });

  it('requires a MIDI clip and is a no-op for no notes', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'notes.add', clipId: ids.audioClip, notes: [note('x', 0)] },
      'kind-mismatch',
    );
    expectCommandError(p, { type: 'notes.add', clipId: asClipId('x'), notes: [] }, 'not-found');
    expectNoop(p, { type: 'notes.add', clipId: ids.midi, notes: [] });
  });
});

describe('notes.remove', () => {
  it('removes notes by id', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'notes.remove',
      clipId: ids.midi,
      noteIds: [asNoteId('n2'), asNoteId('n4')],
    });
    expect(order(next)).toEqual(['n1', 'n3']);
    expect(notesOf(next)[1]).toBe(notesOf(p)[2]);
  });

  it('requires every id to exist', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'notes.remove', clipId: ids.midi, noteIds: [asNoteId('n1'), asNoteId('nope')] },
      'not-found',
      /nope/,
    );
    expectCommandError(
      p,
      { type: 'notes.remove', clipId: ids.audioClip, noteIds: [] },
      'kind-mismatch',
    );
    expectNoop(p, { type: 'notes.remove', clipId: ids.midi, noteIds: [] });
  });
});

describe('notes.update', () => {
  it('applies absolute patches and re-sorts', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [
        { id: asNoteId('n1'), startTick: 3000, pitch: 40 },
        { id: asNoteId('n3'), durationTicks: 100, velocity: 20 },
      ],
    });
    expect(order(next)).toEqual(['n2', 'n3', 'n4', 'n1']);
    const n1 = notesOf(next).find((n) => n.id === 'n1')!;
    expect(n1).toEqual({ id: 'n1', startTick: 3000, durationTicks: 240, pitch: 40, velocity: 100 });
    expect(notesOf(next).find((n) => n.id === 'n3')).toMatchObject({
      durationTicks: 100,
      velocity: 20,
    });
    expect(notesOf(next).find((n) => n.id === 'n2')).toBe(notesOf(p)[1]);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('clamps values into range', () => {
    const next = apply(makeProject(), {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [{ id: asNoteId('n2'), startTick: -50, durationTicks: -3, pitch: 300, velocity: 0 }],
    });
    expect(notesOf(next).find((n) => n.id === 'n2')).toEqual({
      id: 'n2',
      startTick: 0,
      durationTicks: 1,
      pitch: 127,
      velocity: 1,
    });
    const low = apply(makeProject(), {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [{ id: asNoteId('n2'), pitch: -4 }],
    });
    expect(notesOf(low).find((n) => n.id === 'n2')!.pitch).toBe(0);
  });

  it('keeps the array order when only non-sorting fields change', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [{ id: asNoteId('n4'), velocity: 1 }],
    });
    expect(order(next)).toEqual(order(p));
  });

  it('returns the same project when every patch matches the current values', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'notes.update',
      clipId: ids.midi,
      patches: [{ id: asNoteId('n1'), startTick: 0, pitch: 60 }, { id: asNoteId('n2') }],
    });
    expectNoop(p, { type: 'notes.update', clipId: ids.midi, patches: [] });
  });

  it('validates patches', () => {
    const p = makeProject();
    const update = (patch: { id: string; [k: string]: unknown }) =>
      ({
        type: 'notes.update',
        clipId: ids.midi,
        patches: [{ ...patch, id: asNoteId(patch.id) }],
      }) as const;
    expectCommandError(p, update({ id: 'missing', velocity: 3 }), 'not-found', /missing/);
    expectCommandError(p, update({ id: 'n1', startTick: 0.5 }), 'invalid-argument');
    expectCommandError(p, update({ id: 'n1', durationTicks: 0.5 }), 'invalid-argument');
    expectCommandError(p, update({ id: 'n1', pitch: 60.5 }), 'invalid-argument');
    expectCommandError(p, update({ id: 'n1', velocity: Number.NaN }), 'invalid-argument');
    expectCommandError(
      p,
      {
        type: 'notes.update',
        clipId: ids.midi,
        patches: [{ id: asNoteId('n1') }, { id: asNoteId('n1'), pitch: 1 }],
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'notes.update', clipId: ids.audioClip, patches: [] },
      'kind-mismatch',
    );
  });
});

describe('notes.quantize', () => {
  const offGrid = () =>
    deepFreeze({
      ...makeProject(),
      clips: {
        ...makeProject().clips,
        [ids.midi]: makeMidiClip({
          notes: [
            note('a', 10, 100, 60),
            note('b', 250, 200, 61),
            note('c', 470, 20, 62),
            note('d', 960, 240, 63),
          ],
        }),
      },
    });

  it('quantizes starts of the selected notes only', () => {
    const p = offGrid();
    const next = apply(p, {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [asNoteId('a'), asNoteId('b'), asNoteId('c')],
      options: { gridTicks: 240, strength: 1 },
    });
    expect(notesOf(next).map((n) => [n.id, n.startTick, n.durationTicks])).toEqual([
      ['a', 0, 100],
      ['b', 240, 200],
      ['c', 480, 20],
      ['d', 960, 240],
    ]);
    expect(notesOf(next)[3]).toBe(notesOf(p)[3]);
  });

  it('quantizes ends when asked, keeping collapsed notes one grid step long', () => {
    const next = apply(offGrid(), {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [asNoteId('a'), asNoteId('b'), asNoteId('c')],
      options: { gridTicks: 240, strength: 1, quantizeEnds: true },
    });
    expect(notesOf(next).map((n) => [n.id, n.startTick, n.durationTicks])).toEqual([
      ['a', 0, 240], // end 110 -> 0 collapses onto the start: one grid step
      ['b', 240, 240],
      ['c', 480, 240],
      ['d', 960, 240],
    ]);
    expect(checkProjectInvariants(next)).toEqual([]);
  });

  it('supports strength and swing', () => {
    const next = apply(offGrid(), {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [asNoteId('b')],
      options: { gridTicks: 240, strength: 0.5, swing: 0.5 },
    });
    expect(notesOf(next).find((n) => n.id === 'b')!.startTick).toBe(275);
  });

  it('is a no-op for on-grid notes or an empty selection', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [asNoteId('n1'), asNoteId('n2')],
      options: { gridTicks: 240, strength: 1 },
    });
    expectNoop(p, {
      type: 'notes.quantize',
      clipId: ids.midi,
      noteIds: [],
      options: { gridTicks: 240, strength: 1 },
    });
  });

  it('validates ids and options', () => {
    const p = makeProject();
    expectCommandError(
      p,
      {
        type: 'notes.quantize',
        clipId: ids.midi,
        noteIds: [asNoteId('x')],
        options: { gridTicks: 240, strength: 1 },
      },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'notes.quantize',
        clipId: ids.midi,
        noteIds: [],
        options: { gridTicks: Number.NaN, strength: 1 },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'notes.quantize',
        clipId: ids.midi,
        noteIds: [],
        options: { gridTicks: 240, strength: Number.NaN },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'notes.quantize',
        clipId: ids.midi,
        noteIds: [],
        options: { gridTicks: 240, strength: 1, swing: Infinity },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'notes.quantize',
        clipId: ids.audioClip,
        noteIds: [],
        options: { gridTicks: 240, strength: 1 },
      },
      'kind-mismatch',
    );
  });
});
