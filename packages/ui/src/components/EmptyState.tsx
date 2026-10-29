import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface EmptyStateProps extends Omit<ComponentProps<'div'>, 'title'> {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Call-to-action(s), e.g. a `Button`. */
  action?: ReactNode;
}

/** Placeholder for empty panels and lists. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-8 text-center',
        className,
      )}
      {...props}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className="mb-1 flex size-9 items-center justify-center rounded-lg border border-line bg-surface-2 text-text-muted [&_svg]:size-4.5"
        >
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-medium text-text">{title}</p>
      {description ? (
        <p className="max-w-72 text-[12px] leading-relaxed text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
