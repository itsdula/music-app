import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Meter, dbToMeterPosition, type MeterHandle } from '../src';

function mockCanvas() {
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '' as unknown,
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ctx as unknown as CanvasRenderingContext2D,
  );
  return ctx;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Meter', () => {
  it('maps the -60..+6 dB scale', () => {
    expect(dbToMeterPosition(-60)).toBe(0);
    expect(dbToMeterPosition(6)).toBe(1);
    expect(dbToMeterPosition(-100)).toBe(0);
    expect(dbToMeterPosition(0)).toBeCloseTo(60 / 66);
  });

  it('draws via the imperative handle without re-rendering', () => {
    const ctx = mockCanvas();
    const ref = createRef<MeterHandle>();
    render(<Meter ref={ref} label="Master level" />);
    expect(screen.getByRole('group', { name: 'Master level' })).toBeInTheDocument();
    ctx.fillRect.mockClear();
    expect(() => ref.current!.setLevels([0.5, 0.25], false)).not.toThrow();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    expect(() => ref.current!.setLevels([0, 0], false)).not.toThrow();
    expect(() => ref.current!.reset()).not.toThrow();
  });

  it('draws horizontally and tolerates a missing 2D context', () => {
    const ref = createRef<MeterHandle>();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    render(<Meter ref={ref} label="Input" orientation="horizontal" channels={1} />);
    expect(() => ref.current!.setLevels([0.9], false)).not.toThrow();
  });

  it('latches clipping until clicked and calls onClipReset', () => {
    mockCanvas();
    const ref = createRef<MeterHandle>();
    const onClipReset = vi.fn();
    render(<Meter ref={ref} label="Master level" onClipReset={onClipReset} />);
    const clip = screen.getByRole('button', { name: /no clip/ });
    expect(clip).toBeDisabled();

    act(() => ref.current!.setLevels([1.4, 0.8], true));
    const latched = screen.getByRole('button', { name: /clipped/ });
    expect(latched).toBeEnabled();
    expect(latched).toHaveAttribute('data-clipped', 'true');

    // Stays latched when later frames are clean.
    act(() => ref.current!.setLevels([0.2, 0.2], false));
    expect(screen.getByRole('button', { name: /clipped/ })).toBeEnabled();

    fireEvent.click(latched);
    expect(onClipReset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /no clip/ })).toBeDisabled();
  });
});
