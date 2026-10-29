import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedOption } from '../src';

type Mode = 'select' | 'draw' | 'cut' | 'erase';

const options: SegmentedOption<Mode>[] = [
  { value: 'select', label: 'Select' },
  { value: 'draw', label: 'Draw' },
  { value: 'cut', label: 'Cut', disabled: true },
  { value: 'erase', label: 'Erase' },
];

function Harness({ onSpy }: { onSpy: (v: Mode) => void }) {
  const [value, setValue] = useState<Mode>('select');
  return (
    <SegmentedControl
      label="Tool"
      value={value}
      options={options}
      onChange={(next) => {
        onSpy(next);
        setValue(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('uses radio-group semantics with a single tab stop', () => {
    render(<Harness onSpy={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Tool' })).toBeInTheDocument();
    const select = screen.getByRole('radio', { name: 'Select' });
    const draw = screen.getByRole('radio', { name: 'Draw' });
    expect(select).toHaveAttribute('aria-checked', 'true');
    expect(draw).toHaveAttribute('aria-checked', 'false');
    expect(select).toHaveAttribute('tabindex', '0');
    expect(draw).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection and focus with arrows, skipping disabled options and wrapping', () => {
    const spy = vi.fn<(v: Mode) => void>();
    render(<Harness onSpy={spy} />);
    const select = screen.getByRole('radio', { name: 'Select' });
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowRight' });
    expect(spy).toHaveBeenLastCalledWith('draw');
    const draw = screen.getByRole('radio', { name: 'Draw' });
    expect(draw).toHaveFocus();
    expect(draw).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(draw, { key: 'ArrowRight' });
    expect(spy).toHaveBeenLastCalledWith('erase');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Erase' }), { key: 'ArrowRight' });
    expect(spy).toHaveBeenLastCalledWith('select');
    fireEvent.keyDown(select, { key: 'ArrowLeft' });
    expect(spy).toHaveBeenLastCalledWith('erase');
    fireEvent.keyDown(select, { key: 'Home' });
    expect(spy).toHaveBeenLastCalledWith('select');
    fireEvent.keyDown(select, { key: 'End' });
    expect(spy).toHaveBeenLastCalledWith('erase');
  });

  it('selects on click', () => {
    const spy = vi.fn<(v: Mode) => void>();
    render(<Harness onSpy={spy} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Draw' }));
    expect(spy).toHaveBeenCalledWith('draw');
    expect(screen.getByRole('radio', { name: 'Cut' })).toBeDisabled();
  });
});
