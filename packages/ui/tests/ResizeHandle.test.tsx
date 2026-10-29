import { useState } from 'react';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResizeHandle, usePanelResize, type ResizeHandleProps } from '../src';

function Harness(
  props: Partial<ResizeHandleProps> & { onSpy: (v: number) => void; initial?: number },
) {
  const { onSpy, initial = 240, ...rest } = props;
  const [size, setSize] = useState(initial);
  return (
    <ResizeHandle
      label="Resize browser"
      min={160}
      max={480}
      defaultSize={240}
      {...rest}
      size={size}
      onSizeChange={(next) => {
        onSpy(next);
        setSize(next);
      }}
    />
  );
}

function setup(props: Partial<ResizeHandleProps> & { initial?: number } = {}) {
  const spy = vi.fn<(v: number) => void>();
  render(<Harness onSpy={spy} {...props} />);
  return { spy, handle: screen.getByRole('separator', { name: 'Resize browser' }) };
}

describe('ResizeHandle / usePanelResize', () => {
  it('exposes separator semantics', () => {
    const { handle } = setup();
    expect(handle).toHaveAttribute('aria-orientation', 'vertical');
    expect(handle).toHaveAttribute('aria-valuenow', '240');
    expect(handle).toHaveAttribute('aria-valuemin', '160');
    expect(handle).toHaveAttribute('aria-valuemax', '480');
    expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('resizes with arrow keys (Shift = large step) and clamps with Home/End', () => {
    const { handle, spy } = setup();
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(spy).toHaveBeenLastCalledWith(248);
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(200);
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(spy).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(spy).toHaveBeenLastCalledWith(480);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(spy).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(spy).toHaveBeenLastCalledWith(160);
  });

  it('inverts keys for a handle on the leading edge (direction = -1)', () => {
    const { handle, spy } = setup({ direction: -1 });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(spy).toHaveBeenLastCalledWith(248);
  });

  it('uses Up/Down and the y axis for horizontal separators', () => {
    const { handle, spy } = setup({ orientation: 'horizontal' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(spy).toHaveBeenLastCalledWith(248);
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 0, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 0, clientY: 130 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(spy).toHaveBeenLastCalledWith(278);
  });

  it('drags with pointer capture, clamping to min/max', () => {
    const onResizeEnd = vi.fn<(v: number) => void>();
    const { handle, spy } = setup({ onResizeEnd });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 350 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(spy).toHaveBeenLastCalledWith(290);
    expect(onResizeEnd).toHaveBeenCalledWith(290);

    fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 1000 });
    fireEvent.pointerUp(handle, { pointerId: 2 });
    expect(spy).toHaveBeenLastCalledWith(480);
  });

  it('cancels a drag on Escape and resets on double-click', () => {
    const { handle, spy } = setup({ initial: 300 });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(spy).toHaveBeenLastCalledWith(300);
    expect(handle).toHaveAttribute('aria-valuenow', '300');

    fireEvent.doubleClick(handle);
    expect(spy).toHaveBeenLastCalledWith(240);
  });

  it('can be used as a hook', () => {
    const onSizeChange = vi.fn<(v: number) => void>();
    const { result } = renderHook(() =>
      usePanelResize({ size: 200, onSizeChange, min: 100, max: 400 }),
    );
    expect(result.current.resizing).toBe(false);
    expect(result.current.handleProps.role).toBe('separator');
    expect(result.current.handleProps['aria-valuenow']).toBe(200);
  });
});
