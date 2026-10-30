import { useEffect, useRef, type RefObject } from 'react';

/** Selector of the element that scopes Studio (see `Studio.tsx`). */
export const STUDIO_ROOT_SELECTOR = '[data-testid="studio-root"]';

/**
 * Whether the browser's own context menu should be suppressed for a right-click on `target`.
 * Text fields keep the native menu (spell-check, paste); everything else inside Studio either
 * opens a Studio menu or none.
 */
export function shouldSuppressNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  const editable = target.closest(
    'input, textarea, [contenteditable=""], [contenteditable="true"]',
  );
  if (!editable) return true;
  if (editable instanceof HTMLInputElement) {
    const textual = ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''];
    return !textual.includes(editable.type);
  }
  return false;
}

const installed = new WeakMap<Element, { count: number; dispose: () => void }>();

/**
 * Installs one (ref-counted) `contextmenu` listener for a Studio root that prevents the browser
 * menu for right-clicks inside it that no Studio menu claimed. Returns the release function.
 *
 * The listener sits on the document (bubble phase) so it runs after React's delegated
 * handlers: preventing the default any earlier would stop Radix from opening Studio's menu.
 */
export function installNativeMenuGuard(root: Element): () => void {
  const existing = installed.get(root);
  if (existing) {
    existing.count += 1;
  } else {
    const doc = root.ownerDocument;
    const onContextMenu = (event: Event) => {
      if (event.defaultPrevented) return; // a Studio menu opened (Radix prevents the default)
      if (!(event.target instanceof Node) || !root.contains(event.target)) return;
      if (shouldSuppressNativeMenu(event.target)) event.preventDefault();
    };
    doc.addEventListener('contextmenu', onContextMenu);
    installed.set(root, {
      count: 1,
      dispose: () => doc.removeEventListener('contextmenu', onContextMenu),
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = installed.get(root);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      entry.dispose();
      installed.delete(root);
    }
  };
}

/**
 * Suppresses the browser context menu inside the Studio root that contains `ref` (or inside
 * `ref` itself when no Studio root encloses it).
 */
export function useNativeMenuGuard(ref: RefObject<Element | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return installNativeMenuGuard(el.closest(STUDIO_ROOT_SELECTOR) ?? el);
  }, [ref]);
}

/**
 * Drop-in guard for components that do not own the Studio root: renders an invisible marker
 * and installs the root-wide guard while mounted.
 */
export function NativeContextMenuGuard() {
  const ref = useRef<HTMLSpanElement>(null);
  useNativeMenuGuard(ref);
  return <span ref={ref} hidden aria-hidden data-native-menu-guard="" />;
}
