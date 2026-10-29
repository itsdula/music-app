import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export type KbdProps = ComponentProps<'kbd'>;

/** Keyboard shortcut hint, e.g. `<Kbd>⌘K</Kbd>`. */
export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm border border-line bg-surface-1 px-1 font-sans text-[10px] font-medium leading-none text-text-muted tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
