import { useCallback, useLayoutEffect, useRef } from 'react';
import { useCoalescedCallback } from './useCoalescedCallback';

export interface UseWheelStepOptions {
  value: number;
  /** Returns the next value for one wheel notch from `current` (direction +1 = up/right). */
  step: (current: number, direction: 1 | -1, fine: boolean) => number;
  onChange: (value: number) => void;
  enabled?: boolean;
}

/**
 * Returns a callback ref that attaches a non-passive `wheel` listener (React's onWheel is
 * passive, so it cannot stop the page from scrolling). Notches accumulate on top of any value
 * not yet delivered, and changes are coalesced to one per animation frame.
 */
export function useWheelStep(
  options: UseWheelStepOptions,
): (element: HTMLElement | null) => (() => void) | undefined {
  const { value, step, onChange, enabled = true } = options;
  const latest = useRef({ value, step, enabled });
  const pending = useRef<number | null>(null);
  const emitter = useCoalescedCallback((next: number) => {
    pending.current = null;
    onChange(next);
  });

  useLayoutEffect(() => {
    latest.current = { value, step, enabled };
  });

  return useCallback(
    (element: HTMLElement | null) => {
      if (!element) return undefined;
      const listener = (event: WheelEvent): void => {
        const current = latest.current;
        if (!current.enabled) return;
        // Shift+wheel becomes horizontal scrolling in some browsers; accept either axis.
        const delta =
          Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? -event.deltaY : event.deltaX;
        if (delta === 0) return;
        event.preventDefault();
        const base = pending.current ?? current.value;
        const next = current.step(base, delta > 0 ? 1 : -1, event.shiftKey);
        if (next === base) return;
        pending.current = next;
        emitter.schedule(next);
      };
      element.addEventListener('wheel', listener, { passive: false });
      return () => element.removeEventListener('wheel', listener);
    },
    [emitter],
  );
}
