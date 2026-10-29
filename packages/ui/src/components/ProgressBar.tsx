import { useEffect, useRef } from 'react';
import { cn } from '../lib/cn';
import { clamp } from '../lib/math';

export interface ProgressBarProps {
  /** Progress in [0, max]; `null` / omitted renders an indeterminate bar. */
  value?: number | null;
  max?: number;
  /** Accessible name. */
  label: string;
  /** Human readable progress (aria-valuetext), e.g. "3 of 8 files". */
  valueText?: string;
  tone?: 'accent' | 'success' | 'warning' | 'record';
  size?: 'sm' | 'md';
  className?: string;
}

const toneClasses = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  record: 'bg-record',
} as const;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Determinate or indeterminate progress (role="progressbar"). */
export function ProgressBar({
  value,
  max = 1,
  label,
  valueText,
  tone = 'accent',
  size = 'md',
  className,
}: ProgressBarProps) {
  const indeterminate = value == null || !Number.isFinite(value);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!indeterminate || !bar || typeof bar.animate !== 'function' || prefersReducedMotion()) {
      return;
    }
    const animation = bar.animate(
      [{ transform: 'translateX(-100%)' }, { transform: 'translateX(300%)' }],
      { duration: 1400, iterations: Number.POSITIVE_INFINITY, easing: 'ease-in-out' },
    );
    return () => animation.cancel();
  }, [indeterminate]);

  const ratio = indeterminate || max <= 0 ? 0 : clamp(value / max, 0, 1);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : clamp(value, 0, max)}
      aria-valuetext={valueText}
      aria-busy={indeterminate || undefined}
      data-state={indeterminate ? 'indeterminate' : ratio >= 1 ? 'complete' : 'loading'}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-surface-3',
        size === 'sm' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      {indeterminate ? (
        <div
          ref={barRef}
          className={cn('absolute inset-y-0 left-0 w-1/3 rounded-full', toneClasses[tone])}
        />
      ) : (
        <div
          className={cn(
            'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-150',
            toneClasses[tone],
          )}
          style={{ width: `${(ratio * 100).toFixed(2)}%` }}
        />
      )}
    </div>
  );
}
