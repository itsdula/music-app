import type { AssetId } from '@studio/domain';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useStore } from 'zustand';
import { TimeAxis } from '../../canvas/time-axis';
import { useSession, useUiState } from '../../session/context';
import { IDLE_VOCAL_STATE, type VocalAssetState } from '../../state/vocal-store';
import type { PitchAxis } from '../piano-roll/geometry';

/** Time and pitch axes of the vocal editor viewport (ui-store `vocal`). */
export function useVocalAxes(): { time: TimeAxis; pitch: PitchAxis } {
  const pxPerTick = useUiState((s) => s.vocal.pxPerTick);
  const scrollTick = useUiState((s) => s.vocal.scrollTick);
  const topPitch = useUiState((s) => s.vocal.topPitch);
  const rowHeight = useUiState((s) => s.vocal.rowHeight);
  const time = useMemo(() => new TimeAxis(pxPerTick, scrollTick), [pxPerTick, scrollTick]);
  const pitch = useMemo(() => ({ topPitch, rowHeight }), [topPitch, rowHeight]);
  return { time, pitch };
}

/**
 * Native keydown handling for an editor surface. The Studio's global shortcuts listen on
 * the shell element with a native listener, which runs *before* React's delegated
 * handlers, so `stopPropagation` in a React `onKeyDown` cannot keep e.g. Delete from also
 * deleting the selected clip. Handling the key natively on the (descendant) element and
 * stopping it there does. `handler` returns true for keys it consumed.
 */
export function useNativeKeyDown(
  ref: RefObject<HTMLElement | null>,
  handler: (event: KeyboardEvent) => boolean,
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (latest.current(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}

/** Job state of one asset in the vocal controller (phase, progress, rendering…). */
export function useVocalAssetState(assetId: AssetId): VocalAssetState {
  const session = useSession();
  return useStore(session.vocal.store, (s) => s.assets[assetId] ?? IDLE_VOCAL_STATE);
}
