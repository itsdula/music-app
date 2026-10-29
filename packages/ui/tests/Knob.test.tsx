import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Knob } from '../src';

function setup(props: Partial<Parameters<typeof Knob>[0]> = {}) {
  const onChange = vi.fn<(value: number) => void>();
  const utils = render(
    <Knob label="Cutoff" value={0.5} onChange={onChange} step={0.01} {...props} />,
  );
  return { ...utils, onChange, knob: screen.getByRole('slider', { name: 'Cutoff' }) };
}

describe('Knob', () => {
  it('exposes slider semantics', () => {
    const { knob } = setup({ formatValue: (v) => `${Math.round(v * 100)}%` });
    expect(knob).toHaveAttribute('aria-valuemin', '0');
    expect(knob).toHaveAttribute('aria-valuemax', '1');
    expect(knob).toHaveAttribute('aria-valuenow', '0.5');
    expect(knob).toHaveAttribute('aria-valuetext', '50%');
    expect(knob).toHaveAttribute('tabindex', '0');
  });

  it('steps with the keyboard (Shift = fine, PageUp, Home/End, Delete resets)', () => {
    const { knob, onChange } = setup({ defaultValue: 0.25 });
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(knob, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith(0.49);
    fireEvent.keyDown(knob, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0.501);
    fireEvent.keyDown(knob, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(knob, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(knob, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(knob, { key: 'Delete' });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
  });

  it('changes value with vertical drag and Shift for fine control', () => {
    const { knob, onChange } = setup({ value: 0 });
    fireEvent.pointerDown(knob, { pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 150 }); // 50px of 200px range
    fireEvent.pointerUp(knob, { pointerId: 1, clientY: 150 });
    expect(onChange).toHaveBeenLastCalledWith(0.25);

    onChange.mockClear();
    fireEvent.pointerDown(knob, { pointerId: 2, button: 0, clientY: 200 });
    fireEvent.pointerMove(knob, { pointerId: 2, clientY: 150, shiftKey: true });
    fireEvent.pointerUp(knob, { pointerId: 2 });
    expect(onChange).toHaveBeenLastCalledWith(0.025);
  });

  it('coalesces drag updates to one change per animation frame', async () => {
    const { knob, onChange } = setup({ value: 0 });
    fireEvent.pointerDown(knob, { pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 190 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 180 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 170 });
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenLastCalledWith(0.15);
    fireEvent.pointerUp(knob, { pointerId: 1 });
  });

  it('reverts the drag on Escape', () => {
    const { knob, onChange } = setup({ value: 0.5 });
    fireEvent.pointerDown(knob, { pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 100 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    onChange.mockClear();
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 0 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('resets on double-click; bipolar knobs reset to the centre', () => {
    const { knob, onChange } = setup({ min: -1, max: 1, value: 0.7, bipolar: true });
    fireEvent.doubleClick(knob);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('steps with the mouse wheel', async () => {
    const { knob, onChange } = setup();
    fireEvent.wheel(knob, { deltaY: -100 });
    fireEvent.wheel(knob, { deltaY: -100 });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(0.52);
  });

  it('ignores input when disabled', () => {
    const { knob, onChange } = setup({ disabled: true });
    expect(knob).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(knob, { key: 'ArrowUp' });
    fireEvent.pointerDown(knob, { pointerId: 1, button: 0, clientY: 200 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientY: 100 });
    fireEvent.pointerUp(knob, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
