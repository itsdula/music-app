import { Toggle } from '@base-ui/react/toggle';
import { cn } from '../lib/cn';

/*
 * @audio-ui/react has no channel buttons, so mute/solo/monitor/arm stay on the Base UI toggle,
 * styled to sit next to its knobs and faders.
 */

type Tone = 'neutral' | 'mute' | 'solo' | 'monitor' | 'arm';

const TONES: Record<Tone, string> = {
  neutral: 'data-pressed:bg-text data-pressed:text-surface-0',
  mute: 'data-pressed:border-warning/40 data-pressed:bg-warning/15 data-pressed:text-warning',
  solo: 'data-pressed:border-accent-strong/50 data-pressed:bg-accent-strong/20 data-pressed:text-accent-strong',
  monitor: 'data-pressed:border-success/40 data-pressed:bg-success/15 data-pressed:text-success',
  arm: 'data-pressed:border-record/50 data-pressed:bg-record/20 data-pressed:text-record',
};

const SIZES = {
  sm: 'h-6 min-w-6 px-1',
  default: 'h-7 min-w-7 px-1.5',
  lg: 'h-8 min-w-8 px-2',
} as const;

export type ChannelToggleProps = Toggle.Props & {
  tone?: Tone;
  size?: keyof typeof SIZES;
};

export function ChannelToggle({
  tone = 'neutral',
  size = 'default',
  className,
  ...props
}: ChannelToggleProps) {
  return (
    <Toggle
      data-slot="channel-toggle"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-transparent',
        'bg-surface-3 text-xs font-semibold whitespace-nowrap text-text-muted transition-colors select-none',
        'outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-3.5',
        SIZES[size],
        TONES[tone],
        typeof className === 'string' ? className : undefined,
      )}
      {...props}
    />
  );
}

export type ChannelTogglePresetProps = Omit<ChannelToggleProps, 'tone'>;

export const MuteToggle = (props: ChannelTogglePresetProps) => (
  <ChannelToggle aria-label="Mute" data-slot="mute-toggle" tone="mute" {...props} />
);

export const SoloToggle = (props: ChannelTogglePresetProps) => (
  <ChannelToggle aria-label="Solo" data-slot="solo-toggle" tone="solo" {...props} />
);

export const MonitorToggle = (props: ChannelTogglePresetProps) => (
  <ChannelToggle aria-label="Monitor" data-slot="monitor-toggle" tone="monitor" {...props} />
);

/** Record-arm toggle, in the record colour. */
export const ArmToggle = (props: ChannelTogglePresetProps) => (
  <ChannelToggle aria-label="Arm for recording" data-slot="arm-toggle" tone="arm" {...props} />
);
