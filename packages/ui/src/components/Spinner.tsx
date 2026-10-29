import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export interface SpinnerProps extends Omit<ComponentProps<'span'>, 'children'> {
  size?: 'sm' | 'md';
  /** Accessible label; announced via role="status". Default "Loading". */
  label?: string;
}

/** Indeterminate activity indicator. Rotation stops under prefers-reduced-motion. */
export function Spinner({ size = 'md', label = 'Loading', className, ...props }: SpinnerProps) {
  const px = size === 'sm' ? 12 : 16;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex shrink-0 text-text-muted', className)}
      {...props}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="motion-safe:animate-spin"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}
