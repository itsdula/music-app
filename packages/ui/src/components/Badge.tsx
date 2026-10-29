import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'record' | 'success' | 'warning';

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-2 text-text-muted',
  accent: 'border-accent/30 bg-accent/15 text-accent-strong',
  record: 'border-record/30 bg-record/15 text-record',
  success: 'border-success/30 bg-success/15 text-success',
  warning: 'border-warning/30 bg-warning/15 text-warning',
};

/** Small status label. */
export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 text-[10px] font-medium uppercase tracking-wide tabular-nums',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
