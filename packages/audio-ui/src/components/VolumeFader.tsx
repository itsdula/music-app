import {
  Fader,
  FaderRange,
  FaderThumb,
  FaderTrack,
  FaderValue,
} from '../audiocn/components/ui/fader';
import type { TaperInput } from '../audiocn/lib/audio/taper';
import type { Orientation } from '../audiocn/lib/audio/types';
import { cn } from '../audiocn/lib/utils';

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
  orientation?: Orientation;
  /** Shows the value under the fader; click it to type a value. Default true. */
  showValue?: boolean;
  disabled?: boolean;
  className?: string;
}

/** A dB volume fader: unity detent, double-click reset to 0 dB and an editable readout. */
export function VolumeFader({
  label,
  value,
  onChange,
  onCommit,
  min = -60,
  max = 6,
  taper = 'audio',
  format,
  orientation = 'vertical',
  showValue = true,
  disabled = false,
  className,
}: VolumeFaderProps) {
  const vertical = orientation === 'vertical';
  return (
    <Fader
      aria-label={label}
      value={value}
      min={min}
      max={max}
      taper={taper}
      orientation={orientation}
      size="sm"
      disabled={disabled}
      onValueChange={(db) => onChange(db)}
      {...(onCommit ? { onValueCommitted: onCommit } : {})}
      {...(format ? { format } : {})}
      className={cn(vertical && 'min-h-20 flex-col items-center gap-1', className)}
    >
      <FaderTrack className={cn(vertical && 'min-h-0 flex-1')}>
        <FaderRange />
        <FaderThumb />
      </FaderTrack>
      {showValue && <FaderValue editable className="text-[10px]" />}
    </Fader>
  );
}
