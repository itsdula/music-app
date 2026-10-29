import {
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useValueDrag } from '../hooks/useValueDrag';
import { cn } from '../lib/cn';
import { clamp, decimalsOf, snapToStep } from '../lib/math';
import { useMergedRefs } from '../lib/mergeRefs';
import { transition } from '../lib/styles';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  /** Accessible name (aria-label). */
  label: string;
  min?: number;
  max?: number;
  /** Step for arrow keys and dragging. Default 1. */
  step?: number;
  /** Step used while Shift is held (keys and drag). Defaults to `step`; drag also slows 10×. */
  fineStep?: number;
  /** Step for PageUp / PageDown. Default `step * 10`. */
  largeStep?: number;
  /** Display formatter. Default: fixed to the decimals implied by `step`. */
  format?: (value: number) => string;
  /** Parses typed text; return null for invalid input (reverts). Default: `Number()`. */
  parse?: (text: string) => number | null;
  /** Human readable value for screen readers (aria-valuetext). Defaults to `format(value)`. */
  valueText?: (value: number) => string;
  /** Pixels of vertical drag per `step`. Default 4. */
  pixelsPerStep?: number;
  /** Trailing unit, e.g. "BPM". */
  suffix?: ReactNode;
  size?: 'sm' | 'md';
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  inputClassName?: string;
  ref?: Ref<HTMLInputElement>;
  /** Called once when a drag gesture ends (useful for undo grouping). */
  onChangeEnd?: (value: number) => void;
}

const defaultParse = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Compact numeric input: drag vertically (Shift = fine), arrow keys / PageUp / PageDown /
 * Home / End, or click to type (Enter or blur commits, Escape reverts).
 */
export function NumberField({
  value,
  onChange,
  label,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  fineStep,
  largeStep,
  format,
  parse = defaultParse,
  valueText,
  pixelsPerStep = 4,
  suffix,
  size = 'md',
  disabled = false,
  id,
  name,
  className,
  inputClassName,
  ref,
  onChangeEnd,
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs(inputRef, ref);
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const fine = fineStep ?? step;
  const gridMin = Number.isFinite(min) ? min : 0;
  const snap = (raw: number, grid: number): number =>
    clamp(snapToStep(raw, grid, gridMin, Number.POSITIVE_INFINITY), min, max);
  const display = (v: number): string => (format ? format(v) : v.toFixed(decimalsOf(step)));
  const shown = draft ?? display(value);

  const emit = (next: number): void => {
    if (next !== value) onChange(next);
  };

  const commitDraft = (): void => {
    if (draft === null) return;
    const parsed = parse(draft);
    setDraft(null);
    if (parsed !== null) emit(snap(parsed, fine));
  };

  const { dragging, handlers } = useValueDrag({
    value,
    min: Number.isFinite(min) ? min : -Number.MAX_VALUE,
    max: Number.isFinite(max) ? max : Number.MAX_VALUE,
    normalize: (raw, isFine) => snap(raw, isFine ? fine : step),
    unitsPerPixel: () => step / pixelsPerStep,
    dragThreshold: 3,
    disabled: disabled || focused,
    onChange,
    onChangeEnd,
    onTap: () => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const base = draft !== null ? (parse(draft) ?? value) : value;
    let next: number;
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        commitDraft();
        return;
      case 'Escape':
        if (draft !== null) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        }
        return;
      case 'ArrowUp':
        next = base + (event.shiftKey ? fine : step);
        break;
      case 'ArrowDown':
        next = base - (event.shiftKey ? fine : step);
        break;
      case 'PageUp':
        next = base + (largeStep ?? step * 10);
        break;
      case 'PageDown':
        next = base - (largeStep ?? step * 10);
        break;
      case 'Home':
        if (!Number.isFinite(min)) return;
        next = min;
        break;
      case 'End':
        if (!Number.isFinite(max)) return;
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    setDraft(null);
    emit(snap(next, fine));
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>): void => {
    setFocused(true);
    event.currentTarget.select();
  };

  const onBlur = (): void => {
    setFocused(false);
    commitDraft();
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-md border border-line bg-surface-1 text-text focus-within:border-accent',
        size === 'sm' ? 'h-6 text-[11px]' : 'h-7 text-[12px]',
        disabled && 'opacity-40',
        dragging && 'border-accent',
        transition,
        className,
      )}
    >
      <input
        ref={mergedRef}
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        role="spinbutton"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        aria-valuetext={valueText ? valueText(value) : display(value)}
        disabled={disabled}
        value={shown}
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
        {...handlers}
        className={cn(
          'h-full w-full min-w-0 bg-transparent px-1.5 text-center font-medium tabular-nums outline-none',
          !focused && !disabled && 'cursor-ns-resize select-none',
          inputClassName,
        )}
      />
      {suffix ? (
        <span className="pointer-events-none pr-1.5 text-[10px] text-text-faint">{suffix}</span>
      ) : null}
    </div>
  );
}
