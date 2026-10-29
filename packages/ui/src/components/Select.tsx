import type { ReactNode, Ref } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { cn } from '../lib/cn';
import { useStudioPortalContainer } from '../lib/portal';
import { floatingEnter, floatingSurface, focusRing, transition } from '../lib/styles';

export interface SelectOption<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Plain text for type-ahead when `label` is not a string. */
  textValue?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  /** Accessible name of the trigger. */
  label: string;
  placeholder?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  id?: string;
  className?: string;
  contentClassName?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** Compact select (Radix) that portals into the Studio portal container. */
export function Select<T extends string = string>({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  size = 'md',
  disabled = false,
  open,
  onOpenChange,
  id,
  className,
  contentClassName,
  ref,
}: SelectProps<T>) {
  const container = useStudioPortalContainer();
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={(next) => {
        const match = options.find((option) => option.value === next);
        if (match) onValueChange(match.value);
      }}
      disabled={disabled}
      open={open}
      onOpenChange={onOpenChange}
    >
      <RadixSelect.Trigger
        ref={ref}
        id={id}
        aria-label={label}
        className={cn(
          'inline-flex min-w-0 items-center justify-between gap-1.5 rounded-md border border-line bg-surface-1 text-text hover:bg-surface-2 disabled:opacity-40 data-placeholder:text-text-faint',
          size === 'sm' ? 'h-6 px-1.5 text-[11px]' : 'h-7 px-2 text-[12px]',
          transition,
          focusRing,
          className,
        )}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="shrink-0 text-text-muted">
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal container={container}>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className={cn(
            floatingSurface,
            floatingEnter,
            'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
            contentClassName,
          )}
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                textValue={option.textValue}
                className="relative flex h-7 cursor-default select-none items-center rounded-sm pr-2 pl-6 text-[12px] text-text outline-none data-disabled:text-text-faint data-highlighted:bg-surface-3"
              >
                <RadixSelect.ItemIndicator className="absolute left-1.5 inline-flex text-accent">
                  <Check className="size-3.5" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
