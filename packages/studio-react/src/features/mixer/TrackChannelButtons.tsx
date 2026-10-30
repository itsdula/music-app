import { ArmToggle, MonitorToggle, MuteToggle, SoloToggle } from '@studio/audio-ui';
import type { Track } from '@studio/domain';
import { Tooltip } from '@studio/ui';
import { Circle, Headphones } from 'lucide-react';
import { useSession } from '../../session/context';

const MONITOR_LABEL = 'Monitor input (use headphones to avoid feedback)';

/** Undoable mute/solo/arm/monitor edits for one track, shared by every surface that shows them. */
export function useTrackChannelActions(track: Track) {
  const session = useSession();
  const { history } = session;
  const setMixer = (mixer: Partial<Track['mixer']>, label: string) =>
    history.execute({ type: 'track.setMixer', trackId: track.id, mixer }, { label });
  return {
    armLabel: track.kind === 'instrument' ? 'Arm for MIDI recording' : 'Arm for audio recording',
    setMute: (mute: boolean) => setMixer({ mute }, mute ? 'Mute' : 'Unmute'),
    setSolo: (solo: boolean) => setMixer({ solo }, solo ? 'Solo' : 'Unsolo'),
    setArmed: (armed: boolean) =>
      history.execute(
        { type: 'track.update', trackId: track.id, patch: { armed } },
        { label: armed ? 'Arm Track' : 'Disarm Track' },
      ),
    setMonitor: (on: boolean) => {
      history.execute(
        { type: 'track.update', trackId: track.id, patch: { monitor: on ? 'on' : 'off' } },
        { label: on ? 'Monitor On' : 'Monitor Off' },
      );
      void session.transport
        .ensureAudio()
        .then(() => session.engine.setInputMonitoring(track.id, on));
    },
  };
}

/** Mute, solo, arm and (on tracks that record audio) input monitoring in the track header. */
export function TrackChannelButtons({ track }: { track: Track }) {
  const actions = useTrackChannelActions(track);
  return (
    <>
      <Tooltip content="Mute">
        <MuteToggle
          size="sm"
          pressed={track.mixer.mute}
          onPressedChange={actions.setMute}
          data-testid="track-mute"
        >
          M
        </MuteToggle>
      </Tooltip>
      <Tooltip content="Solo">
        <SoloToggle
          size="sm"
          pressed={track.mixer.solo}
          onPressedChange={actions.setSolo}
          data-testid="track-solo"
        >
          S
        </SoloToggle>
      </Tooltip>
      <Tooltip content={actions.armLabel}>
        <ArmToggle
          size="sm"
          aria-label={actions.armLabel}
          pressed={track.armed}
          onPressedChange={actions.setArmed}
          data-testid="track-arm"
        >
          <Circle className={track.armed ? 'fill-current' : ''} aria-hidden />
        </ArmToggle>
      </Tooltip>
      {track.kind !== 'instrument' && (
        <Tooltip content={MONITOR_LABEL}>
          <MonitorToggle
            size="sm"
            aria-label={MONITOR_LABEL}
            pressed={track.monitor === 'on'}
            onPressedChange={actions.setMonitor}
            data-testid="track-monitor"
          >
            <Headphones aria-hidden />
          </MonitorToggle>
        </Tooltip>
      )}
    </>
  );
}

/** The compact mute/solo/arm row of a mixer channel strip. */
export function StripChannelButtons({ track }: { track: Track }) {
  const actions = useTrackChannelActions(track);
  return (
    <>
      <MuteToggle size="sm" pressed={track.mixer.mute} onPressedChange={actions.setMute}>
        M
      </MuteToggle>
      <SoloToggle size="sm" pressed={track.mixer.solo} onPressedChange={actions.setSolo}>
        S
      </SoloToggle>
      <ArmToggle
        size="sm"
        aria-label={actions.armLabel}
        pressed={track.armed}
        onPressedChange={actions.setArmed}
      >
        <Circle className={track.armed ? 'fill-current' : ''} aria-hidden />
      </ArmToggle>
    </>
  );
}
