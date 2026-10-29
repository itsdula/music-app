import type { VocalActions } from './actions';

export type VocalKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'
>;

/**
 * Keyboard commands shared by the canvas and the notes table. Returns true when handled.
 * `splitTimes` yields candidate split positions (playhead, then pointer) in source seconds.
 *
 * Delete/Backspace, S and M are always consumed while the editor has focus so they never
 * fall through to the global shortcuts (delete the selected clip, toggle the metronome).
 */
export function handleVocalKey(
  e: VocalKeyEvent,
  actions: VocalActions,
  splitTimes: () => readonly (number | null)[],
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  if ((key === 'ArrowUp' || key === 'ArrowDown') && !mod && !e.altKey) {
    if (actions.selection().size === 0) return false;
    actions.nudge(key === 'ArrowUp' ? 1 : -1, e.shiftKey);
    return true;
  }
  if (key === 'Delete' || key === 'Backspace') {
    actions.resetSelected();
    return true;
  }
  if (mod && !e.altKey && !e.shiftKey && key.toLowerCase() === 'a') {
    actions.selectAll();
    return true;
  }
  if (mod || e.altKey) return false;
  if (key.toLowerCase() === 's') {
    actions.split(splitTimes());
    return true;
  }
  if (key.toLowerCase() === 'm') {
    actions.merge();
    return true;
  }
  if (key === 'Escape') {
    if (actions.selection().size === 0) return false;
    actions.clearSelection();
    return true;
  }
  return false;
}
