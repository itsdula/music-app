import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';
import { buttonBase, type ButtonSize, type ButtonVariant } from './Button';
import { Tooltip, type TooltipProps } from './Tooltip';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label' | 'children'> {
  /** Required accessible name; also used as tooltip text. */
  label: string;
  /** The icon, e.g. `<Play />`. */
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Keyboard shortcut shown in the tooltip. */
  shortcut?: string;
  /** Show the label as a tooltip. Default true. */
  tooltip?: boolean;
  tooltipSide?: TooltipProps['side'];
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-surface-0 hover:bg-accent-strong',
  secondary: 'border border-line bg-surface-2 text-text hover:bg-surface-3',
  ghost: 'text-text-muted hover:bg-surface-3 hover:text-text active:bg-surface-2',
  danger: 'text-record hover:bg-record/15',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'size-6 [&_svg]:size-3.5',
  md: 'size-7 [&_svg]:size-4',
};

/** Square icon-only button with a mandatory accessible label. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  shortcut,
  tooltip = true,
  tooltipSide,
  type = 'button',
  className,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
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
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
