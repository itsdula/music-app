/**
 * Polyphonic subtractive synth (INSTRUMENT_PARAM_SPECS.synth).
 *
 * Voice: osc1 + osc2 (mix, detune, octave) → resonant lowpass (filter envelope up to
 * +4 octaves above cutoff) → amp ADSR → instrument level. Shared per instrument: a
 * ConstantSource carrying pitch bend (cents) and a 5.5 Hz LFO scaled by the mod wheel
 * (vibrato), both connected to every oscillator's detune.
 *
 * Scheduled notes get their whole envelope at once (setTarget → setTarget transitions
 * are continuous, so no cancellation is needed). Steals, mono legato and live releases
 * freeze the envelope with cancelAndHoldAtTime (analytic fallback where unsupported).
 * Voices disconnect themselves on `ended`.
 */
import { dbToGain } from '@studio/audio-dsp';
import {
  INSTRUMENT_PARAM_SPECS,
  OSCILLATOR_WAVEFORMS,
  sanitizeParamValues,
  type ClipId,
  type InstrumentConfig,
} from '@studio/domain';
import {
  VIBRATO_RATE_HZ,
  VOICE_STOP_MARGIN_SECONDS,
  adsrLevelAt,
  filterEnvelopePeakHz,
  midiToFrequency,
  pitchBendCents,
  releaseLevelAt,
  releaseTimeConstant,
  resonanceToQDb,
  selectVoicesToSteal,
  velocityToGain,
  vibratoDepthCents,
  DECAY_TIME_CONSTANT_DIVISOR,
  type AdsrShape,
} from '@studio/engine-core';
import { STEAL_FADE_SECONDS, STOP_FADE_SECONDS, SYNTH_VOICE_LEVEL } from '../constants';
import type { GraphContext } from '../graph/graph-context';
import { holdParam, safeDisconnect, safeStop, setParam } from '../util/audio-params';
import type { CancelOptions, Instrument, ScheduledNote, VoiceRecord } from './instrument';

type SynthParams = Readonly<Record<string, number>>;

function waveform(index: number): OscillatorType {
  return OSCILLATOR_WAVEFORMS[Math.round(index)] ?? 'sawtooth';
}

class SynthVoice implements VoiceRecord {
  endTime: number;
  releaseStart: number | null = null;
  ended = false;
  attackEnd: number;

  constructor(
    readonly id: number,
    public pitch: number,
    readonly startTime: number,
    readonly transport: boolean,
    readonly clipId: ClipId | undefined,
    readonly osc1: OscillatorNode,
    readonly osc2: OscillatorNode,
    readonly g1: GainNode,
    readonly g2: GainNode,
    readonly filter: BiquadFilterNode,
    readonly amp: GainNode,
    readonly peak: number,
    readonly shape: AdsrShape,
    public release: number,
  ) {
    this.endTime = Number.POSITIVE_INFINITY;
    this.attackEnd = startTime + shape.attack;
  }

  /** Analytic envelope value (used where cancelAndHoldAtTime is unavailable). */
  levelAt(time: number): number {
    if (this.releaseStart !== null && time >= this.releaseStart) {
      const held = this.peak * adsrLevelAt(this.shape, this.releaseStart - this.startTime);
      return releaseLevelAt(held, this.release, time - this.releaseStart);
    }
    return this.peak * adsrLevelAt(this.shape, time - this.startTime);
  }
}

export class SynthInstrument implements Instrument {
  readonly kind = 'synth' as const;
  readonly output: GainNode;
  private readonly bend: ConstantSourceNode;
  private readonly lfo: OscillatorNode;
  private readonly vibrato: GainNode;
  private params: SynthParams;
  private readonly voices = new Set<SynthVoice>();
  /** Live voices by pitch (held or sustained). */
  private readonly live = new Map<number, SynthVoice>();
  private lastPitch: number | null = null;
  private nextId = 1;

  constructor(
    private readonly g: GraphContext,
    config: InstrumentConfig,
  ) {
    const ctx = g.ctx;
    this.params = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.synth, config.params);
    this.output = new GainNode(ctx, { gain: dbToGain(this.params.gainDb!) });
    this.bend = new ConstantSourceNode(ctx, { offset: 0 });
    this.lfo = new OscillatorNode(ctx, { type: 'sine', frequency: VIBRATO_RATE_HZ });
    this.vibrato = new GainNode(ctx, { gain: 0 });
    this.lfo.connect(this.vibrato);
    this.bend.start();
    this.lfo.start();
  }

  private get polyphony(): number {
    return Math.max(1, Math.round(this.params.polyphony!));
  }

  private get glideSeconds(): number {
    return this.polyphony === 1 ? this.params.glideMs! / 1000 : 0;
  }

  scheduleNote(note: ScheduledNote): void {
    this.start(note.pitch, note.velocity, note.onTime, note.offTime, true, note.clipId);
  }

  noteOn(pitch: number, velocity: number, time: number): void {
    const existing = this.live.get(pitch);
    if (existing) this.releaseVoice(existing, time);
    const voice = this.start(pitch, velocity, time, null, false, undefined);
    if (voice) this.live.set(pitch, voice);
  }

  noteOff(pitch: number, time: number): void {
    const voice = this.live.get(pitch);
    if (!voice) return;
    this.live.delete(pitch);
    this.releaseVoice(voice, time);
  }

  releaseLive(time: number): void {
    for (const [pitch, voice] of this.live) {
      this.live.delete(pitch);
      this.releaseVoice(voice, time);
    }
  }

  pitchBend(value: number, time: number): void {
    this.bend.offset.setTargetAtTime(pitchBendCents(value), time, 0.005);
  }

  modulation(value: number, time: number): void {
    this.vibrato.gain.setTargetAtTime(vibratoDepthCents(value), time, 0.02);
  }

  private start(
    pitch: number,
    velocity: number,
    onTime: number,
    offTime: number | null,
    transport: boolean,
    clipId: ClipId | undefined,
  ): SynthVoice | null {
    const p = this.params;
    const glide = this.glideSeconds;
    if (this.polyphony === 1) {
      // Mono: legato into a voice still held at onTime, else steal whatever sounds.
      const held = [...this.voices].find(
        (v) =>
          !v.ended && v.startTime <= onTime && (v.releaseStart === null || v.releaseStart > onTime),
      );
      if (held) {
        this.legato(held, pitch, velocity, onTime, offTime, glide);
        if (!transport) {
          // The voice now belongs to the new key: releasing the old key must not stop it.
          for (const [key, voice] of this.live) if (voice === held) this.live.delete(key);
          this.live.set(pitch, held);
        }
        return held;
      }
    }
    const steal = selectVoicesToSteal(
      [...this.voices].filter((v) => !v.ended),
      onTime,
      this.polyphony,
    );
    for (const id of steal) {
      const victim = [...this.voices].find((v) => v.id === id);
      if (victim) this.fadeOut(victim, onTime, STEAL_FADE_SECONDS);
    }

    const ctx = this.g.ctx;
    const frequency = midiToFrequency(pitch);
    const octave = Math.pow(2, Math.round(p.osc2Octave!));
    const osc1 = new OscillatorNode(ctx, { type: waveform(p.osc1Waveform!), frequency });
    const osc2 = new OscillatorNode(ctx, {
      type: waveform(p.osc2Waveform!),
      frequency: frequency * octave,
      detune: p.osc2Detune!,
    });
    const mix = Math.min(1, Math.max(0, p.osc2Mix!));
    const g1 = new GainNode(ctx, { gain: 1 - mix });
    const g2 = new GainNode(ctx, { gain: mix });
    const cutoff = Math.min(p.cutoffHz!, 0.45 * ctx.sampleRate);
    const filter = new BiquadFilterNode(ctx, {
      type: 'lowpass',
      frequency: cutoff,
      Q: resonanceToQDb(p.resonance!),
    });
    const amp = new GainNode(ctx, { gain: 0 });
    osc1.connect(g1).connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(amp).connect(this.output);
    for (const osc of [osc1, osc2]) {
      this.bend.connect(osc.detune);
      this.vibrato.connect(osc.detune);
    }

    if (glide > 0 && this.lastPitch !== null && this.lastPitch !== pitch) {
      const from = midiToFrequency(this.lastPitch);
      osc1.frequency.setValueAtTime(from, onTime);
      osc1.frequency.exponentialRampToValueAtTime(frequency, onTime + glide);
      osc2.frequency.setValueAtTime(from * octave, onTime);
      osc2.frequency.exponentialRampToValueAtTime(frequency * octave, onTime + glide);
    } else {
      // Anchor events so later holds (legato glides) start from this note's pitch.
      osc1.frequency.setValueAtTime(frequency, onTime);
      osc2.frequency.setValueAtTime(frequency * octave, onTime);
    }
    this.lastPitch = pitch;

    const peakHz = filterEnvelopePeakHz(cutoff, p.filterEnvAmount!, ctx.sampleRate);
    filter.frequency.setValueAtTime(peakHz, onTime);
    filter.frequency.setTargetAtTime(
      cutoff,
      onTime,
      Math.max(0.001, p.filterDecay! / DECAY_TIME_CONSTANT_DIVISOR),
    );

    const shape: AdsrShape = { attack: p.attack!, decay: p.decay!, sustain: p.sustain! };
    const peak = velocityToGain(velocity) * SYNTH_VOICE_LEVEL;
    const voice = new SynthVoice(
      this.nextId++,
      pitch,
      onTime,
      transport,
      clipId,
      osc1,
      osc2,
      g1,
      g2,
      filter,
      amp,
      peak,
      shape,
      p.release!,
    );
    const gain = amp.gain;
    gain.setValueAtTime(0, onTime);
    // Each ramp end is re-anchored with setValueAtTime: a setTarget that follows a ramp
    // otherwise takes its start value from the last rendered frame when the boundary
    // falls between samples (Chromium), making identical notes differ by up to one
    // ramp step depending on their absolute time.
    if (offTime !== null && offTime < onTime + shape.attack) {
      const level = peak * adsrLevelAt(shape, offTime - onTime);
      gain.linearRampToValueAtTime(level, offTime);
      gain.setValueAtTime(level, offTime);
    } else {
      const attackEnd = onTime + shape.attack;
      gain.linearRampToValueAtTime(peak, attackEnd);
      gain.setValueAtTime(peak, attackEnd);
      gain.setTargetAtTime(
        peak * shape.sustain,
        attackEnd,
        Math.max(1e-4, shape.decay / DECAY_TIME_CONSTANT_DIVISOR),
      );
    }
    osc1.start(onTime);
    osc2.start(onTime);
    osc1.onended = () => this.cleanup(voice);
    this.voices.add(voice);
    if (offTime !== null) this.scheduleRelease(voice, Math.max(offTime, onTime), false);
    return voice;
  }

  /** Mono legato: keep the voice, glide to the new pitch, move its release. */
  private legato(
    voice: SynthVoice,
    pitch: number,
    velocity: number,
    onTime: number,
    offTime: number | null,
    glide: number,
  ): void {
    const p = this.params;
    holdParam(voice.amp.gain, onTime, voice.levelAt(onTime), onTime < voice.attackEnd);
    const peak = velocityToGain(velocity) * SYNTH_VOICE_LEVEL;
    voice.amp.gain.setTargetAtTime(peak * p.sustain!, onTime, 0.02);
    const frequency = midiToFrequency(pitch);
    const octave = Math.pow(2, Math.round(p.osc2Octave!));
    for (const [osc, ratio] of [
      [voice.osc1, 1],
      [voice.osc2, octave],
    ] as const) {
      holdParam(osc.frequency, onTime, midiToFrequency(voice.pitch) * ratio, false);
      if (glide > 0) osc.frequency.exponentialRampToValueAtTime(frequency * ratio, onTime + glide);
      else osc.frequency.setValueAtTime(frequency * ratio, onTime);
    }
    voice.pitch = pitch;
    voice.releaseStart = null;
    voice.endTime = Number.POSITIVE_INFINITY;
    this.lastPitch = pitch;
    // Push the stop time out of the way until a new release is scheduled.
    if (offTime !== null) this.scheduleRelease(voice, Math.max(offTime, onTime), false);
    else {
      safeStop(voice.osc1, Number.MAX_SAFE_INTEGER / 1e6);
      safeStop(voice.osc2, Number.MAX_SAFE_INTEGER / 1e6);
    }
  }

  /** Release phase from `time` (hold first when the envelope may still be moving). */
  private scheduleRelease(voice: SynthVoice, time: number, hold: boolean): void {
    if (hold) holdParam(voice.amp.gain, time, voice.levelAt(time), time < voice.attackEnd);
    voice.releaseStart = time;
    voice.release = this.params.release!;
    voice.amp.gain.setTargetAtTime(0, time, releaseTimeConstant(voice.release));
    voice.endTime = time + voice.release + VOICE_STOP_MARGIN_SECONDS;
    safeStop(voice.osc1, voice.endTime);
    safeStop(voice.osc2, voice.endTime);
  }

  private releaseVoice(voice: SynthVoice, time: number): void {
    if (voice.ended || (voice.releaseStart !== null && voice.releaseStart <= time)) return;
    this.scheduleRelease(voice, Math.max(time, voice.startTime), true);
  }

  /** Fast linear fade to silence starting at `time` (steal / stop). */
  private fadeOut(voice: SynthVoice, time: number, seconds: number): void {
    if (voice.ended || voice.endTime <= time) return;
    if (voice.startTime >= time) {
      this.cleanup(voice);
      return;
    }
    holdParam(voice.amp.gain, time, voice.levelAt(time), time < voice.attackEnd);
    voice.amp.gain.linearRampToValueAtTime(0, time + seconds);
    voice.releaseStart = time;
    voice.endTime = time + seconds + 0.002;
    safeStop(voice.osc1, voice.endTime);
    safeStop(voice.osc2, voice.endTime);
  }

  cancelTransport(requested: number, options: CancelOptions = {}): void {
    // Automation can only change from the next rendered frame on.
    const time = Math.max(requested, this.g.ctx.currentTime);
    for (const voice of [...this.voices]) {
      if (!voice.transport || voice.ended) continue;
      if (options.clipIds && (voice.clipId === undefined || !options.clipIds.has(voice.clipId)))
        continue;
      if (voice.startTime >= time) this.cleanup(voice);
      else if (!options.onlyUnstarted) this.fadeOut(voice, time, STOP_FADE_SECONDS);
    }
  }

  private cleanup(voice: SynthVoice): void {
    if (voice.ended) return;
    voice.ended = true;
    safeStop(voice.osc1, 0);
    safeStop(voice.osc2, 0);
    for (const osc of [voice.osc1, voice.osc2]) {
      safeDisconnect(this.bend, osc.detune);
      safeDisconnect(this.vibrato, osc.detune);
      safeDisconnect(osc);
    }
    for (const node of [voice.g1, voice.g2, voice.filter, voice.amp]) safeDisconnect(node);
    voice.osc1.onended = null;
    this.voices.delete(voice);
    for (const [pitch, v] of this.live) if (v === voice) this.live.delete(pitch);
  }

  update(config: InstrumentConfig): void {
    const ctx = this.g.ctx;
    const p = sanitizeParamValues(INSTRUMENT_PARAM_SPECS.synth, config.params);
    this.params = p;
    setParam(this.output.gain, dbToGain(p.gainDb!), ctx, false);
    const mix = Math.min(1, Math.max(0, p.osc2Mix!));
    const cutoff = Math.min(p.cutoffHz!, 0.45 * ctx.sampleRate);
    const octave = Math.pow(2, Math.round(p.osc2Octave!));
    for (const voice of this.voices) {
      if (voice.ended) continue;
      voice.osc1.type = waveform(p.osc1Waveform!);
      voice.osc2.type = waveform(p.osc2Waveform!);
      setParam(voice.osc2.detune, p.osc2Detune!, ctx, false);
      setParam(voice.osc2.frequency, midiToFrequency(voice.pitch) * octave, ctx, false);
      setParam(voice.g1.gain, 1 - mix, ctx, false);
      setParam(voice.g2.gain, mix, ctx, false);
      setParam(voice.filter.frequency, cutoff, ctx, false);
      setParam(voice.filter.Q, resonanceToQDb(p.resonance!), ctx, false);
    }
  }

  activeVoiceCount(): number {
    return this.voices.size;
  }

  dispose(): void {
    for (const voice of [...this.voices]) this.cleanup(voice);
    safeStop(this.bend, 0);
    safeStop(this.lfo, 0);
    for (const node of [this.bend, this.lfo, this.vibrato, this.output]) safeDisconnect(node);
  }
}
