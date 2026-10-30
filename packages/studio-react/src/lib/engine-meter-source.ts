import type { ChannelMeter, MeterSnapshot } from '@studio/audio-contracts';
import {
  createFrameEmitter,
  meterFrameFromGains,
  type FrameEmitter,
  type FrameSource,
  type MeterFrame,
} from '@studio/audio-ui';
import type { TrackId } from '@studio/domain';
import { useSession } from '../session/context';
import type { StudioSession } from '../session/studio-session';

/** What a meter shows: the master bus or one track. */
export type MeterTarget = 'master' | TrackId;

interface Feed {
  readonly source: FrameEmitter<MeterFrame>;
  silent: boolean;
}

const isSilent = (meter: ChannelMeter) => meter.peak.every((p) => p === 0);

/**
 * Reads the engine meters once per rendered frame and fans them out to one FrameSource per
 * target. `engine.readMeters()` returns peaks "since the previous read", so two components
 * reading it in the same frame would split the signal between them; every meter for a
 * target (track header, mixer strip, transport) subscribes to the same source instead.
 */
export class EngineMeterHub {
  private readonly feeds = new Map<MeterTarget, Feed>();

  constructor(session: StudioSession) {
    session.renderLoop.add(() => this.publish(session.engine.readMeters()));
  }

  source(target: MeterTarget): FrameSource<MeterFrame> {
    let feed = this.feeds.get(target);
    if (!feed) {
      feed = { source: createFrameEmitter<MeterFrame>(), silent: false };
      this.feeds.set(target, feed);
    }
    return feed.source;
  }

  private publish(meters: MeterSnapshot): void {
    for (const [target, feed] of this.feeds) {
      const meter = target === 'master' ? meters.master : meters.tracks[target];
      if (!meter) continue;
      // Repeated silent frames are skipped so idle meters settle and stop painting.
      const silent = isSilent(meter);
      if (silent && feed.silent) continue;
      feed.silent = silent;
      feed.source.emit(meterFrameFromGains(meter.peak, meter.rms));
    }
  }
}

const hubs = new WeakMap<StudioSession, EngineMeterHub>();

/** The shared meter FrameSource for the master bus or a track; meters paint from it. */
export function useEngineMeterSource(target: MeterTarget): FrameSource<MeterFrame> {
  const session = useSession();
  let hub = hubs.get(session);
  if (!hub) {
    hub = new EngineMeterHub(session);
    hubs.set(session, hub);
  }
  return hub.source(target);
}
