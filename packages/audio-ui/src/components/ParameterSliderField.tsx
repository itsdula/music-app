import {
  ParameterSlider,
  ParameterSliderControl,
  ParameterSliderDescription,
  ParameterSliderHeader,
  ParameterSliderLabel,
  ParameterSliderValue,
} from '../audiocn/components/ui/parameter-slider';
import { cn } from '../audiocn/lib/utils';

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
  /** Restored by double-clicking the thumb. Default `min`. */
  resetValue?: number;
  format?: (value: number) => string;
  /** Helper text under the slider; also describes the slider to assistive technology. */
  hint?: string;
  disabled?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** A labelled horizontal slider with its value in the header, sized for inspector panels. */
export function ParameterSliderField({
  label,
  value,
  onChange,
  onCommit,
  min,
  max,
  step,
  resetValue,
  format,
  hint,
  disabled = false,
  className,
  'data-testid': testId,
}: ParameterSliderFieldProps) {
  return (
    <ParameterSlider
      value={value}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
      {...(onCommit ? { onValueCommitted: onCommit } : {})}
      {...(resetValue !== undefined ? { resetValue } : {})}
      {...(format ? { format } : {})}
      className={cn('flex min-w-0 flex-col gap-0.5', className)}
      data-testid={testId}
    >
      <ParameterSliderHeader className="min-h-4">
        <ParameterSliderLabel className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </ParameterSliderLabel>
        <ParameterSliderValue className="text-[10px] text-foreground" />
      </ParameterSliderHeader>
      <ParameterSliderControl />
      {hint ? (
        <ParameterSliderDescription className="text-[10px] leading-snug">
          {hint}
        </ParameterSliderDescription>
      ) : null}
    </ParameterSlider>
  );
}
