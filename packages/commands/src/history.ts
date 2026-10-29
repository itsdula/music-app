/**
 * Snapshot undo/redo history (see `history-types.ts` for the contract).
 *
 * Implementation notes:
 * - Entries hold `{ before, after }` project roots. Commands share untouched structure,
 *   so an entry costs roughly the size of what it changed. Undo/redo swap roots in O(1).
 * - `entries()` returns `undo` oldest → newest (last = next undo) and `redo` in timeline
 *   order (first = next redo).
 * - Listeners run synchronously after every change of `present`, and additionally after a
 *   `commit()` that records an entry (reason 'commit', previous === present) and after
 *   `reset()`, because both change what undo/redo offer.
 * - `commit()`/`cancel()` on a closed transaction are no-ops; `apply()`/`applyFromStart()`
 *   on a closed transaction return a `transaction-state` error.
 * - `coalesceKey` is honoured by both `execute` and `executeBatch`.
 */
import { err, ok, type Project, type Result } from '@studio/domain';
import { applyCommand, applyCommands } from './apply';
import { describeCommand, describeCommands } from './describe';
import type {
  CommandHistory,
  ExecuteOptions,
  HistoryChangeReason,
  HistoryEntry,
  HistoryListener,
  HistoryOptions,
  Transaction,
} from './history-types';
import { CommandError, type Command } from './types';

export const DEFAULT_HISTORY_LIMIT = 200;

interface OpenTransaction {
  readonly label: string;
  readonly before: Project;
  commands: readonly Command[];
  open: boolean;
}

function attempt(run: () => Project): Result<Project, CommandError> {
  try {
    return ok(run());
  } catch (error) {
    if (error instanceof CommandError) return err(error);
    throw error;
  }
}

export function createHistory(initial: Project, options: HistoryOptions = {}): CommandHistory {
  const rawLimit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(rawLimit) || rawLimit < 0) {
    throw new RangeError(`history limit must be a non-negative integer (got ${rawLimit})`);
  }
  const limit = rawLimit;

  let present = initial;
  const undoStack: HistoryEntry[] = [];
  /** Last element is the next entry to redo. */
  const redoStack: HistoryEntry[] = [];
  let nextId = 1;
  let transaction: OpenTransaction | null = null;
  /** The entry the next `execute` with the same key may merge into. */
  let coalesceTarget: HistoryEntry | null = null;
  const listeners = new Set<HistoryListener>();

  function notify(reason: HistoryChangeReason, previous: Project): void {
    let firstError: unknown;
    let failed = false;
    for (const listener of [...listeners]) {
      try {
        listener({ reason, previous, present });
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  function pushEntry(entry: HistoryEntry): void {
    undoStack.push(entry);
    redoStack.length = 0;
    while (undoStack.length > limit) undoStack.shift();
  }

  function record(
    before: Project,
    after: Project,
    commands: readonly Command[],
    label: string,
    coalesceKey: string | undefined,
  ): void {
    const top = undoStack[undoStack.length - 1];
    if (
      coalesceKey !== undefined &&
      top !== undefined &&
      top === coalesceTarget &&
      top.coalesceKey === coalesceKey &&
      top.after === before
    ) {
      undoStack.pop();
      // Note: `after` is never `top.before` here — no-op commands return before recording,
      // and any change produces a new root — so the merged entry always has something to undo.
      const merged: HistoryEntry = {
        ...top,
        after,
        commands: [...top.commands, ...commands],
      };
      undoStack.push(merged);
      coalesceTarget = merged;
      return;
    }
    const entry: HistoryEntry = {
      id: nextId++,
      label,
      before,
      after,
      commands,
      ...(coalesceKey !== undefined ? { coalesceKey } : {}),
    };
    pushEntry(entry);
    coalesceTarget = coalesceKey !== undefined && undoStack.includes(entry) ? entry : null;
  }

  function commitOpenTransaction(): void {
    if (transaction?.open) commitTransaction(transaction);
  }

  function commitTransaction(tx: OpenTransaction): void {
    tx.open = false;
    if (transaction === tx) transaction = null;
    if (present === tx.before) return;
    coalesceTarget = null;
    pushEntry({
      id: nextId++,
      label: tx.label,
      before: tx.before,
      after: present,
      commands: tx.commands,
    });
    notify('commit', present);
  }

  function setPresent(next: Project, reason: HistoryChangeReason): void {
    const previous = present;
    present = next;
    notify(reason, previous);
  }

  function run(
    commands: readonly Command[],
    options: ExecuteOptions,
    label: () => string,
  ): Result<Project, CommandError> {
    commitOpenTransaction();
    const result = attempt(() => applyCommands(present, commands));
    if (!result.ok || result.value === present) return result;
    const before = present;
    present = result.value;
    record(before, present, commands, options.label ?? label(), options.coalesceKey);
    notify('execute', before);
    return result;
  }

  function createTransaction(tx: OpenTransaction): Transaction {
    const closedError = () =>
      err(new CommandError('transaction-state', `transaction "${tx.label}" is closed`));
    return {
      label: tx.label,
      get isOpen() {
        return tx.open;
      },
      apply(command) {
        if (!tx.open) return closedError();
        const result = attempt(() => applyCommand(present, command));
        if (result.ok && result.value !== present) {
          tx.commands = [...tx.commands, command];
          setPresent(result.value, 'transaction');
        }
        return result;
      },
      applyFromStart(commands) {
        if (!tx.open) return closedError();
        const result = attempt(() => applyCommands(tx.before, commands));
        if (result.ok) {
          tx.commands = commands.slice();
          if (result.value !== present) setPresent(result.value, 'transaction');
        }
        return result;
      },
      commit() {
        if (tx.open) commitTransaction(tx);
      },
      cancel() {
        if (!tx.open) return;
        tx.open = false;
        if (transaction === tx) transaction = null;
        if (present !== tx.before) setPresent(tx.before, 'cancel');
      },
    };
  }

  return {
    get present() {
      return present;
    },
    get canUndo() {
      return undoStack.length > 0 || (transaction !== null && present !== transaction.before);
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    get undoLabel() {
      if (transaction && present !== transaction.before) return transaction.label;
      return undoStack[undoStack.length - 1]?.label;
    },
    get redoLabel() {
      return redoStack[redoStack.length - 1]?.label;
    },
    get transactionOpen() {
      return transaction !== null;
    },
    execute(command, executeOptions = {}) {
      return run([command], executeOptions, () => describeCommand(command));
    },
    executeBatch(commands, executeOptions = {}) {
      return run(commands, executeOptions, () => describeCommands(commands));
    },
    beginTransaction(label) {
      commitOpenTransaction();
      coalesceTarget = null;
      const tx: OpenTransaction = { label, before: present, commands: [], open: true };
      transaction = tx;
      return createTransaction(tx);
    },
    undo() {
      commitOpenTransaction();
      const entry = undoStack.pop();
      if (!entry) return false;
      coalesceTarget = null;
      redoStack.push(entry);
      setPresent(entry.before, 'undo');
      return true;
    },
    redo() {
      commitOpenTransaction();
      const entry = redoStack.pop();
      if (!entry) return false;
      coalesceTarget = null;
      undoStack.push(entry);
      setPresent(entry.after, 'redo');
      return true;
    },
    reset(project) {
      // Per the contract an open transaction is committed first (its entry is then
      // cleared with the rest of the stacks; listeners see 'commit' then 'reset').
      commitOpenTransaction();
      undoStack.length = 0;
      redoStack.length = 0;
      coalesceTarget = null;
      setPresent(project, 'reset');
    },
    entries() {
      return { undo: undoStack.slice(), redo: redoStack.slice().reverse() };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
