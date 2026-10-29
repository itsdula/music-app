/**
 * Zustand view of the CommandHistory. The history is the single writer of project state;
 * this store mirrors `present` plus undo metadata for React selectors.
 */
import type { CommandHistory } from '@studio/commands';
import type { Project } from '@studio/domain';
import { createStore, type StoreApi } from 'zustand/vanilla';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface ProjectStoreState {
  readonly project: Project;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  readonly saveStatus: SaveStatus;
  readonly lastSavedAt: string | null;
}

export type ProjectStore = StoreApi<ProjectStoreState>;

function snapshot(history: CommandHistory): Pick<ProjectStoreState, 'project' | 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'> {
  return {
    project: history.present,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoLabel: history.undoLabel,
    redoLabel: history.redoLabel,
  };
}

export function createProjectStore(history: CommandHistory): { store: ProjectStore; detach: () => void } {
  const store = createStore<ProjectStoreState>()(() => ({
    ...snapshot(history),
    saveStatus: 'idle',
    lastSavedAt: null,
  }));
  const detach = history.subscribe(() => store.setState(snapshot(history)));
  return { store, detach };
}
