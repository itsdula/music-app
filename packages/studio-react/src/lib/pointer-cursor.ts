/**
 * Pointer cursor policy for the canvas editors (arrangement regions, piano-roll notes).
 *
 * `resolveCursor` is a pure function of what is under the pointer (a hit-test result), the
 * active tool, the held modifiers and the gesture phase, so every editor shows the same
 * cursor for the same action — before the press (hover) and while dragging.
 */
import type { EditTool } from '../state/ui-store';

/** What the pointer is over, as reported by an editor's hit test. */
export type CursorTarget =
  /** Empty canvas (lane background, empty grid). */
  | 'empty'
  /** The body of a region or note: press-and-drag moves it. */
  | 'body'
  /** Left edge: drag trims the start (regions) / resizes the start (notes). */
  | 'start-edge'
  /** Right edge: drag trims the end / resizes the note length. */
  | 'end-edge'
  /** Region loop handle (top-right corner): drag extends the region by repeating its content. */
  | 'loop-handle';

export interface CursorModifiers {
  /** Alt/Option: duplicate-drag on a body. */
  readonly alt: boolean;
}

export interface CursorInput {
  readonly target: CursorTarget;
  readonly tool: EditTool;
  readonly modifiers: CursorModifiers;
  /** A press-and-drag gesture is in progress (the target is the one grabbed at press time). */
  readonly dragging?: boolean;
  /**
   * False when the action under the pointer cannot be performed (e.g. dropping a MIDI region
   * on an audio track, drawing outside the editable range, creating a MIDI clip on an audio
   * lane). Defaults to true.
   */
  readonly allowed?: boolean;
}

/** Custom "loop" cursor (a circular arrow) with a standard resize fallback. */
const LOOP_CURSOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
  '<path d="M4 10a6 6 0 0 1 10.2-4.3" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M4 10a6 6 0 0 1 10.2-4.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M16 10a6 6 0 0 1-10.2 4.3" fill="none" stroke="#000" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M16 10a6 6 0 0 1-10.2 4.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>' +
  '<path d="M15.5 2.5v4.5h-4.5z" fill="#fff" stroke="#000" stroke-width="1"/>' +
  '<path d="M4.5 17.5v-4.5h4.5z" fill="#fff" stroke="#000" stroke-width="1"/>' +
  '</svg>';

export const CURSORS = {
  default: 'default',
  grab: 'grab',
  grabbing: 'grabbing',
  resize: 'ew-resize',
  loop: `url("data:image/svg+xml,${encodeURIComponent(LOOP_CURSOR_SVG)}") 10 10, e-resize`,
  draw: 'crosshair',
  copy: 'copy',
  notAllowed: 'not-allowed',
} as const;

export type CursorValue = (typeof CURSORS)[keyof typeof CURSORS];

export function resolveCursor(input: CursorInput): CursorValue {
  const { target, tool, modifiers, dragging = false, allowed = true } = input;
  if (!allowed) return CURSORS.notAllowed;
  switch (target) {
    case 'start-edge':
    case 'end-edge':
      return CURSORS.resize;
    case 'loop-handle':
      return CURSORS.loop;
    case 'body':
      if (modifiers.alt) return CURSORS.copy;
      return dragging ? CURSORS.grabbing : CURSORS.grab;
    case 'empty':
      // Draw tool creates content; a select-tool drag on empty space is a marquee.
      if (tool === 'draw') return CURSORS.draw;
      return dragging ? CURSORS.draw : CURSORS.default;
  }
}
