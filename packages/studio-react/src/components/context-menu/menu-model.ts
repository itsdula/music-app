/**
 * Declarative context-menu model. Editors describe the actions valid for the element under
 * the pointer as plain data (label, shortcut hint, disabled state, handler); one renderer
 * turns it into the shared `ContextMenu*` primitives so every menu looks and behaves alike.
 */
import type { ReactNode } from 'react';

export interface MenuAction {
  readonly kind?: 'action';
  /** Stable id; rendered as `data-testid="menu-<id>"`. */
  readonly id: string;
  readonly label: string;
  /** Shortcut hint shown on the right (display only), e.g. "Mod+D", "Del". */
  readonly shortcut?: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  /** Renders a checkbox item (toggle state). */
  readonly checked?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSubmenu {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly items: readonly MenuEntryInput[];
}

export interface MenuSeparator {
  readonly kind: 'separator';
}

export interface MenuLabel {
  readonly kind: 'label';
  readonly label: string;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuSeparator | MenuLabel;

/** Builders may use `false`/`null`/`undefined` for conditional entries. */
export type MenuEntryInput = MenuEntry | false | null | undefined;

export const SEPARATOR: MenuSeparator = { kind: 'separator' };

export function isAction(entry: MenuEntry): entry is MenuAction {
  return entry.kind === undefined || entry.kind === 'action';
}

/**
 * Drops conditional (falsy) entries and empty submenus, and collapses separators so a menu
 * never starts, ends or doubles up on a divider. Labels that end up heading nothing are dropped.
 */
export function normalizeMenu(entries: readonly MenuEntryInput[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const raw of entries) {
    if (!raw) continue;
    let entry: MenuEntry = raw;
    if (entry.kind === 'submenu') {
      const items = normalizeMenu(entry.items);
      if (items.length === 0) continue;
      entry = { ...entry, items };
    }
    if (entry.kind === 'separator') {
      const last = out[out.length - 1];
      if (!last || last.kind === 'separator') continue;
      if (last.kind === 'label') out.pop();
      if (out.length === 0) continue;
    }
    out.push(entry);
  }
  while (out.length > 0) {
    const last = out[out.length - 1]!;
    if (last.kind === 'separator' || last.kind === 'label') out.pop();
    else break;
  }
  return out;
}

/** A resolver's answer: entries (for the default target), entries for a named target, or none. */
export type MenuResolution =
  | readonly MenuEntryInput[]
  | { readonly target?: string; readonly entries: readonly MenuEntryInput[] }
  | null;

function isEntryList(value: MenuResolution): value is readonly MenuEntryInput[] {
  return Array.isArray(value);
}

/** Normalizes a resolver's answer into the menu target and its entries. */
export function resolveMenu(
  result: MenuResolution,
  fallbackTarget: string,
): { readonly target: string; readonly entries: MenuEntry[] } {
  if (!result) return { target: fallbackTarget, entries: [] };
  if (isEntryList(result)) return { target: fallbackTarget, entries: normalizeMenu(result) };
  return { target: result.target ?? fallbackTarget, entries: normalizeMenu(result.entries) };
}

/** Shortcut hint for the platform ("⌘D" on Apple, "Ctrl+D" elsewhere). */
export function shortcutHint(spec: string, apple: boolean): string {
  return spec
    .split('+')
    .map((part) => {
      if (part === 'Mod') return apple ? '⌘' : 'Ctrl';
      if (part === 'Shift') return apple ? '⇧' : 'Shift';
      if (part === 'Alt') return apple ? '⌥' : 'Alt';
      return part;
    })
    .join(apple ? '' : '+');
}
