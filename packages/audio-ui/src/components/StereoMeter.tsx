import { ClipIndicator } from '../audiocn/components/ui/clip-indicator';
import {
  LevelMeter,
  LevelMeterBar,
  LevelMeterChannel,
  LevelMeterChannels,
  LevelMeterHold,
  LevelMeterTrack,
} from '../audiocn/components/ui/level-meter';
import type { FrameSource, MeterFrame, Orientation } from '../audiocn/lib/audio/types';
import { cn } from '../audiocn/lib/utils';
import { MIX_METER_ZONES } from '../lib/meter-frame';

export interface StereoMeterProps {
  /** Accessible name of the meter. */
  label: string;
  /** Frames to paint; the meter subscribes and repaints without re-rendering React. */
  source: FrameSource<MeterFrame> | null;
  orientation?: Orientation;
  /** Track thickness. Default `sm`. */
  size?: 'sm' | 'default';
  /** A clip light next to the meter; click it to reset. Default true. */
  showClip?: boolean;
  /** Layer an RMS bar under the peak bar. Default false. */
  showRms?: boolean;
  minDb?: number;
  maxDb?: number;
  className?: string;
}

/**
 * Left/right peak meter with peak hold and a clip light. The clip light sits beside the meter
 * rather than inside it, because a `meter` role may not contain interactive elements.
 */
export function StereoMeter({
  label,
  source,
  orientation = 'vertical',
  size = 'sm',
  showClip = true,
  showRms = false,
  minDb = -60,
  maxDb = 0,
  className,
}: StereoMeterProps) {
  const vertical = orientation === 'vertical';
  return (
    <div
      className={cn('flex min-h-0 min-w-0 items-center gap-1', vertical && 'flex-col', className)}
      data-slot="stereo-meter"
    >
      {showClip && vertical && <ClipIndicator source={source} className="h-4" />}
      <LevelMeter
        aria-label={label}
        source={source}
        channelCount={2}
        orientation={orientation}
        size={size}
        minDb={minDb}
        maxDb={maxDb}
        zones={MIX_METER_ZONES}
        className={cn('[--meter-gap:2px]', vertical ? 'min-h-0 flex-1' : 'min-w-0 flex-1')}
      >
        <LevelMeterChannels>
          {[0, 1].map((index) => (
            <LevelMeterChannel key={index} index={index}>
              <LevelMeterTrack>
                {showRms && <LevelMeterBar measure="rms" className="opacity-60" />}
                <LevelMeterBar />
                <LevelMeterHold />
              </LevelMeterTrack>
            </LevelMeterChannel>
          ))}
        </LevelMeterChannels>
      </LevelMeter>
      {showClip && !vertical && <ClipIndicator source={source} className="h-4" />}
    </div>
  );
}
