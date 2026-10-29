import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon, e.g. `<Plus />` from lucide-react. Sized automatically. */
  icon?: ReactNode;
  /** Trailing icon (e.g. a chevron). */
  iconEnd?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-surface-0 hover:bg-accent-strong active:bg-accent border border-transparent',
  secondary: 'border border-line bg-surface-2 text-text hover:bg-surface-3 active:bg-surface-2',
  ghost:
    'border border-transparent bg-transparent text-text-muted hover:bg-surface-3 hover:text-text active:bg-surface-2',
  danger: 'border border-record/40 bg-record/15 text-record hover:bg-record/25 active:bg-record/20',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-[11px] [&_svg]:size-3.5',
  md: 'h-7 gap-1.5 px-2.5 text-[12px] [&_svg]:size-4',
};

export const buttonBase =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium leading-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  type = 'button',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        buttonBase,
        transition,
        focusRing,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
      {iconEnd}
    </button>
  );
}
