/**
 * The audio graph for a whole project: track channels → master bus → destination, plus
 * the metronome. Built identically on the realtime AudioContext and on
 * OfflineAudioContexts for bounces.
 */
import type {
  MasterBus as MasterBusModel,
  MetronomeSettings,
  Track,
  TrackId,
} from '@studio/domain';
import { faderGain, resolveTrackGates } from '@studio/engine-core';
import { EffectChain } from '../effects/effect-chain';
import type { CancelOptions } from '../instruments';
import { safeDisconnect, setParam } from '../util/audio-params';
import type { GraphContext } from './graph-context';
import { MeterTap } from './meter';
import { MetronomeVoice } from './metronome';
import { TrackChannel } from './track-channel';

export class MasterBus {
  readonly input: GainNode;
  readonly effects: EffectChain;
  readonly fader: GainNode;
  readonly meter: MeterTap | null;

  constructor(
    private readonly g: GraphContext,
    master: MasterBusModel,
    destination: AudioNode,
    withMeter: boolean,
  ) {
    const ctx = g.ctx;
    this.input = new GainNode(ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.effects = new EffectChain(g, master.effects);
    this.fader = new GainNode(ctx, { gain: faderGain(master.gainDb) });
    this.input.connect(this.effects.input);
    this.effects.output.connect(this.fader).connect(destination);
    this.meter = withMeter ? new MeterTap(g, this.fader) : null;
  }

  update(master: MasterBusModel): void {
    setParam(this.fader.gain, faderGain(master.gainDb), this.g.ctx, false);
    this.effects.update(master.effects);
  }

  dispose(): void {
    this.meter?.dispose();
    this.effects.dispose();
    safeDisconnect(this.input);
    safeDisconnect(this.fader);
  }
}

export interface ProjectGraphInit {
  readonly tracks: readonly Track[];
  readonly master: MasterBusModel;
  readonly metronome: MetronomeSettings;
  /** Create meter taps (realtime only). */
  readonly meters: boolean;
}

export class ProjectGraph {
  readonly master: MasterBus;
  readonly metronome: MetronomeVoice;
  private readonly channels = new Map<TrackId, TrackChannel>();
  private readonly tracks = new Map<TrackId, Track>();
  private readonly meters: boolean;

  constructor(
    readonly g: GraphContext,
    init: ProjectGraphInit,
  ) {
    const destination = g.ctx.destination;
    this.meters = init.meters;
    this.master = new MasterBus(g, init.master, destination, init.meters);
    this.metronome = new MetronomeVoice(g, init.metronome.gainDb, destination);
    for (const track of init.tracks) this.tracks.set(track.id, track);
    const gates = resolveTrackGates(init.tracks);
    for (const track of init.tracks) {
      this.channels.set(
        track.id,
        new TrackChannel(g, track, gates.get(track.id) ?? 1, this.master.input, init.meters),
      );
    }
  }

  channel(id: TrackId): TrackChannel | undefined {
    return this.channels.get(id);
  }

  channelEntries(): IterableIterator<[TrackId, TrackChannel]> {
    return this.channels.entries();
  }

  get trackCount(): number {
    return this.channels.size;
  }

  private refreshGates(): Map<TrackId, 0 | 1> {
    const gates = resolveTrackGates([...this.tracks.values()]);
    return gates;
  }

  addTrack(track: Track): void {
    if (this.channels.has(track.id)) {
      this.updateTrack(track);
      return;
    }
    this.tracks.set(track.id, track);
    const gates = this.refreshGates();
    this.channels.set(
      track.id,
      new TrackChannel(this.g, track, gates.get(track.id) ?? 1, this.master.input, this.meters),
    );
    this.applyGates(gates, track.id);
  }

  updateTrack(track: Track): void {
    const channel = this.channels.get(track.id);
    if (!channel) {
      this.addTrack(track);
      return;
    }
    this.tracks.set(track.id, track);
    const gates = this.refreshGates();
    channel.update(track, gates.get(track.id) ?? 1);
    this.applyGates(gates, track.id);
  }

  removeTrack(id: TrackId): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    this.channels.delete(id);
    this.tracks.delete(id);
    channel.dispose();
    this.applyGates(this.refreshGates());
  }

  private applyGates(gates: Map<TrackId, 0 | 1>, skip?: TrackId): void {
    for (const [id, channel] of this.channels) if (id !== skip) channel.setGate(gates.get(id) ?? 1);
  }

  updateMaster(master: MasterBusModel): void {
    this.master.update(master);
  }

  cancelTransport(
    time: number,
    options: CancelOptions & { readonly audioOnly?: boolean } = {},
  ): void {
    for (const channel of this.channels.values()) channel.cancelTransport(time, options);
    if (!options.audioOnly && !options.clipIds) this.metronome.cancel(time);
  }

  activeVoiceCount(): number {
    let count = 0;
    for (const channel of this.channels.values()) count += channel.activeVoiceCount();
    return count;
  }

  dispose(): void {
    for (const channel of this.channels.values()) channel.dispose();
    this.channels.clear();
    this.metronome.dispose();
    this.master.dispose();
  }
}
