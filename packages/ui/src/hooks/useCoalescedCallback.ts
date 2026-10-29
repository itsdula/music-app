import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export interface CoalescedCallback<T> {
  /** Queues `value`; the callback receives at most one (the latest) value per animation frame. */
  schedule: (value: T) => void;
  /** Delivers a queued value synchronously (e.g. on pointerup). */
  flush: () => void;
  /** Drops a queued value without delivering it. */
  cancel: () => void;
}

interface CoalescerState<T> {
  frame: number | null;
  pending: { value: T } | null;
}

const hasRaf = (): boolean => typeof requestAnimationFrame === 'function';

/**
 * Coalesces a high-frequency stream of values (pointer drags, wheel) into at most one callback
 * per animation frame, so parents never re-render more than once per frame.
 */
export function useCoalescedCallback<T>(callback: (value: T) => void): CoalescedCallback<T> {
  const callbackRef = useRef(callback);
  const stateRef = useRef<CoalescerState<T>>({ frame: null, pending: null });

  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const state = stateRef.current;
    return () => {
      if (state.frame !== null && hasRaf()) cancelAnimationFrame(state.frame);
      state.frame = null;
      state.pending = null;
    };
  }, []);

  return useMemo<CoalescedCallback<T>>(() => {
    const deliver = (): void => {
      const state = stateRef.current;
      const pending = state.pending;
      state.pending = null;
      if (pending) callbackRef.current(pending.value);
    };
    const cancelFrame = (): void => {
      const state = stateRef.current;
      if (state.frame !== null && hasRaf()) cancelAnimationFrame(state.frame);
      state.frame = null;
    };
    return {
      schedule(value) {
        const state = stateRef.current;
        state.pending = { value };
        if (!hasRaf()) {
          deliver();
          return;
        }
        if (state.frame === null) {
          state.frame = requestAnimationFrame(() => {
            state.frame = null;
            deliver();
          });
        }
      },
      flush() {
        cancelFrame();
        deliver();
      },
      cancel() {
        cancelFrame();
        stateRef.current.pending = null;
      },
    };
  }, []);
}
