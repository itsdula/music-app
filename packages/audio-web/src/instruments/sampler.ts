/**
 * Sampler (INSTRUMENT_PARAM_SPECS.sampler): plays `instrument.sampleAssetId` pitched by
 * 2^((note − rootNote)/12) (playbackRate; duration scales accordingly), with a linear
 * attack and an exponential release. Gate mode releases on note-off; one-shot mode
 * plays to the end of the sample. At most SAMPLER_MAX_VOICES voices (oldest stolen).
 */
import { dbToGain } from '@studio/audio-dsp';
import {
  INSTRUMENT_PARAM_SPECS,
  sanitizeParamValues,
  type AssetId,
  type ClipId,
  type InstrumentConfig,
} from '@studio/domain';
import {
  VOICE_STOP_MARGIN_SECONDS,
  releaseTimeConstant,
  samplerPlaybackRate,
  selectVoicesToSteal,
  velocityToGain,
} from '@studio/engine-core';
import { SAMPLER_MAX_VOICES, STEAL_FADE_SECONDS, STOP_FADE_SECONDS } from '../constants';
import type { GraphContext } from '../graph/graph-context';
import { holdParam, safeDisconnect, safeStop, setParam } from '../util/audio-params';
import type { CancelOptions, Instrument, ScheduledNote, VoiceRecord } from './instrument';

interface SamplerVoice extends VoiceRecord {
  readonly source: AudioBufferSourceNode;
  readonly amp: GainNode;
  readonly peak: number;
  readonly attackEnd: number;
  releaseStart: number | null;
  ended: boolean;
}

export class SamplerInstrument implements Instrument {
  readonly kind = 'sampler' as const;
  readonly output: GainNode;
  private params: Readonly<Record<string, number>>;
  private sampleAssetId: AssetId | undefined;
  private readonly voices = new Set<SamplerVoice>();
  private readonly live = new Map<number, SamplerVoice>();
  private nextId = 1;
  private warnedMissing = false;

  constructor(
    private readonly g: GraphContext,
    config: InstrumentConfig,
  ) {
    this.params = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.sampler, config.params);
    this.sampleAssetId = config.sampleAssetId;
    this.output = new GainNode(g.ctx, { gain: dbToGain(this.params.gainDb!) });
  }

  get assetId(): AssetId | undefined {
    return this.sampleAssetId;
  }

  private get oneShot(): boolean {
    return this.params.oneShot! >= 0.5;
  }

  scheduleNote(note: ScheduledNote): void {
    this.start(note.pitch, note.velocity, note.onTime, note.offTime, true, note.clipId);
  }

  noteOn(pitch: number, velocity: number, time: number): void {
    const existing = this.live.get(pitch);
    if (existing) this.release(existing, time);
    const voice = this.start(pitch, velocity, time, null, false, undefined);
    if (voice) this.live.set(pitch, voice);
  }

  noteOff(pitch: number, time: number): void {
    const voice = this.live.get(pitch);
    if (!voice) return;
    this.live.delete(pitch);
    if (!this.oneShot) this.release(voice, time);
  }

  releaseLive(time: number): void {
    for (const [pitch, voice] of this.live) {
      this.live.delete(pitch);
      this.release(voice, time);
    }
  }

  pitchBend(): void {
    // Not supported by the sampler (documented limitation).
  }

  modulation(): void {
    // Not supported by the sampler.
  }

  private start(
    pitch: number,
    velocity: number,
    onTime: number,
    offTime: number | null,
    transport: boolean,
    clipId: ClipId | undefined,
  ): SamplerVoice | null {
    const buffer = this.sampleAssetId ? this.g.assets.get(this.sampleAssetId) : undefined;
    if (!buffer) {
      if (!this.warnedMissing) {
        this.warnedMissing = true;
        this.g.logger.warn('sampler has no loaded sample', { assetId: this.sampleAssetId });
      }
      return null;
    }
    for (const id of selectVoicesToSteal([...this.voices], onTime, SAMPLER_MAX_VOICES)) {
      const victim = [...this.voices].find((v) => v.id === id);
      if (victim) this.fade(victim, onTime, STEAL_FADE_SECONDS);
    }
    const ctx = this.g.ctx;
    const p = this.params;
    const rate = samplerPlaybackRate(pitch, Math.round(p.rootNote!));
    const source = new AudioBufferSourceNode(ctx, { buffer, playbackRate: rate });
    const amp = new GainNode(ctx, { gain: 0 });
    source.connect(amp).connect(this.output);
    const peak = velocityToGain(velocity);
    const attack = p.attack!;
    amp.gain.setValueAtTime(0, onTime);
    amp.gain.linearRampToValueAtTime(peak, onTime + attack);
    const voice: SamplerVoice = {
      id: this.nextId++,
      pitch,
      startTime: onTime,
      endTime: onTime + buffer.duration / rate,
      transport,
      ...(clipId !== undefined ? { clipId } : {}),
      source,
      amp,
      peak,
      attackEnd: onTime + attack,
      releaseStart: null,
      ended: false,
    };
    source.onended = () => this.cleanup(voice);
    source.start(onTime);
    this.voices.add(voice);
    if (offTime !== null && !this.oneShot) this.release(voice, Math.max(onTime, offTime));
    return voice;
  }

  /** Analytic envelope level of a voice at `time` (linear attack, exponential release). */
  private levelAt(voice: SamplerVoice, time: number): number {
    if (time <= voice.startTime) return 0;
    if (voice.releaseStart !== null && time >= voice.releaseStart) {
      const atRelease = this.levelAt({ ...voice, releaseStart: null }, voice.releaseStart);
      return (
        atRelease *
        Math.exp(-(time - voice.releaseStart) / releaseTimeConstant(this.params.release!))
      );
    }
    if (time < voice.attackEnd) {
      return (
        voice.peak * ((time - voice.startTime) / Math.max(1e-6, voice.attackEnd - voice.startTime))
      );
    }
    return voice.peak;
  }

  private release(voice: SamplerVoice, time: number): void {
    if (voice.ended || voice.releaseStart !== null || time >= voice.endTime) return;
    const release = this.params.release!;
    holdParam(voice.amp.gain, time, this.levelAt(voice, time), time < voice.attackEnd);
    voice.amp.gain.setTargetAtTime(0, time, releaseTimeConstant(release));
    voice.releaseStart = time;
    voice.endTime = Math.min(voice.endTime, time + release + VOICE_STOP_MARGIN_SECONDS);
    safeStop(voice.source, voice.endTime);
  }

  private fade(voice: SamplerVoice, time: number, seconds: number): void {
    if (voice.ended || voice.endTime <= time) return;
    if (voice.startTime >= time) {
      this.cleanup(voice);
      return;
    }
    holdParam(voice.amp.gain, time, this.levelAt(voice, time), time < voice.attackEnd);
    voice.amp.gain.linearRampToValueAtTime(0, time + seconds);
    voice.endTime = time + seconds + 0.002;
    voice.releaseStart = time;
    safeStop(voice.source, voice.endTime);
  }

  private cleanup(voice: SamplerVoice): void {
    if (voice.ended) return;
    voice.ended = true;
    voice.source.onended = null;
    safeStop(voice.source, 0);
    safeDisconnect(voice.source);
    safeDisconnect(voice.amp);
    this.voices.delete(voice);
    for (const [pitch, v] of this.live) if (v === voice) this.live.delete(pitch);
  }

  cancelTransport(requested: number, options: CancelOptions = {}): void {
    const time = Math.max(requested, this.g.ctx.currentTime);
    for (const voice of [...this.voices]) {
      if (!voice.transport || voice.ended) continue;
      if (options.clipIds && (voice.clipId === undefined || !options.clipIds.has(voice.clipId)))
        continue;
      if (voice.startTime >= time) this.cleanup(voice);
      else if (!options.onlyUnstarted) this.fade(voice, time, STOP_FADE_SECONDS);
    }
  }

  update(config: InstrumentConfig): void {
    this.params = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.sampler, config.params);
    if (config.sampleAssetId !== this.sampleAssetId) this.warnedMissing = false;
    this.sampleAssetId = config.sampleAssetId;
    setParam(this.output.gain, dbToGain(this.params.gainDb!), this.g.ctx, false);
  }

  activeVoiceCount(): number {
    return this.voices.size;
  }

  dispose(): void {
    for (const voice of [...this.voices]) this.cleanup(voice);
    safeDisconnect(this.output);
  }
}
