import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { clamp } from '../lib/math';
import { useCoalescedCallback } from './useCoalescedCallback';

export interface UseValueDragOptions {
  /** Current (controlled) value; the drag starts from it. */
  value: number;
  min: number;
  max: number;
  /** Maps the raw accumulated drag value to a committed value (snap, clamp); `fine` = Shift held. */
  normalize: (raw: number, fine: boolean) => number;
  /** Value units per pixel of travel at normal speed. Read on every move. */
  unitsPerPixel: () => number;
  /** Multiplier applied while Shift is held. Default 0.1. */
  fineFactor?: number;
  /** Drag axis. Vertical: up increases. Horizontal: right increases. Default vertical. */
  axis?: 'vertical' | 'horizontal';
  /** Pixels of travel before a press becomes a drag. Default 0. */
  dragThreshold?: number;
  disabled?: boolean;
  /** Receives values coalesced to at most one per animation frame. */
  onChange: (value: number) => void;
  /** Called once when a drag ends (with the final value) or is cancelled (with the start value). */
  onChangeEnd?: (value: number) => void;
  /** Called when a press ends without exceeding the drag threshold. */
  onTap?: () => void;
}

export interface ValueDragHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface ValueDrag {
  /** True while a drag (past the threshold) is in progress. */
  dragging: boolean;
  handlers: ValueDragHandlers;
}

interface DragSession {
  pointerId: number;
  element: HTMLElement;
  startValue: number;
  raw: number;
  last: number;
  lastX: number;
  lastY: number;
  travelled: number;
  active: boolean;
}

/**
 * Relative pointer dragging for value controls (Knob, Fader, NumberField). Uses pointer capture,
 * Shift for fine adjustment, Escape / lost capture / pointercancel to revert to the start value,
 * and coalesces changes to one per animation frame.
 */
export function useValueDrag(options: UseValueDragOptions): ValueDrag {
  const {
    value,
    min,
    max,
    normalize,
    unitsPerPixel,
    fineFactor = 0.1,
    axis = 'vertical',
    dragThreshold = 0,
    disabled = false,
    onChange,
    onChangeEnd,
    onTap,
  } = options;
  const [dragging, setDragging] = useState(false);
  const sessionRef = useRef<DragSession | null>(null);
  const emitter = useCoalescedCallback(onChange);

  const end = (commit: boolean): void => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;
    const { element, pointerId } = session;
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId);
    setDragging(false);
    if (!session.active) {
      if (commit) onTap?.();
      return;
    }
    if (commit) {
      emitter.flush();
      onChangeEnd?.(session.last);
    } else {
      emitter.cancel();
      if (session.last !== session.startValue) onChange(session.startValue);
      onChangeEnd?.(session.startValue);
    }
  };

  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !sessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    end(false);
  });

  useEffect(() => {
    if (!dragging) return;
    const listener = (event: KeyboardEvent): void => onEscape(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [dragging]);

  const handlers: ValueDragHandlers = {
    onPointerDown(event) {
      if (disabled || event.button !== 0 || sessionRef.current) return;
      const element = event.currentTarget;
      event.preventDefault();
      if (dragThreshold === 0) element.focus({ preventScroll: true });
      element.setPointerCapture?.(event.pointerId);
      sessionRef.current = {
        pointerId: event.pointerId,
        element,
        startValue: value,
        raw: value,
        last: value,
        lastX: event.clientX,
        lastY: event.clientY,
        travelled: 0,
        active: dragThreshold === 0,
      };
      if (dragThreshold === 0) setDragging(true);
    },
    onPointerMove(event) {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const delta =
        axis === 'vertical' ? session.lastY - event.clientY : event.clientX - session.lastX;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      if (!session.active) {
        session.travelled += Math.abs(delta);
        if (session.travelled < dragThreshold) return;
        session.active = true;
        setDragging(true);
      }
      const speed = unitsPerPixel() * (event.shiftKey ? fineFactor : 1);
      session.raw = clamp(session.raw + delta * speed, min, max);
      const next = normalize(session.raw, event.shiftKey);
      if (next !== session.last) {
        session.last = next;
        emitter.schedule(next);
      }
    },
    onPointerUp(event) {
      if (sessionRef.current?.pointerId === event.pointerId) end(true);
    },
    onPointerCancel(event) {
      if (sessionRef.current?.pointerId === event.pointerId) end(false);
    },
    onLostPointerCapture(event) {
      if (sessionRef.current?.pointerId === event.pointerId) end(false);
    },
  };

  return { dragging, handlers };
}
