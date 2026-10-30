import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  SEPARATOR,
  StudioContextMenu,
  installNativeMenuGuard,
  normalizeMenu,
  resolveMenu,
  shortcutHint,
  shouldSuppressNativeMenu,
  type MenuEntryInput,
} from '../src/components/context-menu';

const noop = () => undefined;

describe('menu model', () => {
  it('drops conditional entries, empty submenus and stray separators', () => {
    const entries: MenuEntryInput[] = [
      SEPARATOR,
      { id: 'a', label: 'A', onSelect: noop },
      false,
      SEPARATOR,
      null,
      SEPARATOR,
      { kind: 'submenu', id: 'empty', label: 'Empty', items: [false, SEPARATOR] },
      { kind: 'label', label: 'Heading with nothing below' },
      SEPARATOR,
      { id: 'b', label: 'B', onSelect: noop },
      SEPARATOR,
      undefined,
    ];
    const out = normalizeMenu(entries);
    expect(out.map((e) => ('id' in e ? e.id : e.kind))).toEqual(['a', 'separator', 'b']);
  });

  it('resolves a target override or falls back to the default target', () => {
    const a = { id: 'a', label: 'A', onSelect: noop };
    expect(resolveMenu([a], 'lane')).toMatchObject({ target: 'lane', entries: [a] });
    expect(resolveMenu({ target: 'region', entries: [a] }, 'lane')).toMatchObject({
      target: 'region',
    });
    expect(resolveMenu(null, 'lane')).toEqual({ target: 'lane', entries: [] });
  });

  it('formats shortcut hints per platform', () => {
    expect(shortcutHint('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z');
    expect(shortcutHint('Mod+D', true)).toBe('⌘D');
    expect(shortcutHint('Del', true)).toBe('Del');
  });
});

describe('native menu guard', () => {
  it('suppresses the browser menu except in text fields', () => {
    const div = document.createElement('div');
    const text = document.createElement('input');
    const range = document.createElement('input');
    range.type = 'range';
    const area = document.createElement('textarea');
    expect(shouldSuppressNativeMenu(div)).toBe(true);
    expect(shouldSuppressNativeMenu(text)).toBe(false);
    expect(shouldSuppressNativeMenu(area)).toBe(false);
    expect(shouldSuppressNativeMenu(range)).toBe(true);
  });

  it('prevents unclaimed right-clicks inside the root only, ref-counted', () => {
    const root = document.createElement('div');
    const inner = document.createElement('span');
    const outside = document.createElement('span');
    root.append(inner);
    document.body.append(root, outside);
    const fire = (target: Element) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const releaseA = installNativeMenuGuard(root);
    const releaseB = installNativeMenuGuard(root);
    expect(fire(inner)).toBe(true);
    expect(fire(outside)).toBe(false);
    releaseA();
    expect(fire(inner)).toBe(true); // still held by B
    releaseB();
    expect(fire(inner)).toBe(false);
    root.remove();
    outside.remove();
  });
});

describe('<StudioContextMenu />', () => {
  it('builds the menu at right-click time and runs the chosen action', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const resolve = vi.fn(() => ({
      target: 'thing',
      entries: [
        { id: 'go', label: 'Go', shortcut: 'Mod+G', onSelect: run },
        { id: 'off', label: 'Unavailable', disabled: true, onSelect: run },
      ],
    }));
    render(
      <StudioContextMenu target="fallback" resolve={resolve}>
        <div data-testid="area">area</div>
      </StudioContextMenu>,
    );
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.contextMenu(screen.getByTestId('area'), { clientX: 10, clientY: 10 });
    const menu = await screen.findByTestId('studio-context-menu');
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(menu).toHaveAttribute('data-menu-target', 'thing');
    expect(screen.getByTestId('menu-off')).toHaveAttribute('data-disabled');
    expect(screen.getByTestId('menu-go')).toHaveTextContent('Ctrl+G');
    await user.click(screen.getByTestId('menu-go'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('opens nothing (and keeps the browser menu away) when no action applies', () => {
    render(
      <StudioContextMenu target="nothing" resolve={() => []}>
        <div data-testid="area">area</div>
      </StudioContextMenu>,
    );
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByTestId('area').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('studio-context-menu')).toBeNull();
  });
});
