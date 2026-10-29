/**
 * DOM side of tutorial steps: resolving a target string to an element inside the Studio root
 * (never outside it), matching clicks against targets, and placing the step card.
 */
import { parseTarget, type ParsedTarget, type Placement, type TargetRole } from './schema';

/** Marks tutorial UI so it is never resolved as a target or counted as a target click. */
export const TUTORIAL_LAYER_ATTR = 'data-tutorial-layer';

const IMPLICIT_ROLE_SELECTORS: Partial<Record<TargetRole, string>> = {
  button: 'button, input[type="button"], input[type="submit"]',
  radio: 'input[type="radio"]',
  checkbox: 'input[type="checkbox"]',
  slider: 'input[type="range"]',
  textbox: 'textarea, input:not([type]), input[type="text"], input[type="search"]',
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function accessibleName(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return normalize(label);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const doc = el.ownerDocument;
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return normalize(text);
  }
  const text = el.textContent ?? '';
  if (text.trim()) return normalize(text);
  return normalize(el.getAttribute('title') ?? '');
}

function isOwnUi(el: Element): boolean {
  return el.closest(`[${TUTORIAL_LAYER_ATTR}]`) !== null;
}

function hasBox(el: Element): boolean {
  return el.getClientRects().length > 0;
}

/** All elements a parsed target refers to, in document order (tutorial UI excluded). */
function candidates(root: ParentNode, target: ParsedTarget): Element[] {
  if (target.kind === 'testid') {
    return [...root.querySelectorAll(`[data-testid="${target.id}"]`)].filter((e) => !isOwnUi(e));
  }
  const implicit = IMPLICIT_ROLE_SELECTORS[target.role];
  const selector = `[role="${target.role}"]${implicit ? `, ${implicit}` : ''}`;
  const all = [...root.querySelectorAll(selector)].filter((e) => {
    if (isOwnUi(e)) return false;
    const explicit = e.getAttribute('role');
    return !explicit || explicit === target.role;
  });
  const wanted = normalize(target.name);
  const exact = all.filter((e) => accessibleName(e) === wanted);
  return exact.length > 0 ? exact : all.filter((e) => accessibleName(e).startsWith(wanted));
}

/**
 * Resolves a target inside `root`. Prefers rendered (visible) matches; `:last` picks the last
 * one. Returns null for unknown forms or when nothing matches.
 */
export function resolveTarget(root: ParentNode, target: string): HTMLElement | null {
  const parsed = parseTarget(target);
  if (!parsed) return null;
  const found = candidates(root, parsed);
  if (found.length === 0) return null;
  const visible = found.filter(hasBox);
  const pool = visible.length > 0 ? visible : found;
  const pick = parsed.kind === 'testid' && parsed.pick === 'last' ? pool.at(-1) : pool[0];
  return (pick as HTMLElement | undefined) ?? null;
}

/** True when `el` is (inside) any element the target refers to. */
export function matchesTarget(root: ParentNode, target: string, el: Element): boolean {
  const parsed = parseTarget(target);
  if (!parsed || isOwnUi(el)) return false;
  return candidates(root, parsed).some((c) => c.contains(el));
}

// --- placement -----------------------------------------------------------------------------

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface CardPosition {
  readonly left: number;
  readonly top: number;
  readonly side: Exclude<Placement, 'auto'> | 'inside';
}

const GAP = 12;
const MARGIN = 8;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Places a card of `size` next to `target` (both relative to `bounds`' origin) on the preferred
 * side when it fits, else the roomiest side, else inside the target's bottom-right corner (for
 * targets as large as the screen), always clamped inside `bounds`.
 */
export function placeCard(
  target: Box | null,
  size: { readonly width: number; readonly height: number },
  bounds: { readonly width: number; readonly height: number },
  placement: Placement = 'auto',
): CardPosition {
  const maxLeft = Math.max(MARGIN, bounds.width - size.width - MARGIN);
  const maxTop = Math.max(MARGIN, bounds.height - size.height - MARGIN);
  if (!target || placement === 'center') {
    return {
      left: clamp((bounds.width - size.width) / 2, MARGIN, maxLeft),
      top: clamp((bounds.height - size.height) / 2, MARGIN, maxTop),
      side: 'center',
    };
  }
  const right = target.left + target.width;
  const bottom = target.top + target.height;
  const room = {
    bottom: bounds.height - MARGIN - (bottom + GAP),
    top: target.top - GAP - MARGIN,
    right: bounds.width - MARGIN - (right + GAP),
    left: target.left - GAP - MARGIN,
  };
  const fits = {
    bottom: room.bottom >= size.height,
    top: room.top >= size.height,
    right: room.right >= size.width,
    left: room.left >= size.width,
  };
  const sides = ['bottom', 'top', 'right', 'left'] as const;
  const byRoom = [...sides].sort((a, b) => {
    const need = (s: (typeof sides)[number]) =>
      s === 'bottom' || s === 'top' ? room[s] - size.height : room[s] - size.width;
    return need(b) - need(a);
  });
  const order = placement === 'auto' ? byRoom : [placement, ...byRoom];
  const side = order.find((s) => fits[s]);
  const centerX = target.left + target.width / 2 - size.width / 2;
  const centerY = target.top + target.height / 2 - size.height / 2;
  switch (side) {
    case 'bottom':
      return { left: clamp(centerX, MARGIN, maxLeft), top: bottom + GAP, side };
    case 'top':
      return { left: clamp(centerX, MARGIN, maxLeft), top: target.top - GAP - size.height, side };
    case 'right':
      return { left: right + GAP, top: clamp(centerY, MARGIN, maxTop), side };
    case 'left':
      return { left: target.left - GAP - size.width, top: clamp(centerY, MARGIN, maxTop), side };
    case undefined:
      return {
        left: clamp(right - size.width - 16, MARGIN, maxLeft),
        top: clamp(bottom - size.height - 16, MARGIN, maxTop),
        side: 'inside',
      };
  }
}
