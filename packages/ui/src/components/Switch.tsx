import { useId, type Ref } from 'react';
import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '../lib/cn';
import { focusRing, transition } from '../lib/styles';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label text; also the accessible name. */
  label?: string;
  /** Accessible name when no visible label is rendered. */
  'aria-label'?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/** On/off switch (Radix, role="switch"). */
export function Switch({
  checked,
  onCheckedChange,
  label,
  'aria-label': ariaLabel,
  disabled = false,
  id,
  className,
  ref,
}: SwitchProps) {
  const generatedId = useId();
  const switchId = id ?? generatedId;
  const control = (
    <RadixSwitch.Root
      ref={ref}
      id={switchId}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border border-line bg-surface-3 data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-40',
        transition,
        focusRing,
        !label && className,
      )}
    >
      <RadixSwitch.Thumb className="block size-3 translate-x-px rounded-full bg-text shadow-sm shadow-black/40 motion-safe:transition-transform motion-safe:duration-100 data-[state=checked]:translate-x-[13px]" />
    </RadixSwitch.Root>
  );
  if (!label) return control;
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {control}
      <label htmlFor={switchId} className="select-none text-[12px] text-text-muted">
        {label}
      </label>
    </span>
  );
}
