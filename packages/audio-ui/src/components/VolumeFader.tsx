import { Fader } from '@audio-ui/react/fader';
import { cn } from '../lib/cn';
import { clamp, formatDb } from '../lib/decibels';
import { resolveTaper, type TaperInput } from '../lib/taper';
import { EditableReadout } from './EditableReadout';

export interface VolumeFaderProps {
  /** Accessible name of the fader thumb. */
  label: string;
  /** Gain in dB. */
  value: number;
  /** Live changes while dragging, typing or pressing keys. */
  onChange: (db: number) => void;
  /** End of a gesture (drag released, key pressed, value typed, reset). */
  onCommit?: (db: number) => void;
  min?: number;
  max?: number;
  /** Position law; pass the same curve the engine uses so the travel matches automation. */
  taper?: TaperInput;
  format?: (db: number) => string;
  orientation?: 'horizontal' | 'vertical';
  /** Shows the value under the fader; double-click it to type a value. Default true. */
  showValue?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Keyboard and wheel step, as a share of the travel. */
const STEP = 0.01;
/** Drags within this share of the travel around 0 dB snap to it; below STEP so keys pass through. */
const UNITY_DETENT = 0.006;

const parseDb = (text: string): number | null => {
  const t = text
    .trim()
    .replaceAll('−', '-')
    .replace(/\s*db$/iu, '');
  if (/^-?(inf|∞)$/iu.test(t)) return Number.NEGATIVE_INFINITY;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
};

/**
 * A dB volume fader (`@audio-ui/react` Fader). The primitive moves linearly, so it runs in
 * taper position space (0…1) and this converts to dB: the travel follows the engine's law, with
 * a unity detent, double-click (or Delete) reset to 0 dB and a readout you can type into.
 */
export function VolumeFader({
  label,
  value,
  onChange,
  onCommit,
  min = -60,
  max = 6,
  taper = 'audio',
  format = (db) => formatDb(db),
  orientation = 'vertical',
  showValue = true,
  disabled = false,
  className,
}: VolumeFaderProps) {
  const law = resolveTaper(taper, min, max);
  const unity = min < 0 && max > 0 ? law.toPosition(0) : null;
  const toDb = (position: number) => {
    if (unity !== null && Math.abs(position - unity) < UNITY_DETENT) return 0;
    return clamp(Math.round(law.toValue(position) * 10) / 10, min, max);
  };
  const submit = (text: string) => {
    const parsed = parseDb(text);
    if (parsed === null) return false;
    const db = clamp(parsed, min, max);
    onChange(db);
    onCommit?.(db);
    return true;
  };
  const vertical = orientation === 'vertical';

  return (
    <Fader.Root
      value={law.toPosition(value)}
      min={0}
      max={1}
      step={STEP / 10}
      largeStep={STEP}
      defaultValue={unity ?? 0}
      orientation={orientation}
      disabled={disabled}
      onValueChange={(position) => onChange(toDb(position))}
      {...(onCommit ? { onValueCommitted: (position: number) => onCommit(toDb(position)) } : {})}
      className={cn(
        'flex items-center gap-1 data-disabled:opacity-50',
        vertical ? 'min-h-20 flex-col' : 'min-w-20',
        className,
      )}
      data-slot="volume-fader"
    >
      <Fader.Control
        className={cn(
          'flex cursor-grab',
          vertical ? 'min-h-0 w-6 flex-1 justify-center' : 'h-6 min-w-0 flex-1 items-center',
        )}
      >
        <Fader.Track
          className={cn('rounded-full bg-surface-3', vertical ? 'h-full w-1' : 'h-1 w-full')}
        >
          <Fader.Indicator className="absolute rounded-full bg-accent" />
        </Fader.Track>
        <Fader.Thumb
          aria-label={label}
          getAriaValueText={(_, position) => format(toDb(position))}
          className={cn(
            'rounded-sm border border-line-strong bg-surface-2 shadow-md',
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
            "after:absolute after:bg-text after:content-['']",
            vertical
              ? 'h-3 w-6 after:inset-x-1 after:top-1/2 after:h-px'
              : 'h-6 w-3 after:inset-y-1 after:left-1/2 after:w-px',
          )}
        />
      </Fader.Control>
      {showValue && <EditableReadout text={format(value)} label={label} onSubmit={submit} />}
    </Fader.Root>
  );
}
