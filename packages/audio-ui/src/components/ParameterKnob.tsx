import { Knob } from '@audio-ui/react/knob';
import { cn } from '../lib/cn';
import { clamp } from '../lib/decibels';
import { EditableReadout } from './EditableReadout';

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
  /** Restored by double-click, Alt+click or Delete. Default `min`. */
  resetValue?: number;
  /** Where the arc starts: set to the centre for bipolar parameters such as pan. */
  origin?: number;
  format?: (value: number) => string;
  /** Reads a typed value; return null to reject it. */
  parse?: (text: string) => number | null;
  /** Shows the value under the dial; double-click it to type. Default true. */
  showValue?: boolean;
  size?: 'sm' | 'default';
  disabled?: boolean;
  className?: string;
}

const defaultFormat = (value: number) => String(Math.round(value * 100) / 100);
const defaultParse = (text: string) => {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) ? n : null;
};

/** A rotary parameter control (`@audio-ui/react` Knob): vertical drag, wheel, keyboard and typed values. */
export function ParameterKnob({
  label,
  hideLabel = false,
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = (max - min) / 100,
  resetValue,
  origin,
  format = defaultFormat,
  parse = defaultParse,
  showValue = true,
  size = 'default',
  disabled = false,
  className,
}: ParameterKnobProps) {
  const submit = (text: string) => {
    const parsed = parse(text);
    if (parsed === null || !Number.isFinite(parsed)) return false;
    const next = clamp(parsed, min, max);
    onChange(next);
    onCommit?.(next);
    return true;
  };

  return (
    <Knob.Root
      value={value}
      min={min}
      max={max}
      step={step}
      largeStep={step * 10}
      defaultValue={resetValue ?? min}
      dragMode="vertical"
      disabled={disabled}
      onValueChange={(next) => onChange(next)}
      {...(onCommit ? { onValueCommitted: (next: number) => onCommit(next) } : {})}
      {...(origin !== undefined ? { anchor: origin } : {})}
      className={cn('flex flex-col items-center gap-1 data-disabled:opacity-50', className)}
      data-slot="parameter-knob"
    >
      <Knob.Control
        className={cn('cursor-ns-resize rounded-full', size === 'sm' ? 'size-7' : 'size-10')}
      >
        <Knob.Track strokeWidth={4} className="absolute inset-0 size-full text-surface-3" />
        <Knob.Indicator strokeWidth={4} className="absolute inset-0 size-full text-accent" />
        <Knob.Thumb
          aria-label={label}
          getAriaValueText={(_, v) => format(v)}
          className={cn(
            'absolute inset-[18%] rounded-full bg-surface-2 shadow-sm ring-1 ring-line-strong',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
            "after:absolute after:top-[10%] after:left-1/2 after:h-[32%] after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-text after:content-['']",
          )}
        />
      </Knob.Control>
      {showValue && <EditableReadout text={format(value)} label={label} onSubmit={submit} />}
      {!hideLabel && (
        <Knob.Label className="text-[10px] font-medium tracking-wide text-text-muted uppercase">
          {label}
        </Knob.Label>
      )}
    </Knob.Root>
  );
}

export type PanKnobProps = Omit<
  ParameterKnobProps,
  'min' | 'max' | 'origin' | 'resetValue' | 'format' | 'parse'
>;

/** Pan as "L30" / "C" / "R30". */
export function formatPan(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount === 0) return 'C';
  return `${pan < 0 ? 'L' : 'R'}${amount}`;
}

/** Reads "L30", "R15", "C" or a number from −100 to 100; the inverse of `formatPan`. */
export function parsePan(text: string): number | null {
  const trimmed = text.trim().replaceAll('−', '-');
  if (/^c(?:enter|entre)?$/iu.test(trimmed)) return 0;
  const side = /^[LR]/iu.test(trimmed) ? trimmed[0]?.toUpperCase() : null;
  const digits = (side ? trimmed.slice(1) : trimmed).trim();
  const amount = Number(digits) / 100;
  if (digits === '' || Number.isNaN(amount)) return null;
  return side === 'L' ? -Math.abs(amount) : amount;
}

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
