import { useRef, type KeyboardEvent, type Ref } from 'react';
import { useValueDrag } from '../hooks/useValueDrag';
import { useWheelStep } from '../hooks/useWheelStep';
import { cn } from '../lib/cn';
import { valueForKey } from '../lib/keyboardStep';
import { clamp, snapToStep } from '../lib/math';
import { useMergedRefs } from '../lib/mergeRefs';
import { focusRing } from '../lib/styles';

export interface FaderProps {
  /** Normalized position 0..1 (map to gain with your own taper). */
  value: number;
  onChange: (value: number) => void;
  /** Accessible name (aria-label). */
  label: string;
  /** Formats the normalized value for aria-valuetext and the readout, e.g. "-6.0 dB". */
  formatValue?: (value: number) => string;
  /** Position restored by double-click and Delete / Backspace (e.g. unity gain). Default 0.75. */
  defaultValue?: number;
  /** Draws a tick at this position (e.g. 0 dB). */
  unityValue?: number;
  /** Arrow-key step. Default 0.01. Shift uses `fineStep` (default 0.001). */
  step?: number;
  fineStep?: number;
  /** PageUp / PageDown step. Default 0.1. */
  largeStep?: number;
  /** Show the formatted value under the fader. */
  showValue?: boolean;
  disabled?: boolean;
  /** Set the height with a utility, e.g. `h-40`. Default `h-32`. */
  className?: string;
  id?: string;
  ref?: Ref<HTMLDivElement>;
  onChangeEnd?: (value: number) => void;
}

const FALLBACK_TRACK_PX = 120;

/**
 * Vertical fader working in normalized 0..1. Relative drag (Shift = fine), wheel, keyboard
 * (arrows, PageUp/PageDown, Home/End) and double-click / Delete to reset.
 */
export function Fader({
  value,
  onChange,
  label,
  formatValue,
  defaultValue = 0.75,
  unityValue,
  step = 0.01,
  fineStep = 0.001,
  largeStep = 0.1,
  showValue = false,
  disabled = false,
  className,
  id,
  ref,
  onChangeEnd,
}: FaderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const current = clamp(value, 0, 1);

  const { dragging, handlers } = useValueDrag({
    value: current,
    min: 0,
    max: 1,
    normalize: (raw) => snapToStep(raw, fineStep, 0, 1),
    unitsPerPixel: () => {
      const height = trackRef.current?.getBoundingClientRect().height ?? 0;
      return 1 / (height > 0 ? height : FALLBACK_TRACK_PX);
    },
    disabled,
    onChange,
    onChangeEnd,
  });

  const wheelRef = useWheelStep({
    value: current,
    enabled: !disabled,
    onChange,
    step: (base, direction, fine) => {
      const unit = fine ? fineStep : step;
      return snapToStep(base + direction * unit, unit, 0, 1);
    },
  });
  const mergedRef = useMergedRefs<HTMLDivElement>(wheelRef, ref);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    const next = valueForKey(event, {
      value: current,
      min: 0,
      max: 1,
      step,
      fineStep,
      largeStep,
      defaultValue,
    });
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  const text = formatValue ? formatValue(current) : `${Math.round(current * 100)}%`;
  const percent = `${(current * 100).toFixed(3)}%`;

  return (
    <div
      className={cn(
        'inline-flex h-32 w-7 shrink-0 flex-col items-center gap-1',
        disabled && 'opacity-40',
        className,
      )}
    >
      <div
        ref={mergedRef}
        id={id}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={current}
        aria-valuetext={text}
        aria-disabled={disabled || undefined}
        data-dragging={dragging || undefined}
        onKeyDown={onKeyDown}
        onDoubleClick={() => {
          if (!disabled && defaultValue !== value) onChange(defaultValue);
        }}
        {...handlers}
        className={cn(
          'group relative w-full min-h-0 flex-1 touch-none select-none rounded-sm',
          !disabled && 'cursor-ns-resize',
          focusRing,
        )}
      >
        {/* Inset by half the cap height so the cap centre travels exactly over the track. */}
        <div ref={trackRef} className="absolute inset-x-0 top-1.5 bottom-1.5">
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-surface-0 ring-1 ring-line" />
          <div
            className={cn(
              'absolute bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-full',
              disabled ? 'bg-text-faint' : 'bg-accent',
            )}
            style={{ height: percent }}
          />
          {unityValue !== undefined ? (
            <div
              aria-hidden="true"
              className="absolute right-0 left-0 h-px bg-line-strong"
              style={{ bottom: `${(clamp(unityValue, 0, 1) * 100).toFixed(3)}%` }}
            />
          ) : null}
          <div
            className={cn(
              'absolute left-1/2 h-3 w-6 -translate-x-1/2 translate-y-1/2 rounded-sm border shadow-sm shadow-black/50',
              dragging
                ? 'border-accent bg-surface-3'
                : 'border-line-strong bg-surface-2 group-hover:bg-surface-3',
            )}
            style={{ bottom: percent }}
          >
            <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-text-muted" />
          </div>
        </div>
      </div>
      {showValue ? (
        <span aria-hidden="true" className="text-[10px] leading-none text-text-muted tabular-nums">
          {text}
        </span>
      ) : null}
    </div>
  );
}
