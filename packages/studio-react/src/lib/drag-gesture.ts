/**
 * Pointer drag lifecycle with capture, a movement threshold and Escape cancellation:
 *   pressed → (threshold) → dragging → commit (pointerup) | cancel (Escape / lost capture)
 * Move callbacks are coalesced to one per animation frame.
 */
export interface DragGestureOptions {
  /** Pixels the pointer must travel before the drag starts. */
  readonly threshold?: number;
  /** Called once when the threshold is crossed. */
  readonly onDragStart?: () => void;
  /** Called (≤ once per frame) with the offset from the press position. */
  readonly onDrag: (dx: number, dy: number, event: PointerEvent) => void;
  /**
   * Called when the gesture ends. `committed` is false when cancelled; `dragged` is false for
   * a plain click.
   */
  readonly onEnd: (result: { committed: boolean; dragged: boolean; event: PointerEvent | null }) => void;
}

export function startDragGesture(down: PointerEvent, element: Element, options: DragGestureOptions): () => void {
  const threshold = options.threshold ?? 3;
  const startX = down.clientX;
  const startY = down.clientY;
  let dragging = false;
  let finished = false;
  let frame: number | null = null;
  let pending: PointerEvent | null = null;

  try {
    element.setPointerCapture(down.pointerId);
  } catch {
    // Element may not support capture (e.g. detached); the gesture still works while the pointer is over it.
  }

  const flush = () => {
    frame = null;
    if (!pending || finished) return;
    const e = pending;
    pending = null;
    options.onDrag(e.clientX - startX, e.clientY - startY, e);
  };

  const onMove = (e: Event) => {
    const event = e as PointerEvent;
    if (event.pointerId !== down.pointerId || finished) return;
    if (!dragging) {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) < threshold) return;
      dragging = true;
      options.onDragStart?.();
    }
    pending = event;
    if (frame === null) frame = requestAnimationFrame(flush);
  };

  const finish = (committed: boolean, event: PointerEvent | null) => {
    if (finished) return;
    if (committed && pending) {
      if (frame !== null) cancelAnimationFrame(frame);
      flush();
    }
    finished = true;
    if (frame !== null) cancelAnimationFrame(frame);
    cleanup();
    options.onEnd({ committed, dragged: dragging, event });
  };

  const onUp = (e: Event) => {
    const event = e as PointerEvent;
    if (event.pointerId === down.pointerId) finish(true, event);
  };
  const onCancel = (e: Event) => {
    const event = e as PointerEvent;
    if (event.pointerId === down.pointerId) finish(false, event);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(false, null);
    }
  };

  const cleanup = () => {
    element.removeEventListener('pointermove', onMove);
    element.removeEventListener('pointerup', onUp);
    element.removeEventListener('pointercancel', onCancel);
    element.removeEventListener('lostpointercapture', onCancel);
    window.removeEventListener('keydown', onKey, true);
    try {
      if (element.hasPointerCapture(down.pointerId)) element.releasePointerCapture(down.pointerId);
    } catch {
      // ignore
    }
  };

  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onCancel);
  element.addEventListener('lostpointercapture', onCancel);
  window.addEventListener('keydown', onKey, true);
  return () => finish(false, null);
}
