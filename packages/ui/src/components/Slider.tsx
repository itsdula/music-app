import type { Ref } from 'react';
import { Slider as RadixSlider } from 'radix-ui';
import { useCoalescedCallback } from '../hooks/useCoalescedCallback';
import { cn } from '../lib/cn';
import { focusRing } from '../lib/styles';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Accessible name of the thumb. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Large keyboard step multiplier is Radix's (10 × step with Shift / PageUp / PageDown). */
  formatValue?: (value: number) => string;
  disabled?: boolean;
  /** Called when a pointer drag ends or after a keyboard step. */
  onChangeEnd?: (value: number) => void;
  className?: string;
  id?: string;
  ref?: Ref<HTMLSpanElement>;
}

/** Horizontal slider (Radix). Pointer changes are coalesced to one per animation frame. */
export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  formatValue,
  disabled = false,
  onChangeEnd,
  className,
  id,
  ref,
}: SliderProps) {
  const emitter = useCoalescedCallback(onChange);
  return (
    <RadixSlider.Root
      ref={ref}
      id={id}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(values) => {
        const next = values[0];
        if (next !== undefined) emitter.schedule(next);
      }}
      onValueCommit={(values) => {
        emitter.flush();
        const next = values[0];
        if (next !== undefined) onChangeEnd?.(next);
      }}
      className={cn(
        'relative flex h-5 w-full touch-none select-none items-center data-disabled:opacity-40',
        className,
      )}
    >
      <RadixSlider.Track className="relative h-1 grow overflow-hidden rounded-full bg-surface-0 ring-1 ring-line">
        <RadixSlider.Range className="absolute h-full bg-accent" />
      </RadixSlider.Track>
      <RadixSlider.Thumb
        aria-label={label}
        aria-valuetext={formatValue ? formatValue(value) : undefined}
        className={cn(
          'block size-3 rounded-full border border-line-strong bg-text shadow-sm shadow-black/50 hover:scale-110 motion-safe:transition-transform',
          focusRing,
        )}
      />
    </RadixSlider.Root>
  );
}
