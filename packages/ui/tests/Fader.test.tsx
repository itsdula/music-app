import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Fader } from '../src';

const toDb = (v: number): string =>
  v === 0 ? '-inf dB' : `${(40 * Math.log10(v / 0.75)).toFixed(1)} dB`;

function setup(props: Partial<Parameters<typeof Fader>[0]> = {}) {
  const onChange = vi.fn<(value: number) => void>();
  const onChangeEnd = vi.fn<(value: number) => void>();
  render(
    <Fader
      label="Track 1 volume"
      value={0.5}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      formatValue={toDb}
      {...props}
    />,
  );
  return { onChange, onChangeEnd, fader: screen.getByRole('slider', { name: 'Track 1 volume' }) };
}

describe('Fader', () => {
  it('is a vertical slider over 0..1 with a formatted value text', () => {
    const { fader } = setup({ value: 0.75 });
    expect(fader).toHaveAttribute('aria-orientation', 'vertical');
    expect(fader).toHaveAttribute('aria-valuemin', '0');
    expect(fader).toHaveAttribute('aria-valuemax', '1');
    expect(fader).toHaveAttribute('aria-valuenow', '0.75');
    expect(fader).toHaveAttribute('aria-valuetext', '0.0 dB');
  });

  it('supports arrows, Shift, PageUp/PageDown and Home/End', () => {
    const { fader, onChange } = setup();
    fireEvent.keyDown(fader, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(fader, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(0.499);
    fireEvent.keyDown(fader, { key: 'PageUp' });
    expect(onChange).toHaveBeenLastCalledWith(0.6);
    fireEvent.keyDown(fader, { key: 'PageDown' });
    expect(onChange).toHaveBeenLastCalledWith(0.4);
    fireEvent.keyDown(fader, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(fader, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps keyboard changes at the ends', () => {
    const { fader, onChange } = setup({ value: 1 });
    fireEvent.keyDown(fader, { key: 'PageUp' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drags relative to the track (fallback 120px in jsdom)', () => {
    const { fader, onChange, onChangeEnd } = setup({ value: 0.25 });
    fireEvent.pointerDown(fader, { pointerId: 1, button: 0, clientY: 300 });
    fireEvent.pointerMove(fader, { pointerId: 1, clientY: 240 });
    fireEvent.pointerUp(fader, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.75);
    expect(onChangeEnd).toHaveBeenCalledWith(0.75);
  });

  it('cancels the drag when pointer capture is lost', () => {
    const { fader, onChange, onChangeEnd } = setup({ value: 0.25 });
    fireEvent.pointerDown(fader, { pointerId: 1, button: 0, clientY: 300 });
    fireEvent.pointerMove(fader, { pointerId: 1, clientY: 240 });
    fireEvent.lostPointerCapture(fader, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(0.25);
    expect(onChangeEnd).toHaveBeenCalledWith(0.25);
  });

  it('resets to defaultValue on double-click', () => {
    const { fader, onChange } = setup({ defaultValue: 0.75 });
    fireEvent.doubleClick(fader);
    expect(onChange).toHaveBeenLastCalledWith(0.75);
  });
});
