import { asTrackId, type Project } from '@studio/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  CommandError,
  DEFAULT_HISTORY_LIMIT,
  createHistory,
  type Command,
  type HistoryChange,
} from '../src';
import { ids, makeProject } from './fixtures';

const tempo = (bpm: number): Command => ({ type: 'project.setTempo', bpm });
const gain = (gainDb: number): Command => ({
  type: 'track.setMixer',
  trackId: ids.audio,
  mixer: { gainDb },
});
const bad: Command = { type: 'track.remove', trackId: asTrackId('missing') };

function setup(limit?: number) {
  const initial = makeProject();
  const history = createHistory(initial, limit === undefined ? undefined : { limit });
  const changes: HistoryChange[] = [];
  history.subscribe((change) => changes.push(change));
  const reasons = () => changes.map((c) => c.reason);
  return { initial, history, changes, reasons };
}

describe('createHistory basics', () => {
  it('starts empty', () => {
    const { initial, history } = setup();
    expect(history.present).toBe(initial);
    expect(history).toMatchObject({
      canUndo: false,
      canRedo: false,
      undoLabel: undefined,
      redoLabel: undefined,
      transactionOpen: false,
    });
    expect(history.entries()).toEqual({ undo: [], redo: [] });
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });

  it('validates the limit', () => {
    expect(() => createHistory(makeProject(), { limit: -1 })).toThrow(RangeError);
    expect(() => createHistory(makeProject(), { limit: 1.5 })).toThrow(RangeError);
    expect(DEFAULT_HISTORY_LIMIT).toBe(200);
  });
});

describe('execute', () => {
  it('applies, records an entry and notifies', () => {
    const { initial, history, changes } = setup();
    const result = history.execute(tempo(90));
    expect(result.ok).toBe(true);
    expect(history.present.bpm).toBe(90);
    if (result.ok) expect(result.value).toBe(history.present);
    const [entry] = history.entries().undo;
    expect(entry).toMatchObject({ id: 1, label: 'Set Tempo', commands: [tempo(90)] });
    expect(entry!.before).toBe(initial);
    expect(entry!.after).toBe(history.present);
    expect(entry!.after.tracks).toBe(initial.tracks); // structural sharing inside entries
    expect(changes).toEqual([{ reason: 'execute', previous: initial, present: history.present }]);
    expect(history.undoLabel).toBe('Set Tempo');
  });

  it('uses an explicit label', () => {
    const { history } = setup();
    history.execute(tempo(90), { label: 'Tap Tempo' });
    expect(history.undoLabel).toBe('Tap Tempo');
  });

  it('records nothing and notifies nobody for no-ops', () => {
    const { initial, history, changes } = setup();
    const result = history.execute(tempo(120));
    expect(result).toEqual({ ok: true, value: initial });
    expect(history.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });

  it('returns errors without changing anything', () => {
    const { initial, history, changes } = setup();
    const result = history.execute(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(CommandError);
      expect(result.error.code).toBe('not-found');
    }
    expect(history.present).toBe(initial);
    expect(history.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });
});

describe('undo / redo', () => {
  it('swaps roots exactly and keeps a redo stack', () => {
    const { initial, history, reasons } = setup();
    history.execute(tempo(90));
    const afterFirst = history.present;
    history.execute(gain(-6));
    const afterSecond = history.present;
    expect(history.undo()).toBe(true);
    expect(history.present).toBe(afterFirst);
    expect(history.redoLabel).toBe('Change Volume');
    expect(history.undo()).toBe(true);
    expect(history.present).toBe(initial);
    expect(history.canUndo).toBe(false);
    expect(history.entries().redo.map((e) => e.label)).toEqual(['Set Tempo', 'Change Volume']);
    expect(history.redo()).toBe(true);
    expect(history.present).toBe(afterFirst);
    expect(history.redo()).toBe(true);
    expect(history.present).toBe(afterSecond);
    expect(history.redo()).toBe(false);
    expect(reasons()).toEqual(['execute', 'execute', 'undo', 'undo', 'redo', 'redo']);
  });

  it('clears the redo stack when a new entry is recorded', () => {
    const { history } = setup();
    history.execute(tempo(90));
    history.undo();
    expect(history.canRedo).toBe(true);
    history.execute(tempo(120)); // no-op relative to present: redo survives
    expect(history.canRedo).toBe(true);
    history.execute(tempo(100));
    expect(history.canRedo).toBe(false);
  });
});

describe('executeBatch', () => {
  it('records a single entry for several commands', () => {
    const { initial, history, changes } = setup();
    history.executeBatch([tempo(90), gain(-3)]);
    expect(history.entries().undo).toHaveLength(1);
    expect(history.undoLabel).toBe('Multiple Edits');
    expect(changes).toHaveLength(1);
    history.undo();
    expect(history.present).toBe(initial);
    history.executeBatch([tempo(90), tempo(95)]);
    expect(history.undoLabel).toBe('Set Tempo');
    history.executeBatch([tempo(91), gain(-1)], { label: 'Paste' });
    expect(history.undoLabel).toBe('Paste');
  });

  it('is all-or-nothing', () => {
    const { initial, history, changes } = setup();
    const result = history.executeBatch([tempo(90), bad, tempo(100)]);
    expect(result.ok).toBe(false);
    expect(history.present).toBe(initial);
    expect(history.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });

  it('records nothing for a no-op batch', () => {
    const { history } = setup();
    expect(history.executeBatch([]).ok).toBe(true);
    history.executeBatch([tempo(120), gain(0)]);
    expect(history.canUndo).toBe(false);
    // Change is defined by root identity (as for transactions): a batch that ends with
    // equal content but a new root still records an entry.
    history.executeBatch([tempo(90), tempo(120)]);
    expect(history.canUndo).toBe(true);
  });
});

describe('coalescing', () => {
  it('merges consecutive executes with the same key, keeping the original before', () => {
    const { initial, history, changes } = setup();
    history.execute(gain(-1), { coalesceKey: 'knob' });
    history.execute(gain(-2), { coalesceKey: 'knob' });
    history.execute(gain(-3), { coalesceKey: 'knob' });
    const entries = history.entries().undo;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 1,
      coalesceKey: 'knob',
      commands: [gain(-1), gain(-2), gain(-3)],
    });
    expect(entries[0]!.before).toBe(initial);
    expect(entries[0]!.after).toBe(history.present);
    expect(changes).toHaveLength(3);
    history.undo();
    expect(history.present).toBe(initial);
  });

  it('starts a new entry for a different key or after an intervening entry', () => {
    const { history } = setup();
    history.execute(gain(-1), { coalesceKey: 'a' });
    history.execute(gain(-2), { coalesceKey: 'b' });
    history.execute(tempo(90));
    history.execute(gain(-3), { coalesceKey: 'b' });
    expect(history.entries().undo.map((e) => e.coalesceKey)).toEqual(['a', 'b', undefined, 'b']);
  });

  it('ignores no-ops and failures between coalesced executes', () => {
    const { history } = setup();
    history.execute(gain(-1), { coalesceKey: 'k' });
    history.execute(gain(-1), { coalesceKey: 'k' });
    history.execute(bad, { coalesceKey: 'k' });
    history.execute(gain(-2), { coalesceKey: 'k' });
    expect(history.entries().undo).toHaveLength(1);
  });

  it('does not merge across undo/redo or transactions', () => {
    const { history } = setup();
    history.execute(gain(-1), { coalesceKey: 'k' });
    history.execute(tempo(90));
    history.undo();
    history.execute(gain(-2), { coalesceKey: 'k' });
    expect(history.entries().undo).toHaveLength(2);
    history.beginTransaction('noop').commit();
    history.execute(gain(-4), { coalesceKey: 'k' });
    expect(history.entries().undo).toHaveLength(3);
    history.undo();
    history.redo();
    history.execute(gain(-5), { coalesceKey: 'k' });
    expect(history.entries().undo).toHaveLength(4);
  });

  it('keeps the merged entry when the content returns to its start value', () => {
    const { initial, history } = setup();
    history.execute(gain(-1), { coalesceKey: 'k' });
    history.execute(gain(0), { coalesceKey: 'k' });
    // Equal content, but a new root: the entry stays (undo returns the original root).
    expect(history.present).not.toBe(initial);
    expect(history.present.tracks[ids.audio]!.mixer).toEqual(initial.tracks[ids.audio]!.mixer);
    expect(history.entries().undo).toHaveLength(1);
    history.undo();
    expect(history.present).toBe(initial);
  });

  it('coalesces batches with the same key', () => {
    const { history } = setup();
    history.executeBatch([gain(-1)], { coalesceKey: 'k' });
    history.executeBatch([gain(-2), tempo(99)], { coalesceKey: 'k' });
    expect(history.entries().undo).toHaveLength(1);
    expect(history.entries().undo[0]!.commands).toHaveLength(3);
  });
});

describe('limit', () => {
  it('drops the oldest entries', () => {
    const { initial, history } = setup(3);
    for (let i = 1; i <= 5; i++) history.execute(tempo(100 + i));
    const undo = history.entries().undo;
    expect(undo.map((e) => e.label)).toHaveLength(3);
    expect(undo.map((e) => e.after.bpm)).toEqual([103, 104, 105]);
    while (history.undo());
    expect(history.present.bpm).toBe(102);
    expect(history.present).not.toBe(initial);
  });

  it('keeps no entries with limit 0 but still applies commands', () => {
    const { history } = setup(0);
    history.execute(tempo(90), { coalesceKey: 'k' });
    history.execute(tempo(91), { coalesceKey: 'k' });
    expect(history.present.bpm).toBe(91);
    expect(history.canUndo).toBe(false);
  });

  it('defaults to 200 entries', () => {
    const { history } = setup();
    for (let i = 0; i < 205; i++) history.execute(tempo(i % 2 === 0 ? 90 : 91));
    expect(history.entries().undo).toHaveLength(200);
  });
});

describe('transactions', () => {
  it('updates present live and commits one entry', () => {
    const { initial, history, reasons } = setup();
    const tx = history.beginTransaction('Drag Clip');
    expect(history.transactionOpen).toBe(true);
    expect(tx).toMatchObject({ label: 'Drag Clip', isOpen: true });
    tx.apply({ type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 1000 }] });
    tx.apply({ type: 'clip.move', moves: [{ clipId: ids.midi, startTick: 1100 }] });
    expect(history.present.clips[ids.midi]!.startTick).toBe(1100);
    expect(history.canUndo).toBe(true);
    expect(history.undoLabel).toBe('Drag Clip');
    tx.commit();
    expect(tx.isOpen).toBe(false);
    expect(history.transactionOpen).toBe(false);
    const [entry] = history.entries().undo;
    expect(entry).toMatchObject({ label: 'Drag Clip' });
    expect(entry!.commands).toHaveLength(2);
    expect(entry!.before).toBe(initial);
    expect(reasons()).toEqual(['transaction', 'transaction', 'commit']);
    history.undo();
    expect(history.present).toBe(initial);
  });

  it('records nothing when the transaction changed nothing', () => {
    const { history, changes } = setup();
    const tx = history.beginTransaction('Nothing');
    tx.apply(tempo(120));
    tx.commit();
    expect(history.canUndo).toBe(false);
    expect(changes).toEqual([]);
  });

  it('cancel restores the pre-transaction state', () => {
    const { initial, history, reasons } = setup();
    history.execute(tempo(90));
    history.undo();
    const tx = history.beginTransaction('Drag');
    tx.apply(gain(-10));
    tx.cancel();
    expect(history.present).toBe(initial);
    expect(history.canRedo).toBe(true); // cancelling records nothing, so redo survives
    expect(reasons()).toEqual(['execute', 'undo', 'transaction', 'cancel']);
    const quiet = history.beginTransaction('Quiet');
    quiet.cancel();
    expect(reasons()).toHaveLength(4);
  });

  it('keeps the transaction open when a command fails', () => {
    const { history } = setup();
    const tx = history.beginTransaction('Edit');
    tx.apply(tempo(90));
    const live = history.present;
    const result = tx.apply(bad);
    expect(result.ok).toBe(false);
    expect(tx.isOpen).toBe(true);
    expect(history.present).toBe(live);
  });

  it('applyFromStart recomputes from the pre-transaction state', () => {
    const { initial, history } = setup();
    const tx = history.beginTransaction('Drag Notes');
    const move = (start: number): Command => ({
      type: 'clip.move',
      moves: [{ clipId: ids.midi, startTick: start }],
    });
    tx.applyFromStart([move(1500)]);
    tx.applyFromStart([move(2000), gain(-2)]);
    expect(history.present.clips[ids.midi]!.startTick).toBe(2000);
    expect(history.present.tracks[ids.audio]!.mixer.gainDb).toBe(-2);
    const failed = tx.applyFromStart([move(3000), bad]);
    expect(failed.ok).toBe(false);
    expect(history.present.clips[ids.midi]!.startTick).toBe(2000);
    tx.applyFromStart([]);
    expect(history.present).toBe(initial);
    tx.applyFromStart([move(2500)]);
    tx.commit();
    const [entry] = history.entries().undo;
    expect(entry!.commands).toEqual([move(2500)]);
    expect(entry!.before).toBe(initial);
  });

  it('rejects use after close; commit/cancel become no-ops', () => {
    const { history } = setup();
    const tx = history.beginTransaction('Once');
    tx.apply(tempo(90));
    tx.commit();
    const applied = tx.apply(tempo(91));
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.error.code).toBe('transaction-state');
    const fromStart = tx.applyFromStart([tempo(91)]);
    expect(fromStart.ok).toBe(false);
    tx.commit();
    tx.cancel();
    expect(history.present.bpm).toBe(90);
    expect(history.entries().undo).toHaveLength(1);
  });

  it('is committed first by execute, beginTransaction, undo, redo and reset', () => {
    const exec = setup();
    exec.history.beginTransaction('A').apply(tempo(90));
    exec.history.execute(gain(-1));
    expect(exec.history.entries().undo.map((e) => e.label)).toEqual(['A', 'Change Volume']);
    expect(exec.reasons()).toEqual(['transaction', 'commit', 'execute']);

    const nested = setup();
    const first = nested.history.beginTransaction('A');
    first.apply(tempo(90));
    const second = nested.history.beginTransaction('B');
    expect(first.isOpen).toBe(false);
    second.apply(tempo(91));
    second.commit();
    expect(nested.history.entries().undo.map((e) => e.label)).toEqual(['A', 'B']);

    const undo = setup();
    undo.history.beginTransaction('A').apply(tempo(90));
    expect(undo.history.undo()).toBe(true);
    expect(undo.history.present).toBe(undo.initial);
    expect(undo.history.redoLabel).toBe('A');

    const redo = setup();
    redo.history.execute(tempo(80));
    redo.history.undo();
    redo.history.beginTransaction('A').apply(tempo(90));
    expect(redo.history.redo()).toBe(false); // the committed transaction cleared the redo stack
    expect(redo.history.undoLabel).toBe('A');

    const reset = setup();
    const tx = reset.history.beginTransaction('A');
    tx.apply(tempo(90));
    const fresh = makeProject();
    reset.history.reset(fresh);
    expect(tx.isOpen).toBe(false);
    expect(reset.history.present).toBe(fresh);
    expect(reset.history.entries()).toEqual({ undo: [], redo: [] });
    expect(reset.reasons()).toEqual(['transaction', 'commit', 'reset']);
  });
});

describe('reset and listeners', () => {
  it('reset replaces present, clears stacks and notifies', () => {
    const { initial, history, changes } = setup();
    history.execute(tempo(90));
    history.execute(tempo(91));
    history.undo();
    const other: Project = makeProject();
    history.reset(other);
    expect(history.present).toBe(other);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(changes.at(-1)).toMatchObject({ reason: 'reset', present: other });
    expect(changes.at(-1)!.previous).not.toBe(initial);
  });

  it('unsubscribes', () => {
    const history = createHistory(makeProject());
    const listener = vi.fn();
    const unsubscribe = history.subscribe(listener);
    history.execute(tempo(90));
    unsubscribe();
    history.execute(tempo(91));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('calls every listener even if one throws, then rethrows', () => {
    const history = createHistory(makeProject());
    const second = vi.fn();
    history.subscribe(() => {
      throw new Error('listener failed');
    });
    history.subscribe(() => {
      throw new Error('second failure');
    });
    history.subscribe(second);
    expect(() => history.execute(tempo(90))).toThrow('listener failed');
    expect(second).toHaveBeenCalledTimes(1);
    expect(history.present.bpm).toBe(90);
    expect(history.canUndo).toBe(true);
  });

  it('notifies synchronously with the new present visible', () => {
    const history = createHistory(makeProject());
    const seen: number[] = [];
    history.subscribe(({ present }) => seen.push(history.present.bpm, present.bpm));
    history.execute(tempo(90));
    expect(seen).toEqual([90, 90]);
  });
});
