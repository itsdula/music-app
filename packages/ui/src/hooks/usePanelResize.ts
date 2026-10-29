import type { KeyboardEvent } from 'react';
import { clamp } from '../lib/math';
import { useValueDrag, type ValueDragHandlers } from './useValueDrag';

export interface UsePanelResizeOptions {
  /** Current panel size in px (controlled). */
  size: number;
  onSizeChange: (size: number) => void;
  min: number;
  max: number;
  /** Size restored by double-click (and Enter). Omit to disable reset. */
  defaultSize?: number;
  /**
   * ARIA orientation of the separator line. `vertical` (default) separates left/right panels
   * and resizes along x; `horizontal` separates top/bottom panels and resizes along y.
   */
  orientation?: 'vertical' | 'horizontal';
  /**
   * `1` (default) when the panel grows as the handle moves right/down (handle on the panel's
   * right/bottom edge); `-1` when the handle sits on the panel's left/top edge.
   */
  direction?: 1 | -1;
  /** Arrow-key step in px. Default 8. Shift uses `largeStep` (default 48). */
  step?: number;
  largeStep?: number;
  disabled?: boolean;
  /** Called once when a drag ends (or is cancelled), e.g. to persist the layout. */
  onResizeEnd?: (size: number) => void;
}

export interface PanelResizeHandleProps extends ValueDragHandlers {
  role: 'separator';
  tabIndex: number;
  'aria-orientation': 'vertical' | 'horizontal';
  'aria-valuenow': number;
  'aria-valuemin': number;
  'aria-valuemax': number;
  'aria-disabled'?: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

export interface PanelResize {
  resizing: boolean;
  handleProps: PanelResizeHandleProps;
}

/**
 * Splitter behaviour for a resizable panel: pointer-captured dragging (Escape or lost capture
 * reverts), rAF-coalesced updates, arrow keys (Shift = large step), Home/End and double-click
 * reset. Spread `handleProps` onto the handle element (or use `ResizeHandle`).
 */
export function usePanelResize(options: UsePanelResizeOptions): PanelResize {
  const {
    size,
    onSizeChange,
    min,
    max,
    defaultSize,
    orientation = 'vertical',
    direction = 1,
    step = 8,
    largeStep = 48,
    disabled = false,
    onResizeEnd,
  } = options;
  const alongX = orientation === 'vertical';
  const current = clamp(size, min, max);

  const { dragging, handlers } = useValueDrag({
    value: current,
    min,
    max,
    // useValueDrag measures +x to the right and +y upwards; panels grow downwards.
    axis: alongX ? 'horizontal' : 'vertical',
    unitsPerPixel: () => (alongX ? direction : -direction),
    fineFactor: 1,
    normalize: (raw) => clamp(Math.round(raw), min, max),
    disabled,
    onChange: onSizeChange,
    onChangeEnd: onResizeEnd,
  });

  const emit = (next: number): void => {
    const clamped = clamp(Math.round(next), min, max);
    if (clamped !== size) onSizeChange(clamped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (disabled) return;
    const amount = event.shiftKey ? largeStep : step;
    const grow = alongX
      ? { ArrowRight: direction, ArrowLeft: -direction }
      : { ArrowDown: direction, ArrowUp: -direction };
    const sign = (grow as Record<string, number | undefined>)[event.key];
    if (sign !== undefined) {
      event.preventDefault();
      emit(current + sign * amount);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      emit(min);
    } else if (event.key === 'End') {
      event.preventDefault();
      emit(max);
    } else if (event.key === 'Enter' && defaultSize !== undefined) {
      event.preventDefault();
      emit(defaultSize);
    }
  };

  return {
    resizing: dragging,
    handleProps: {
      role: 'separator',
      tabIndex: disabled ? -1 : 0,
      'aria-orientation': orientation,
      'aria-valuenow': current,
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-disabled': disabled || undefined,
      onKeyDown,
      onDoubleClick: () => {
        if (!disabled && defaultSize !== undefined) emit(defaultSize);
      },
      ...handlers,
    },
  };
}
