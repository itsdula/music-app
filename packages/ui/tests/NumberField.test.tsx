import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NumberField, type NumberFieldProps } from '../src';

function Harness(props: Partial<NumberFieldProps> & { onSpy?: (v: number) => void }) {
  const { onSpy, ...rest } = props;
  const [value, setValue] = useState(props.value ?? 120);
  return (
    <NumberField
      label="Tempo"
      min={20}
      max={300}
      {...rest}
      value={value}
      onChange={(v) => {
        onSpy?.(v);
        setValue(v);
      }}
    />
  );
}

function setup(props: Partial<NumberFieldProps> = {}) {
  const spy = vi.fn<(value: number) => void>();
  render(<Harness onSpy={spy} {...props} />);
  return { spy, input: screen.getByRole('spinbutton', { name: 'Tempo' }) as HTMLInputElement };
}

describe('NumberField', () => {
  it('exposes spinbutton semantics and formats the value', () => {
    const { input } = setup({ step: 0.1, value: 120 });
    expect(input).toHaveValue('120.0');
    expect(input).toHaveAttribute('aria-valuenow', '120');
    expect(input).toHaveAttribute('aria-valuemin', '20');
    expect(input).toHaveAttribute('aria-valuemax', '300');
    expect(input).toHaveAttribute('aria-valuetext', '120.0');
  });

  it('steps with arrow keys (Shift = fine step), PageUp and Home/End', () => {
    const { input, spy } = setup({ fineStep: 0.1, format: (v) => v.toFixed(1) });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(spy).toHaveBeenLastCalledWith(121);
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(spy).toHaveBeenLastCalledWith(120.9);
    fireEvent.keyDown(input, { key: 'PageUp' });
    expect(spy).toHaveBeenLastCalledWith(130.9);
    fireEvent.keyDown(input, { key: 'End' });
    expect(spy).toHaveBeenLastCalledWith(300);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(spy).toHaveBeenCalledTimes(4);
    fireEvent.keyDown(input, { key: 'Home' });
    expect(spy).toHaveBeenLastCalledWith(20);
    expect(input).toHaveValue('20.0');
  });

  it('commits typed text on Enter (clamped) and reverts invalid input', () => {
    const { input, spy } = setup();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '128' } });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith(128);
    expect(input).toHaveValue('128');

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith(300);

    spy.mockClear();
    fireEvent.change(input, { target: { value: 'fast' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    expect(input).toHaveValue('300');
  });

  it('reverts on Escape and commits on blur', () => {
    const { input, spy } = setup();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('120');
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '95' } });
    act(() => input.blur());
    expect(spy).toHaveBeenLastCalledWith(95);
    expect(input).toHaveValue('95');
  });

  it('uses custom parse/format', () => {
    const { input, spy } = setup({
      format: (v) => `${v} bpm`,
      parse: (text) => {
        const n = Number.parseFloat(text);
        return Number.isFinite(n) ? n : null;
      },
    });
    expect(input).toHaveValue('120 bpm');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '100 bpm' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenLastCalledWith(100);
  });

  it('changes value by vertical drag, Shift for fine steps', () => {
    const { input, spy } = setup({ fineStep: 0.1, format: (v) => v.toFixed(1) });
    fireEvent.pointerDown(input, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(input, { pointerId: 1, clientY: 60 }); // 40px / 4px per step
    fireEvent.pointerUp(input, { pointerId: 1 });
    expect(spy).toHaveBeenLastCalledWith(130);
    expect(document.activeElement).not.toBe(input);

    fireEvent.pointerDown(input, { pointerId: 2, button: 0, clientY: 100 });
    fireEvent.pointerMove(input, { pointerId: 2, clientY: 60, shiftKey: true });
    fireEvent.pointerUp(input, { pointerId: 2 });
    expect(spy).toHaveBeenLastCalledWith(131);
  });

  it('focuses for typing when clicked without dragging', () => {
    const { input, spy } = setup();
    fireEvent.pointerDown(input, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(input, { pointerId: 1, clientY: 99 });
    fireEvent.pointerUp(input, { pointerId: 1 });
    expect(spy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('reverts a drag on Escape', () => {
    const { input, spy } = setup();
    fireEvent.pointerDown(input, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(input, { pointerId: 1, clientY: 20 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(spy).toHaveBeenLastCalledWith(120);
    expect(input).toHaveValue('120');
  });
});
