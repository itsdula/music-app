import { useEffect, useRef } from 'react';
import type { FrameCallback } from '../canvas/render-loop';
import { useSession } from '../session/context';

/** Runs `callback` on every animation frame via the session's shared render loop. */
export function useFrame(callback: FrameCallback, enabled = true): void {
  const { renderLoop } = useSession();
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  });
  useEffect(() => {
    if (!enabled) return;
    return renderLoop.add((t) => ref.current(t));
  }, [renderLoop, enabled]);
}
