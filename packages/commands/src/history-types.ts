/**
 * Undo/redo history contract.
 *
 * Snapshot history with structural sharing: each entry stores the `before` and `after`
 * project roots. Because commands never mutate, consecutive snapshots share every
 * untouched entity, so memory per entry is proportional to what changed. Undo/redo are
 * O(1) root swaps and are exact by construction (no inverse-command drift).
 *
 * Transactions group many commands (e.g. every pointer-move of a drag) into one entry:
 * `present` updates live while the transaction is open, `commit()` records a single entry
 * (none if nothing changed) and `cancel()` restores the pre-transaction state.
 * Executing a command or beginning a transaction while one is open commits it first.
 *
 * Coalescing: consecutive `execute` calls with the same `coalesceKey` and no intervening
 * entry merge into the previous entry (e.g. successive MIDI knob moves on one mapping).
 */
import type { Project, Result } from '@studio/domain';
import type { Command, CommandError } from './types';

export interface HistoryEntry {
  readonly id: number;
  readonly label: string;
  readonly before: Project;
  readonly after: Project;
  readonly commands: readonly Command[];
  readonly coalesceKey?: string;
}

export interface HistoryOptions {
  /** Maximum undo entries retained (oldest dropped first). Default 200. */
  readonly limit?: number;
}

export interface ExecuteOptions {
  readonly label?: string;
  readonly coalesceKey?: string;
}

export type HistoryChangeReason =
  'execute' | 'transaction' | 'commit' | 'cancel' | 'undo' | 'redo' | 'reset';

export interface HistoryChange {
  readonly reason: HistoryChangeReason;
  readonly previous: Project;
  readonly present: Project;
}

export type HistoryListener = (change: HistoryChange) => void;

export interface Transaction {
  readonly label: string;
  readonly isOpen: boolean;
  /** Applies a command to the live state; on error nothing changes and the transaction stays open. */
  apply(command: Command): Result<Project, CommandError>;
  /** Replaces the live state by applying commands to the *pre-transaction* state (for absolute gestures). */
  applyFromStart(commands: readonly Command[]): Result<Project, CommandError>;
  commit(): void;
  cancel(): void;
}

export interface CommandHistory {
  readonly present: Project;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  readonly transactionOpen: boolean;
  execute(command: Command, options?: ExecuteOptions): Result<Project, CommandError>;
  /** Atomic: either every command applies (one entry) or none do. */
  executeBatch(
    commands: readonly Command[],
    options?: ExecuteOptions,
  ): Result<Project, CommandError>;
  beginTransaction(label: string): Transaction;
  undo(): boolean;
  redo(): boolean;
  /** Replaces the present (e.g. project opened) and clears undo/redo stacks. */
  reset(project: Project): void;
  entries(): { readonly undo: readonly HistoryEntry[]; readonly redo: readonly HistoryEntry[] };
  subscribe(listener: HistoryListener): () => void;
}
