import { Fader } from '@audio-ui/react/fader';
import { useId } from 'react';
import { cn } from '../lib/cn';

export interface ParameterSliderFieldProps {
  /** Visible caption; also names the slider. */
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** End of a gesture (drag released, key pressed, reset). */
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Restored by double-clicking the slider or pressing Delete. Default `min`. */
  resetValue?: number;
  format?: (value: number) => string;
  /** Helper text under the slider; also describes the slider to assistive technology. */
  hint?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** A labelled horizontal slider (`@audio-ui/react` Fader) with its value in the header, for inspectors. */
export function ParameterSliderField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  resetValue,
  format = String,
  hint,
  disabled = false,
  className,
  'data-testid': testId,
}: ParameterSliderFieldProps) {
  const hintId = useId();
  return (
    <Fader.Root
      value={value}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      defaultValue={resetValue ?? min}
      orientation="horizontal"
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
      {...(onCommit ? { onValueCommitted: (next: number) => onCommit(next) } : {})}
      className={cn('flex min-w-0 flex-col gap-0.5 data-disabled:opacity-50', className)}
      data-testid={testId}
      data-slot="parameter-slider"
    >
      <div className="flex min-h-4 items-center justify-between gap-2">
        <Fader.Label className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
          {label}
        </Fader.Label>
        <Fader.Value className="text-[10px] text-text tabular-nums">
          {(_, values) => format(values[0] ?? value)}
        </Fader.Value>
      </div>
      <Fader.Control className="flex h-4 cursor-grab items-center">
        <Fader.Track className="h-1 w-full rounded-full bg-surface-3">
          <Fader.Indicator className="absolute rounded-full bg-accent" />
        </Fader.Track>
        <Fader.Thumb
          getAriaValueText={(_, v) => format(v)}
          {...(hint ? { 'aria-describedby': hintId } : {})}
          className="size-3 rounded-full border border-line-strong bg-text shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent"
        />
      </Fader.Control>
      {hint ? (
        <p id={hintId} className="text-[10px] leading-snug text-text-muted">
          {hint}
        </p>
      ) : null}
    </Fader.Root>
  );
}
