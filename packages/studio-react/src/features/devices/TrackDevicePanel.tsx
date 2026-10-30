import type { Track } from '@studio/domain';
import { EffectChain } from './EffectChain';
import { InstrumentPanel } from './InstrumentPanel';

/** Device view for the selected track: instrument (if any) followed by its effect chain. */
export function TrackDevicePanel({ track }: { track: Track }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-start gap-2 overflow-auto p-2"
      data-testid="track-devices"
    >
      {track.instrument && <InstrumentPanel track={track} />}
      <EffectChain target={track.id} effects={track.effects} />
    </div>
  );
}
