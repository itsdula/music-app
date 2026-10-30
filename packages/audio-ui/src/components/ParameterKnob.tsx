import {
  Knob,
  KnobDial,
  KnobLabel,
  KnobPointer,
  KnobRange,
  KnobTrack,
  KnobValue,
} from '../audiocn/components/ui/knob';
import { formatPan, parsePan } from '../audiocn/components/ui/pan-control';
import { cn } from '../audiocn/lib/utils';

export interface ParameterKnobProps {
  /** Visible caption and accessible name. */
  label: string;
  /** Hide the caption (the label still names the dial for assistive technology). */
  hideLabel?: boolean;
  value: number;
  onChange: (value: number) => void;
  /** End of a gesture (drag released, key pressed, value typed, reset). */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Shift+drag and Alt+arrow resolution. Default step / 10. */
  fineStep?: number;
  /** Restored by double-click or Alt+click. Default `min`. */
  resetValue?: number;
  /** Where the arc starts: set to the centre for bipolar parameters such as pan. */
  origin?: number;
  format?: (value: number) => string;
  /** Reads a typed value; return null to reject it. */
  parse?: (text: string) => number | null;
  /** Shows the value under the dial; double-click it (or Enter on the dial) to type. Default true. */
  showValue?: boolean;
  size?: 'sm' | 'default';
  disabled?: boolean;
  className?: string;
}

/** A rotary parameter control: vertical drag, keyboard steps and typed values. */
export function ParameterKnob({
  label,
  hideLabel = false,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = (max - min) / 100,
  fineStep,
  resetValue,
  origin,
  format,
  parse,
  showValue = true,
  size = 'default',
  disabled = false,
  className,
}: ParameterKnobProps) {
  return (
    <Knob
      value={value}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      size={size}
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
      {...(onCommit ? { onValueCommitted: onCommit } : {})}
      {...(fineStep !== undefined ? { fineStep } : {})}
      {...(resetValue !== undefined ? { resetValue } : {})}
      {...(origin !== undefined ? { origin } : {})}
      {...(format ? { format } : {})}
      {...(parse ? { parse } : {})}
      className={cn('gap-1', className)}
    >
      <KnobDial {...(hideLabel ? { 'aria-label': label, 'aria-labelledby': undefined } : {})}>
        <KnobTrack />
        <KnobRange />
        <KnobPointer />
      </KnobDial>
      {showValue && <KnobValue className="text-[10px]" />}
      {!hideLabel && (
        <KnobLabel className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </KnobLabel>
      )}
    </Knob>
  );
}

export type PanKnobProps = Omit<
  ParameterKnobProps,
  'min' | 'max' | 'origin' | 'resetValue' | 'format' | 'parse'
>;

/** Pan from −1 (left) to 1 (right), centred, reading and typing values like "L30" or "C". */
export function PanKnob({ step = 0.01, ...props }: PanKnobProps) {
  return (
    <ParameterKnob
      min={-1}
      max={1}
      origin={0}
      resetValue={0}
      step={step}
      format={formatPan}
      parse={parsePan}
      {...props}
    />
  );
}
