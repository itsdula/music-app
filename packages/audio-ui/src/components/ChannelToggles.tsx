import {
  ChannelToggle,
  MonitorToggle,
  MuteToggle,
  SoloToggle,
  type ChannelTogglePresetProps,
} from '../audiocn/components/ui/channel-toggle';
import { cn } from '../audiocn/lib/utils';

export { ChannelToggle, MonitorToggle, MuteToggle, SoloToggle, type ChannelTogglePresetProps };

/** Record-arm toggle: the neutral channel toggle in destructive (record) colour. */
export function ArmToggle({ className, ...props }: ChannelTogglePresetProps) {
  return (
    <ChannelToggle
      aria-label="Arm for recording"
      data-slot="arm-toggle"
      tone="neutral"
      className={cn(
        'data-pressed:border data-pressed:border-destructive/50 data-pressed:bg-destructive/20 data-pressed:text-destructive',
        className,
      )}
      {...props}
    />
  );
}
