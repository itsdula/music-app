import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';
import { buttonBase, type ButtonSize } from './Button';
import { Tooltip, type TooltipProps } from './Tooltip';

export type ToggleTone = 'neutral' | 'accent' | 'record' | 'warning';

export interface ToggleButtonProps extends Omit<
  ComponentProps<'button'>,
  'aria-pressed' | 'onChange' | 'value'
> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** Colour when pressed: accent (loop/metronome), record (arm), warning (solo), neutral (mute). */
  tone?: ToggleTone;
  size?: ButtonSize;
  icon?: ReactNode;
  /**
   * Accessible name and tooltip. Required when the visible content is an icon or an
   * abbreviation ("S", "M"), optional when `children` is a full word.
   */
  label?: string;
  shortcut?: string;
  tooltipSide?: TooltipProps['side'];
}

const pressedTone: Record<ToggleTone, string> = {
  neutral: 'aria-pressed:border-line-strong aria-pressed:bg-surface-3 aria-pressed:text-text',
  accent: 'aria-pressed:border-accent/40 aria-pressed:bg-accent/20 aria-pressed:text-accent-strong',
  record: 'aria-pressed:border-record/50 aria-pressed:bg-record/20 aria-pressed:text-record',
  warning: 'aria-pressed:border-warning/50 aria-pressed:bg-warning/20 aria-pressed:text-warning',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-6 min-w-6 gap-1 px-1.5 text-[11px] [&_svg]:size-3.5',
  md: 'h-7 min-w-7 gap-1.5 px-2 text-[12px] [&_svg]:size-4',
};

/** Two-state button (aria-pressed) for solo / mute / arm / loop / metronome. */
export function ToggleButton({
  pressed,
  onPressedChange,
  tone = 'accent',
  size = 'md',
  icon,
  label,
  shortcut,
  tooltipSide,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: ToggleButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    onClick?.(event);
    if (!event.defaultPrevented) onPressedChange(!pressed);
  };
  const button = (
    <button
      type={type}
      aria-pressed={pressed}
      aria-label={label}
      data-state={pressed ? 'on' : 'off'}
      onClick={handleClick}
      className={cn(
        buttonBase,
        transition,
        focusRing,
        'border border-line bg-surface-2 text-text-muted not-aria-pressed:hover:bg-surface-3 not-aria-pressed:hover:text-text aria-pressed:hover:brightness-110',
        pressedTone[tone],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
  if (!label) return button;
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      {button}
    </Tooltip>
  );
}
