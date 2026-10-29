/**
 * Drum kit (INSTRUMENT_PARAM_SPECS.drums): one-shot buffers synthesized by
 * `synthesizeDrumVoice` at the context sample rate (seeded, deterministic), mapped by
 * GM note numbers. tune/decayScale/tone re-render the kit (debounced in realtime;
 * sounding hits keep their old buffers); gainDb is the instrument level. A closed or
 * pedal hi-hat (42/44) — or a new open hat (46) — chokes a sounding open hat.
 */
import {
  DRUM_VOICE_KINDS,
  HAT_CHOKE_NOTES,
  dbToGain,
  drumKindForNote,
  synthesizeDrumVoice,
  type DrumVoiceKind,
} from '@studio/audio-dsp';
import {
  INSTRUMENT_PARAM_SPECS,
  sanitizeParamValues,
  type ClipId,
  type InstrumentConfig,
} from '@studio/domain';
import { velocityToGain } from '@studio/engine-core';
import { DRUM_KIT_SEED, DRUM_RENDER_DEBOUNCE_MS, STOP_FADE_SECONDS } from '../constants';
import type { GraphContext } from '../graph/graph-context';
import { holdParam, safeDisconnect, safeStop, setParam } from '../util/audio-params';
import { LruCache } from '../util/lru';
import type { CancelOptions, Instrument, ScheduledNote, VoiceRecord } from './instrument';

const CHOKE_FADE_SECONDS = 0.008;

interface DrumHit extends VoiceRecord {
  readonly kind: DrumVoiceKind;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly velocityGain: number;
  ended: boolean;
}

const kitCache = new LruCache<ReadonlyMap<DrumVoiceKind, AudioBuffer>>(8);

/**
 * Renders (or reuses) the whole kit for a sample rate and parameter set. Kits are
 * deterministic, so identical requests share one cached set of read-only buffers
 * (≈ 110 ms of synthesis at 48 kHz saved per drum track and per bounce).
 */
export function renderDrumKit(
  sampleRate: number,
  params: { tuneSemitones: number; decayScale: number; tone: number },
): ReadonlyMap<DrumVoiceKind, AudioBuffer> {
  const key = `${sampleRate}|${params.tuneSemitones}|${params.decayScale}|${params.tone}`;
  return kitCache.getOrCreate(key, () => {
    const kit = new Map<DrumVoiceKind, AudioBuffer>();
    for (const kind of DRUM_VOICE_KINDS) {
      const samples = synthesizeDrumVoice(kind, sampleRate, { ...params, seed: DRUM_KIT_SEED });
      const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
      buffer.getChannelData(0).set(samples);
      kit.set(kind, buffer);
    }
    return kit;
  });
}

export class DrumKitInstrument implements Instrument {
  readonly kind = 'drums' as const;
  readonly output: GainNode;
  private kit: ReadonlyMap<DrumVoiceKind, AudioBuffer>;
  private kitKey: string;
  private readonly hits = new Set<DrumHit>();
  private nextId = 1;
  private readonly owner = {};

  constructor(
    private readonly g: GraphContext,
    config: InstrumentConfig,
  ) {
    const p = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.drums, config.params);
    this.output = new GainNode(g.ctx, { gain: dbToGain(p.gainDb!) });
    const synthParams = { tuneSemitones: p.tune!, decayScale: p.decayScale!, tone: p.tone! };
    this.kitKey = JSON.stringify(synthParams);
    this.kit = renderDrumKit(g.ctx.sampleRate, synthParams);
  }

  scheduleNote(note: ScheduledNote): void {
    this.trigger(note.pitch, note.velocity, note.onTime, true, note.clipId);
  }

  noteOn(pitch: number, velocity: number, time: number): void {
    this.trigger(pitch, velocity, time, false, undefined);
  }

  noteOff(): void {
    // One-shot voices ignore note-off.
  }

  releaseLive(): void {
    // One-shots finish on their own.
  }

  pitchBend(): void {
    // Not applicable to the drum kit.
  }

  modulation(): void {
    // Not applicable to the drum kit.
  }

  private trigger(
    pitch: number,
    velocity: number,
    time: number,
    transport: boolean,
    clipId: ClipId | undefined,
  ): void {
    const kind = drumKindForNote(pitch);
    if (!kind) return;
    const buffer = this.kit.get(kind)!;
    if (HAT_CHOKE_NOTES.includes(pitch)) {
      for (const hit of this.hits) {
        if (hit.kind === 'openHat' && !hit.ended && hit.startTime < time && hit.endTime > time) {
          holdParam(hit.gain.gain, time, hit.velocityGain);
          hit.gain.gain.setTargetAtTime(0, time, CHOKE_FADE_SECONDS / 3);
          hit.endTime = time + CHOKE_FADE_SECONDS * 2;
          safeStop(hit.source, hit.endTime);
        }
      }
    }
    const ctx = this.g.ctx;
    const source = new AudioBufferSourceNode(ctx, { buffer });
    const velocityGain = velocityToGain(velocity);
    const gain = new GainNode(ctx, { gain: velocityGain });
    source.connect(gain).connect(this.output);
    const hit: DrumHit = {
      id: this.nextId++,
      pitch,
      startTime: time,
      endTime: time + buffer.duration,
      transport,
      ...(clipId !== undefined ? { clipId } : {}),
      kind,
      source,
      gain,
      velocityGain,
      ended: false,
    };
    source.onended = () => this.cleanup(hit);
    source.start(time);
    this.hits.add(hit);
  }

  private cleanup(hit: DrumHit): void {
    if (hit.ended) return;
    hit.ended = true;
    hit.source.onended = null;
    safeStop(hit.source, 0);
    safeDisconnect(hit.source);
    safeDisconnect(hit.gain);
    this.hits.delete(hit);
  }

  cancelTransport(requested: number, options: CancelOptions = {}): void {
    const time = Math.max(requested, this.g.ctx.currentTime);
    for (const hit of [...this.hits]) {
      if (!hit.transport || hit.ended) continue;
      if (options.clipIds && (hit.clipId === undefined || !options.clipIds.has(hit.clipId)))
        continue;
      if (hit.startTime >= time) this.cleanup(hit);
      else if (!options.onlyUnstarted && hit.endTime > time) {
        holdParam(hit.gain.gain, time, hit.velocityGain);
        hit.gain.gain.linearRampToValueAtTime(0, time + STOP_FADE_SECONDS);
        hit.endTime = time + STOP_FADE_SECONDS + 0.002;
        safeStop(hit.source, hit.endTime);
      }
    }
  }

  update(config: InstrumentConfig): void {
    const p = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.drums, config.params);
    setParam(this.output.gain, dbToGain(p.gainDb!), this.g.ctx, false);
    const synthParams = { tuneSemitones: p.tune!, decayScale: p.decayScale!, tone: p.tone! };
    const key = JSON.stringify(synthParams);
    if (key === this.kitKey) return;
    this.kitKey = key;
    this.g.defer(this.owner, DRUM_RENDER_DEBOUNCE_MS, () => {
      this.kit = renderDrumKit(this.g.ctx.sampleRate, synthParams);
    });
  }

  activeVoiceCount(): number {
    return this.hits.size;
  }

  dispose(): void {
    this.g.cancelDeferred(this.owner);
    for (const hit of [...this.hits]) this.cleanup(hit);
    safeDisconnect(this.output);
  }
}
