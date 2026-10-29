/**
 * One mixer channel:
 *
 *   instrument / audio-clip voices / input monitor
 *     → input (2 ch) → effects → fader (dB) → pan → mute/solo gate → [meter tap] → master
 */
import type { ClipId, InstrumentConfig, Track } from '@studio/domain';
import {
  audioVoiceGainEnvelope,
  faderGain,
  gainEnvelopeAt,
  type GainPoint,
  type TimelineAudioEvent,
} from '@studio/engine-core';
import { AUDIO_DECLICK_SECONDS, PARAM_TIME_CONSTANT, STOP_FADE_SECONDS } from '../constants';
import { EffectChain } from '../effects/effect-chain';
import { createInstrument, type CancelOptions, type Instrument } from '../instruments';
import { holdParam, safeDisconnect, safeStop, setParam } from '../util/audio-params';
import type { GraphContext } from './graph-context';
import { MeterTap } from './meter';
import { BalancePanner } from './panner';

export interface AudioClipVoice {
  readonly key: string;
  readonly clipId: ClipId;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly startTime: number;
  /** Gain envelope relative to `startTime` (for exact holds when cancelled). */
  readonly envelope: readonly GainPoint[];
  endTime: number;
  /** Set when a stop/edit fades the voice out (it no longer counts as sounding). */
  cancelled: boolean;
  ended: boolean;
}

export interface PlayAudioRequest {
  readonly event: TimelineAudioEvent;
  readonly buffer: AudioBuffer;
  /** Engine time at which playback starts. */
  readonly when: number;
  /** Frames into the segment at which playback starts (asset-rate frames). */
  readonly offsetFrames: number;
  /** Frames to play (asset-rate frames). */
  readonly playFrames: number;
  readonly endsEarly: boolean;
}

function instrumentIdentity(config: InstrumentConfig | undefined): string {
  return config ? config.kind : '';
}

export class TrackChannel {
  readonly input: GainNode;
  readonly effects: EffectChain;
  readonly fader: GainNode;
  readonly panner: BalancePanner;
  readonly gate: GainNode;
  readonly meter: MeterTap | null;
  private instrument: Instrument | null = null;
  private instrumentKey = '';
  private readonly audioVoices = new Set<AudioClipVoice>();
  private monitorSource: AudioNode | null = null;
  private readonly monitorGain: GainNode;
  private track: Track;

  constructor(
    private readonly g: GraphContext,
    track: Track,
    gateGain: number,
    destination: AudioNode,
    withMeter: boolean,
  ) {
    const ctx = g.ctx;
    this.track = track;
    this.input = new GainNode(ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.effects = new EffectChain(g, track.effects);
    this.fader = new GainNode(ctx, { gain: faderGain(track.mixer.gainDb) });
    this.panner = new BalancePanner(ctx, track.mixer.pan);
    this.gate = new GainNode(ctx, { gain: gateGain });
    this.monitorGain = new GainNode(ctx, { gain: 1 });
    this.monitorGain.connect(this.input);
    this.input.connect(this.effects.input);
    this.effects.output.connect(this.fader).connect(this.panner.input);
    this.panner.output.connect(this.gate).connect(destination);
    this.meter = withMeter ? new MeterTap(g, this.gate) : null;
    this.syncInstrument(track.instrument);
  }

  get currentTrack(): Track {
    return this.track;
  }

  get instrumentNode(): Instrument | null {
    return this.instrument;
  }

  private syncInstrument(config: InstrumentConfig | undefined): void {
    const key = instrumentIdentity(config);
    if (key === this.instrumentKey && this.instrument && config) {
      this.instrument.update(config);
      return;
    }
    if (this.instrument) {
      const old = this.instrument;
      old.cancelTransport(this.g.ctx.currentTime);
      old.releaseLive(this.g.ctx.currentTime);
      // Let releases finish before tearing the old instrument down.
      this.g.defer(old, 250, () => old.dispose());
    }
    this.instrumentKey = key;
    this.instrument = config ? createInstrument(this.g, config) : null;
    this.instrument?.output.connect(this.input);
  }

  update(track: Track, gateGain: number): void {
    const ctx = this.g.ctx;
    this.track = track;
    setParam(this.fader.gain, faderGain(track.mixer.gainDb), ctx, false);
    this.panner.set(track.mixer.pan, false);
    this.setGate(gateGain);
    this.effects.update(track.effects);
    this.syncInstrument(track.instrument);
  }

  setGate(gain: number): void {
    setParam(this.gate.gain, gain, this.g.ctx, false, PARAM_TIME_CONSTANT / 2);
  }

  /** Starts an audio-clip voice (sample-accurate start/stop via AudioBufferSourceNode). */
  playAudio(request: PlayAudioRequest): AudioClipVoice | null {
    const { event, buffer, when, offsetFrames, playFrames } = request;
    if (playFrames <= 0) return null;
    const ctx = this.g.ctx;
    const source = new AudioBufferSourceNode(ctx, { buffer });
    const gain = new GainNode(ctx, { gain: 0 });
    source.connect(gain).connect(this.input);
    const rate = event.sampleRate;
    const points = audioVoiceGainEnvelope({
      clipOffsetFrames: event.clipOffsetFrames + offsetFrames,
      playFrames,
      clipLengthFrames: event.clipLengthFrames,
      fadeInFrames: event.fadeInFrames,
      fadeOutFrames: event.fadeOutFrames,
      sampleRate: rate,
      gain: event.gain,
      startsMidway: offsetFrames > 0,
      endsEarly: request.endsEarly,
      declickFrames: AUDIO_DECLICK_SECONDS * rate,
    });
    gain.gain.setValueAtTime(points[0]!.gain, when);
    for (let i = 1; i < points.length; i++) {
      gain.gain.linearRampToValueAtTime(points[i]!.gain, when + points[i]!.offsetSeconds);
    }
    const offsetSeconds = (event.sourceStartFrame + offsetFrames) / rate;
    const duration = playFrames / rate;
    source.start(when, offsetSeconds, duration);
    const voice: AudioClipVoice = {
      key: event.key,
      clipId: event.clipId,
      source,
      gain,
      startTime: when,
      envelope: points,
      endTime: when + duration,
      cancelled: false,
      ended: false,
    };
    source.onended = () => this.cleanupAudio(voice);
    this.audioVoices.add(voice);
    return voice;
  }

  /** True when a voice of segment `key` is sounding at `time`. */
  hasAudioVoice(key: string, time: number): boolean {
    for (const voice of this.audioVoices) {
      if (
        !voice.ended &&
        !voice.cancelled &&
        voice.key === key &&
        voice.startTime <= time &&
        voice.endTime > time
      ) {
        return true;
      }
    }
    return false;
  }

  private cleanupAudio(voice: AudioClipVoice): void {
    if (voice.ended) return;
    voice.ended = true;
    voice.source.onended = null;
    safeStop(voice.source, 0);
    safeDisconnect(voice.source);
    safeDisconnect(voice.gain);
    this.audioVoices.delete(voice);
  }

  /** Cancels transport voices (instrument notes and audio clips). */
  cancelTransport(
    requested: number,
    options: CancelOptions & { readonly audioOnly?: boolean } = {},
  ): void {
    const time = Math.max(requested, this.g.ctx.currentTime);
    if (!options.audioOnly) this.instrument?.cancelTransport(time, options);
    for (const voice of [...this.audioVoices]) {
      if (voice.ended) continue;
      if (options.clipIds && !options.clipIds.has(voice.clipId)) continue;
      if (voice.startTime >= time) this.cleanupAudio(voice);
      else if (!options.onlyUnstarted && voice.endTime > time) {
        voice.cancelled = true;
        holdParam(
          voice.gain.gain,
          time,
          gainEnvelopeAt(voice.envelope, time - voice.startTime),
          true,
        );
        voice.gain.gain.linearRampToValueAtTime(0, time + STOP_FADE_SECONDS);
        voice.endTime = time + STOP_FADE_SECONDS + 0.002;
        safeStop(voice.source, voice.endTime);
      }
    }
  }

  /** Routes a live input (MediaStreamAudioSourceNode) through this channel; null removes it. */
  setMonitorInput(node: AudioNode | null): void {
    if (this.monitorSource === node) return;
    if (this.monitorSource) safeDisconnect(this.monitorSource, this.monitorGain);
    this.monitorSource = node;
    node?.connect(this.monitorGain);
  }

  get monitoring(): boolean {
    return this.monitorSource !== null;
  }

  activeVoiceCount(): number {
    return this.audioVoices.size + (this.instrument?.activeVoiceCount() ?? 0);
  }

  /** Fades the channel out (realtime) and releases all nodes. */
  dispose(): void {
    const teardown = () => {
      this.instrument?.dispose();
      for (const voice of [...this.audioVoices]) this.cleanupAudio(voice);
      this.setMonitorInput(null);
      this.meter?.dispose();
      this.effects.dispose();
      this.panner.dispose();
      for (const node of [this.input, this.fader, this.gate, this.monitorGain])
        safeDisconnect(node);
    };
    if (this.g.realtime) {
      setParam(this.gate.gain, 0, this.g.ctx, false, PARAM_TIME_CONSTANT / 2);
      this.g.defer(this, 60, teardown);
    } else {
      teardown();
    }
  }
}
