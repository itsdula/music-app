import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Accessible name when `label` is not text (e.g. icon-only). */
  ariaLabel?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** Accessible name of the group. */
  label: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

/**
 * Single-choice segmented control with radio-group semantics: one tab stop, arrow keys
 * (and Home/End) move the selection.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  disabled = false,
  className,
}: SegmentedControlProps<T>) {
  const itemsRef = useRef(new Map<T, HTMLButtonElement>());
  const enabled = options.filter((option) => !option.disabled && !disabled);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop =
    selectedIndex >= 0 && !options[selectedIndex]?.disabled ? value : enabled[0]?.value;

  const select = (next: T): void => {
    if (next !== value) onChange(next);
    itemsRef.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (enabled.length === 0) return;
    const current = enabled.findIndex((option) => option.value === value);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = current < 0 ? 0 : (current + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = current < 0 ? 0 : (current - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = enabled[nextIndex];
    if (next) select(next.value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-stretch gap-px rounded-md border border-line bg-surface-1 p-px',
        size === 'sm' ? 'h-6' : 'h-7',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === value;
        const isDisabled = disabled || option.disabled === true;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) itemsRef.current.set(option.value, node);
              else itemsRef.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            data-state={checked ? 'on' : 'off'}
            disabled={isDisabled}
            tabIndex={option.value === tabStop ? 0 : -1}
            onClick={() => select(option.value)}
            className={cn(
              'inline-flex select-none items-center justify-center gap-1 rounded-[5px] font-medium leading-none whitespace-nowrap disabled:opacity-40',
              size === 'sm'
                ? 'px-2 text-[11px] [&_svg]:size-3.5'
                : 'px-2.5 text-[12px] [&_svg]:size-4',
              checked
                ? 'bg-surface-3 text-text shadow-sm shadow-black/30'
                : 'text-text-muted hover:text-text',
              transition,
              focusRing,
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
