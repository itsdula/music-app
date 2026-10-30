/**
 * Click-away selection rules.
 *
 * Regions of the UI declare a zone with `data-selection-zone="<name>"`. On every pointer press
 * inside the Studio, the nearest zone up the DOM from the press target decides which kinds of
 * selection the press drops, *before* the region's own handlers run (they may then select
 * something new). Presses outside any zone, and in `keep` zones, leave the selection alone, so
 * editors, panels and toolbars can be used without losing the clip they operate on.
 *
 *   track-list    empty space in the track header column → drops track and clip selection
 *   track         a track header → drops clip selection (the header then selects its track)
 *   keep          nested override, e.g. the M/S/arm buttons inside a track header
 *
 * Canvas regions that need hit-testing (the arrangement lanes) don't declare a zone; they
 * apply `clearSelection` themselves after deciding what was hit.
 */
import type { UiState, UiStore } from './ui-store';
import { openClipInEditor } from './ui-store';

/** `track`: the selected track. `clips`: clip selection, the open editor clip and its notes. */
export type SelectionKind = 'track' | 'clips';

export const SELECTION_ZONES = {
  'track-list': ['track', 'clips'],
  track: ['clips'],
  keep: [],
} as const satisfies Record<string, readonly SelectionKind[]>;

export type SelectionZone = keyof typeof SELECTION_ZONES;

export const SELECTION_ZONE_ATTRIBUTE = 'data-selection-zone';

/** Spread onto an element to declare its zone: `<div {...selectionZone('track')}>`. */
export function selectionZone(zone: SelectionZone): {
  readonly [SELECTION_ZONE_ATTRIBUTE]: string;
} {
  return { [SELECTION_ZONE_ATTRIBUTE]: zone };
}

const EMPTY_SET: ReadonlySet<never> = new Set<never>();

/** Drops the given kinds of selection. Returns the same state when nothing changes. */
export function clearSelection(state: UiState, kinds: readonly SelectionKind[]): UiState {
  let next = state;
  if (kinds.includes('track') && next.selection.trackId !== null)
    next = { ...next, selection: { ...next.selection, trackId: null } };
  if (kinds.includes('clips')) {
    next = openClipInEditor(next, null);
    if (next.selection.clipIds.size > 0 || next.selection.noteIds.size > 0)
      next = {
        ...next,
        selection: { ...next.selection, clipIds: EMPTY_SET, noteIds: EMPTY_SET },
      };
  }
  return next;
}

/** The kinds a press on `target` drops, or an empty list when it keeps everything. */
export function selectionKindsForTarget(
  target: EventTarget | null,
  root: Element,
): readonly SelectionKind[] {
  if (!(target instanceof Element)) return [];
  const zone = target.closest(`[${SELECTION_ZONE_ATTRIBUTE}]`);
  if (!zone || !root.contains(zone)) return [];
  const name = zone.getAttribute(SELECTION_ZONE_ATTRIBUTE);
  return name && name in SELECTION_ZONES ? SELECTION_ZONES[name as SelectionZone] : [];
}

/** Applies the zone rules to presses inside `root`. Returns a disposer. */
export function installSelectionZones(root: HTMLElement, store: UiStore): () => void {
  const onPointerDown = (event: PointerEvent) => {
    const kinds = selectionKindsForTarget(event.target, root);
    if (kinds.length > 0) store.setState((s) => clearSelection(s, kinds));
  };
  // Capture phase: runs before the region's own handlers, which may select something new.
  root.addEventListener('pointerdown', onPointerDown, { capture: true });
  return () => root.removeEventListener('pointerdown', onPointerDown, { capture: true });
}
