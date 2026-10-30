/**
 * What adding a browser item does, shared by double-click/Enter in the browser and drops on
 * the arrangement, a track header or the track device panel. Each action also reveals its
 * result, so the addition is visible wherever it landed.
 */
import type { TrackId } from '@studio/domain';
import type { StudioSession } from '../../session/studio-session';
import { clearSelection } from '../../state/selection-zones';
import { selectTrack, type BottomPanel } from '../../state/ui-store';
import { BROWSER_DRAG_MIME, decodeBrowserItem, type BrowserItem } from './browser-items';

export interface BrowserItemTarget {
  /** Track the item was dropped on (null: none); omitted means the selected track. */
  readonly trackId?: TrackId | null;
  /** Timeline position for audio; defaults to the cursor. */
  readonly tick?: number;
}

export function activateBrowserItem(
  session: StudioSession,
  item: BrowserItem,
  target: BrowserItemTarget = {},
): void {
  const { edits, uiStore, history } = session;
  const reveal = (bottomPanel: BottomPanel) =>
    uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomOpen: true, bottomPanel } }));
  const trackId =
    target.trackId !== undefined ? target.trackId : uiStore.getState().selection.trackId;
  const tick = target.tick ?? session.engineStore.getState().cursorTick;

  if (item.kind === 'instrument') {
    // addTrack selects the new track; show its devices rather than a clip of another track.
    edits.addTrack('instrument', {
      instrument: item.instrument,
      ...(item.presetId ? { presetId: item.presetId } : {}),
      name: item.instrument === 'synth' ? item.label : undefined,
    });
    uiStore.setState((s) => clearSelection(s, ['clips']));
    reveal('track');
  } else if (item.kind === 'effect') {
    const effectTarget = trackId && history.present.tracks[trackId] ? trackId : 'master';
    edits.addEffect(effectTarget, item.effect);
    if (effectTarget === 'master') reveal('mixer');
    else {
      uiStore.setState((s) => selectTrack(s, effectTarget));
      reveal('track');
    }
  } else {
    const audioTrack =
      trackId && history.present.tracks[trackId]?.kind !== 'instrument' ? trackId : null;
    edits.placeAsset(item.assetId, audioTrack, tick);
  }
}

/** True when a drag carries a browser item (types are readable during dragover; data is not). */
export function isBrowserItemDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(BROWSER_DRAG_MIME);
}

export function browserItemFromDrop(e: React.DragEvent): BrowserItem | null {
  return decodeBrowserItem(e.dataTransfer.getData(BROWSER_DRAG_MIME));
}
