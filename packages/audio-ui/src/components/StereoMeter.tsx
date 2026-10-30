import { Meter } from '@audio-ui/react/meter';
import { cn } from '../lib/cn';
import type { FrameSource } from '../lib/frame-source';
import {
  METER_FLOOR_DB,
  MIX_METER_CLIP_DB,
  MIX_METER_WARN_DB,
  type MeterFrame,
} from '../lib/meter-frame';

export interface StereoMeterProps {
  /** Accessible name of the meter. */
  label: string;
  /** Frames to paint; the meter subscribes and repaints without re-rendering React. */
  source: FrameSource<MeterFrame> | null;
  orientation?: 'horizontal' | 'vertical';
  /** Track thickness. Default `sm`. */
  size?: 'sm' | 'default';
  /** Light a clip mark on a channel once it reaches 0 dBFS; click the meter to reset. Default true. */
  showClip?: boolean;
  className?: string;
}

const CHANNELS = ['left', 'right'] as const;
const SILENT = [METER_FLOOR_DB, METER_FLOOR_DB];

/**
 * Left/right peak meter (`@audio-ui/react` Meter) with peak hold and a clip latch. Levels are
 * painted straight from the source, so a meter never re-renders React during playback.
 */
export function StereoMeter({
  label,
  source,
  orientation = 'vertical',
  size = 'sm',
  showClip = true,
  className,
}: StereoMeterProps) {
  const vertical = orientation === 'vertical';
  return (
    <Meter.Root
      aria-label={label}
      {...(source ? { source } : { value: SILENT })}
      min={METER_FLOOR_DB}
      max={0}
      warnThreshold={MIX_METER_WARN_DB}
      clipThreshold={MIX_METER_CLIP_DB}
      orientation={orientation}
      title={showClip ? 'Click to reset the clip lights' : undefined}
      className={cn(
        'flex min-h-0 min-w-0',
        vertical ? 'justify-center' : 'items-center',
        className,
      )}
      data-slot="stereo-meter"
    >
      <div className={cn('flex gap-0.5', vertical ? 'h-full flex-row' : 'w-full flex-col')}>
        <Meter.Channels>
          {(index) => (
            <Meter.Channel
              key={index}
              index={index}
              aria-label={`${label}, ${CHANNELS[index] ?? `channel ${index + 1}`}`}
              className={cn(
                'group/channel relative',
                vertical ? 'h-full' : 'w-full',
                vertical ? (size === 'sm' ? 'w-1.5' : 'w-2') : size === 'sm' ? 'h-1.5' : 'h-2',
              )}
            >
              <Meter.Track
                className={cn(
                  'relative size-full overflow-hidden rounded-[2px] bg-surface-0',
                  showClip &&
                    'group-data-clipped/channel:ring-1 group-data-clipped/channel:ring-record',
                )}
              >
                <Meter.Indicator
                  className={cn(
                    'absolute inset-0 bg-success',
                    'group-data-warning/channel:bg-warning group-data-clipping/channel:bg-record',
                  )}
                />
                <Meter.Peak
                  className={cn(
                    'absolute bg-text/80',
                    vertical ? 'inset-x-0 h-px' : 'inset-y-0 w-px',
                  )}
                />
              </Meter.Track>
            </Meter.Channel>
          )}
        </Meter.Channels>
      </div>
    </Meter.Root>
  );
}
