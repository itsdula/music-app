import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@studio/ui';
import { useState, type MouseEvent, type ReactElement } from 'react';
import {
  isAction,
  resolveMenu,
  shortcutHint,
  type MenuEntry,
  type MenuResolution,
} from './menu-model';

const isApple = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Renders normalized menu entries with the shared `ContextMenu*` primitives. */
export function MenuEntries({ entries }: { entries: readonly MenuEntry[] }) {
  const apple = isApple();
  return (
    <>
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <ContextMenuSeparator key={`sep-${i}`} />;
        if (entry.kind === 'label')
          return <ContextMenuLabel key={`label-${i}`}>{entry.label}</ContextMenuLabel>;
        if (entry.kind === 'submenu')
          return (
            <ContextMenuSub key={entry.id}>
              <ContextMenuSubTrigger
                disabled={entry.disabled ?? false}
                data-testid={`menu-${entry.id}`}
              >
                {entry.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent data-testid={`menu-${entry.id}-items`}>
                <MenuEntries entries={entry.items as readonly MenuEntry[]} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          );
        if (!isAction(entry)) return null;
        if (entry.checked !== undefined)
          return (
            <ContextMenuCheckboxItem
              key={entry.id}
              checked={entry.checked}
              disabled={entry.disabled ?? false}
              onSelect={entry.onSelect}
              data-testid={`menu-${entry.id}`}
            >
              <span className="flex-1 truncate">{entry.label}</span>
              {entry.shortcut ? (
                <kbd className="ml-4 text-[10px] text-text-faint">
                  {shortcutHint(entry.shortcut, apple)}
                </kbd>
              ) : null}
            </ContextMenuCheckboxItem>
          );
        return (
          <ContextMenuItem
            key={entry.id}
            icon={entry.icon}
            danger={entry.danger ?? false}
            disabled={entry.disabled ?? false}
            {...(entry.shortcut ? { shortcut: shortcutHint(entry.shortcut, apple) } : {})}
            onSelect={entry.onSelect}
            data-testid={`menu-${entry.id}`}
          >
            {entry.label}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

export interface StudioContextMenuProps {
  /** The element that opens the menu on right-click (rendered as the trigger via `asChild`). */
  readonly children: ReactElement;
  /**
   * Builds the menu for a right-click. Called synchronously from the `contextmenu` event, so
   * canvas editors can hit-test the pointer position (and update the selection) first.
   * Returning null or an empty list shows no menu (the browser menu stays suppressed).
   */
  readonly resolve: (event: MouseEvent<HTMLElement>) => MenuResolution;
  /**
   * Identifies the kind of element in `data-menu-target` (for tests and styling); a resolver
   * can override it per right-click (e.g. "region" vs "lane" on the same canvas).
   */
  readonly target: string;
  /** Accessible name of the menu. */
  readonly label?: string;
}

/**
 * Right-click menu for a Studio element. Every entry should go through the EditController or
 * `session.history` so it is undoable.
 */
export function StudioContextMenu({ children, resolve, target, label }: StudioContextMenuProps) {
  const [entries, setEntries] = useState<readonly MenuEntry[]>([]);
  const [menuTarget, setMenuTarget] = useState(target);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        asChild
        onContextMenu={(event) => {
          // A nested Studio menu (e.g. a track header inside the track list) already opened.
          if (event.defaultPrevented) return;
          const resolved = resolveMenu(resolve(event), target);
          setEntries(resolved.entries);
          setMenuTarget(resolved.target);
          // No entries: keep the browser menu away but do not open an empty Studio menu.
          if (resolved.entries.length === 0) event.preventDefault();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        data-testid="studio-context-menu"
        data-menu-target={menuTarget}
        aria-label={label ?? `${menuTarget} actions`}
        className="min-w-48"
        onCloseAutoFocus={(event) => {
          // An action that opened a text field (rename) keeps its focus.
          const active = document.activeElement;
          if (active instanceof HTMLElement && active.matches('input, textarea')) {
            event.preventDefault();
          }
        }}
      >
        <MenuEntries entries={entries} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
