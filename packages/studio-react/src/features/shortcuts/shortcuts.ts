/**
 * Keyboard shortcut definitions (pure) — matched by `matchShortcut`, displayed in tooltips.
 * `Mod` is Cmd on Apple platforms and Ctrl elsewhere.
 */
export type ShortcutAction =
  | 'togglePlay'
  | 'rewind'
  | 'record'
  | 'toggleLoop'
  | 'toggleMetronome'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'duplicate'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'split'
  | 'selectAll'
  | 'quantize'
  | 'toggleBrowser'
  | 'toggleEditor'
  | 'zoomIn'
  | 'zoomOut'
  | 'escape';

export interface ShortcutBinding {
  readonly action: ShortcutAction;
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export const SHORTCUTS: readonly ShortcutBinding[] = [
  { action: 'togglePlay', key: ' ' },
  { action: 'rewind', key: 'Home' },
  { action: 'record', key: 'r' },
  { action: 'toggleLoop', key: 'l' },
  { action: 'toggleMetronome', key: 'm' },
  { action: 'undo', key: 'z', mod: true },
  { action: 'redo', key: 'z', mod: true, shift: true },
  { action: 'redo', key: 'y', mod: true },
  { action: 'delete', key: 'Delete' },
  { action: 'delete', key: 'Backspace' },
  { action: 'duplicate', key: 'd', mod: true },
  { action: 'copy', key: 'c', mod: true },
  { action: 'cut', key: 'x', mod: true },
  { action: 'paste', key: 'v', mod: true },
  { action: 'split', key: 'e', mod: true },
  { action: 'selectAll', key: 'a', mod: true },
  { action: 'quantize', key: 'q' },
  { action: 'toggleBrowser', key: 'b', mod: true },
  { action: 'toggleEditor', key: 'j', mod: true },
  { action: 'zoomIn', key: '=' },
  { action: 'zoomIn', key: '+' },
  { action: 'zoomOut', key: '-' },
  { action: 'escape', key: 'Escape' },
];

export interface KeyLike {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function matchShortcut(
  event: KeyLike,
  isApple: boolean,
  bindings: readonly ShortcutBinding[] = SHORTCUTS,
): ShortcutAction | null {
  const mod = isApple ? event.metaKey : event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  for (const b of bindings) {
    if (b.key !== key) continue;
    if (Boolean(b.mod) !== mod) continue;
    if (Boolean(b.shift) !== event.shiftKey && b.key !== '+') continue;
    if (Boolean(b.alt) !== event.altKey) continue;
    return b.action;
  }
  return null;
}

/** True when keyboard input should go to a text field instead of shortcuts. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'range'].includes(type);
  }
  return el.getAttribute('role') === 'spinbutton';
}
