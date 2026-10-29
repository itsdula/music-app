import type { KeyboardEvent, Ref } from 'react';
import { useValueDrag } from '../hooks/useValueDrag';
import { useWheelStep } from '../hooks/useWheelStep';
import { cn } from '../lib/cn';
import { valueForKey } from '../lib/keyboardStep';
import { clamp, snapToStep } from '../lib/math';
import { useMergedRefs } from '../lib/mergeRefs';
import { focusRing } from '../lib/styles';

export interface KnobProps {
  value: number;
  onChange: (value: number) => void;
  /** Accessible name (aria-label). */
  label: string;
  min?: number;
  max?: number;
  /** Keyboard / wheel / drag snapping step. Default (max - min) / 100. */
  step?: number;
  /** Step while Shift is held. Default step / 10. */
  fineStep?: number;
  /** Step for PageUp / PageDown. Default step * 10. */
  largeStep?: number;
  /** Value restored by double-click and Delete / Backspace. Default: min (or centre when bipolar). */
  defaultValue?: number;
  /** Draw the arc from the centre (e.g. pan). */
  bipolar?: boolean;
  /** Formats the value for aria-valuetext and the optional tooltip-like title. */
  formatValue?: (value: number) => string;
  size?: 'sm' | 'md';
  /** Pixels of vertical drag for the full range. Default 200. */
  dragRange?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  ref?: Ref<HTMLDivElement>;
  onChangeEnd?: (value: number) => void;
}

const SWEEP = 270;
const START = -135;

function polar(cx: number, cy: number, r: number, degrees: number): [number, number] {
  const rad = ((degrees - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  if (Math.abs(to - from) < 0.01) return '';
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  const [x1, y1] = polar(cx, cy, r, a);
  const [x2, y2] = polar(cx, cy, r, b);
  const large = b - a > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Rotary control (`role="slider"`): vertical drag (Shift = fine), wheel, keyboard, and
 * double-click / Delete to reset. Bipolar mode draws the arc from the centre.
 */
export function Knob({
  value,
  onChange,
  label,
  min = 0,
  max = 1,
  step,
  fineStep,
  largeStep,
  defaultValue,
  bipolar = false,
  formatValue,
  size = 'md',
  dragRange = 200,
  disabled = false,
  className,
  id,
  ref,
  onChangeEnd,
}: KnobProps) {
  const range = max - min || 1;
  const unit = step ?? range / 100;
  const fine = fineStep ?? unit / 10;
  const resetValue = defaultValue ?? (bipolar ? min + range / 2 : min);
  const current = clamp(value, min, max);

  const { dragging, handlers } = useValueDrag({
    value: current,
    min,
    max,
    normalize: (raw, isFine) => snapToStep(raw, isFine ? fine : unit, min, max),
    unitsPerPixel: () => range / dragRange,
    disabled,
    onChange,
    onChangeEnd,
  });

  const wheelRef = useWheelStep({
    value: current,
    enabled: !disabled,
    onChange,
    step: (base, direction, isFine) => {
      const delta = isFine ? fine : unit;
      return snapToStep(base + direction * delta, delta, min, max);
    },
  });
  const mergedRef = useMergedRefs<HTMLDivElement>(wheelRef, ref);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const next = valueForKey(event, {
      value: current,
      min,
      max,
      step: unit,
      fineStep: fine,
      largeStep: largeStep ?? unit * 10,
      defaultValue: resetValue,
    });
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  const px = size === 'sm' ? 24 : 32;
  const stroke = size === 'sm' ? 2.5 : 3;
  const c = px / 2;
  const r = c - stroke / 2 - 0.5;
  const ratio = (current - min) / range;
  const angle = START + ratio * SWEEP;
  const origin = bipolar ? 0 : START;
  const [pointerX, pointerY] = polar(c, c, r - stroke - 1, angle);
  const [innerX, innerY] = polar(c, c, size === 'sm' ? 2 : 3, angle);
  const text = formatValue ? formatValue(current) : String(current);

  return (
    <div
      ref={mergedRef}
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={text}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        if (!disabled && resetValue !== value) onChange(resetValue);
      }}
      {...handlers}
      className={cn(
        'group relative inline-flex shrink-0 touch-none select-none items-center justify-center rounded-full',
        size === 'sm' ? 'size-6' : 'size-8',
        disabled ? 'opacity-40' : 'cursor-ns-resize',
        focusRing,
        className,
      )}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} aria-hidden="true">
        <circle
          cx={c}
          cy={c}
          r={r - stroke - 0.5}
          className="fill-surface-2 stroke-line group-hover:fill-surface-3"
          strokeWidth={1}
        />
        <path
          d={arcPath(c, c, r, START, START + SWEEP)}
          fill="none"
          className="stroke-line"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={arcPath(c, c, r, origin, angle)}
          fill="none"
          className={cn(
            disabled ? 'stroke-text-faint' : 'stroke-accent',
            dragging && 'stroke-accent-strong',
          )}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <line
          x1={innerX}
          y1={innerY}
          x2={pointerX}
          y2={pointerY}
          className="stroke-text"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
