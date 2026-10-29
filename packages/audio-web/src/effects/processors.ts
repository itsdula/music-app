/**
 * Processor sections of the six effect kinds (see EFFECT_PARAM_SPECS for ranges).
 */
import { dbToGain, generateReverbImpulse, makeDistortionCurve } from '@studio/audio-dsp';
import type { EffectId, EffectKind } from '@studio/domain';
import { REVERB_IR_DEBOUNCE_MS, REVERB_SWAP_SECONDS } from '../constants';
import type { GraphContext } from '../graph/graph-context';
import { hashString, rampParam, safeDisconnect, setParam } from '../util/audio-params';
import { LruCache } from '../util/lru';
import {
  equalPowerMix,
  type EffectParams,
  type EffectProcessor,
  type EffectProcessorFactory,
} from './effect-unit';

const p = (params: EffectParams, id: string): number => params[id] ?? 0;

/** gain: a single smoothed GainNode (gainDb −60..24; −60 is not treated as silence here). */
function createGain(g: GraphContext): EffectProcessor {
  const node = new GainNode(g.ctx);
  return {
    input: node,
    output: node,
    update(params, immediate) {
      setParam(node.gain, dbToGain(p(params, 'gainDb')), g.ctx, immediate);
    },
    dispose() {
      safeDisconnect(node);
    },
  };
}

/** eq3: low shelf → peaking (Q = midQ) → high shelf. */
function createEq3(g: GraphContext): EffectProcessor {
  const ctx = g.ctx;
  const low = new BiquadFilterNode(ctx, { type: 'lowshelf' });
  const mid = new BiquadFilterNode(ctx, { type: 'peaking' });
  const high = new BiquadFilterNode(ctx, { type: 'highshelf' });
  low.connect(mid).connect(high);
  return {
    input: low,
    output: high,
    update(params, immediate) {
      setParam(low.frequency, p(params, 'lowFreq'), ctx, immediate);
      setParam(low.gain, p(params, 'lowGainDb'), ctx, immediate);
      setParam(mid.frequency, p(params, 'midFreq'), ctx, immediate);
      setParam(mid.Q, p(params, 'midQ'), ctx, immediate);
      setParam(mid.gain, p(params, 'midGainDb'), ctx, immediate);
      setParam(high.frequency, p(params, 'highFreq'), ctx, immediate);
      setParam(high.gain, p(params, 'highGainDb'), ctx, immediate);
    },
    dispose() {
      for (const n of [low, mid, high]) safeDisconnect(n);
    },
  };
}

/**
 * compressor: DynamicsCompressorNode + makeup gain. Note that the browser compressor
 * has a fixed ~6 ms lookahead and (in Chromium) its own automatic makeup stage; the
 * `makeupDb` parameter is applied on top.
 */
function createCompressor(g: GraphContext): EffectProcessor {
  const ctx = g.ctx;
  const comp = new DynamicsCompressorNode(ctx);
  const makeup = new GainNode(ctx);
  comp.connect(makeup);
  return {
    input: comp,
    output: makeup,
    update(params, immediate) {
      setParam(comp.threshold, p(params, 'thresholdDb'), ctx, immediate);
      setParam(comp.ratio, p(params, 'ratio'), ctx, immediate);
      setParam(comp.attack, p(params, 'attackMs') / 1000, ctx, immediate);
      setParam(comp.release, p(params, 'releaseMs') / 1000, ctx, immediate);
      setParam(comp.knee, p(params, 'kneeDb'), ctx, immediate);
      setParam(makeup.gain, dbToGain(p(params, 'makeupDb')), ctx, immediate);
    },
    dispose() {
      safeDisconnect(comp);
      safeDisconnect(makeup);
    },
  };
}

const impulseCache = new LruCache<AudioBuffer>(16);

/** Cached (deterministic, read-only) stereo impulse response as an AudioBuffer. */
function reverbImpulseBuffer(
  sampleRate: number,
  decay: number,
  damping: number,
  seed: number,
): AudioBuffer {
  return impulseCache.getOrCreate(`${sampleRate}|${decay}|${damping}|${seed}`, () => {
    const impulse = generateReverbImpulse(sampleRate, decay, damping, seed);
    const buffer = new AudioBuffer({
      length: impulse.channels[0]!.length,
      numberOfChannels: 2,
      sampleRate,
    });
    impulse.channels.forEach((ch, c) => buffer.getChannelData(c).set(ch));
    return buffer;
  });
}

/**
 * reverb: pre-delay → convolver (seeded synthetic IR, unit energy per channel) with an
 * equal-power dry/wet mix. Decay/damping changes regenerate the IR (debounced in
 * realtime) and crossfade from the old convolver to the new one.
 */
function createReverb(g: GraphContext, id: EffectId): EffectProcessor {
  const ctx = g.ctx;
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const wet = new GainNode(ctx);
  const preDelay = new DelayNode(ctx, { maxDelayTime: 0.25 });
  input.connect(dry).connect(output);
  input.connect(preDelay);
  wet.connect(output);
  const seed = hashString(id);
  let current: { convolver: ConvolverNode; gain: GainNode } | null = null;
  let irKey = '';
  const owner = {};

  const install = (decay: number, damping: number, immediate: boolean) => {
    const buffer = reverbImpulseBuffer(ctx.sampleRate, decay, damping, seed);
    const convolver = new ConvolverNode(ctx, { disableNormalization: true });
    convolver.buffer = buffer;
    const gain = new GainNode(ctx, { gain: immediate ? 1 : 0 });
    preDelay.connect(convolver).connect(gain).connect(wet);
    const previous = current;
    current = { convolver, gain };
    if (!immediate) rampParam(gain.gain, 1, ctx, REVERB_SWAP_SECONDS);
    if (previous) {
      if (immediate) {
        safeDisconnect(previous.convolver);
        safeDisconnect(previous.gain);
      } else {
        rampParam(previous.gain.gain, 0, ctx, REVERB_SWAP_SECONDS);
        g.defer(previous, REVERB_SWAP_SECONDS * 1000 + 50, () => {
          safeDisconnect(previous.convolver);
          safeDisconnect(previous.gain);
        });
      }
    }
  };

  return {
    input,
    output,
    update(params, immediate) {
      const decay = p(params, 'decaySeconds');
      const damping = p(params, 'dampingHz');
      const key = `${decay}|${damping}`;
      if (key !== irKey) {
        irKey = key;
        if (immediate || !current) install(decay, damping, true);
        else g.defer(owner, REVERB_IR_DEBOUNCE_MS, () => install(decay, damping, false));
      }
      setParam(preDelay.delayTime, p(params, 'preDelayMs') / 1000, ctx, immediate);
      const mix = equalPowerMix(p(params, 'mix'));
      setParam(dry.gain, mix.dry, ctx, immediate);
      setParam(wet.gain, mix.wet, ctx, immediate);
    },
    dispose() {
      g.cancelDeferred(owner);
      for (const n of [input, output, dry, wet, preDelay]) safeDisconnect(n);
      if (current) {
        safeDisconnect(current.convolver);
        safeDisconnect(current.gain);
      }
    },
  };
}

/**
 * delay: feedback delay line with a lowpass tone filter inside the loop
 * (input → delay → tone → wet; tone → feedback → delay) and an equal-power mix.
 * Time changes glide (tape-like pitch bend instead of clicks).
 */
function createDelay(g: GraphContext): EffectProcessor {
  const ctx = g.ctx;
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const wet = new GainNode(ctx);
  const delay = new DelayNode(ctx, { maxDelayTime: 2.5 });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0 });
  const feedback = new GainNode(ctx);
  input.connect(dry).connect(output);
  input.connect(delay).connect(tone).connect(wet).connect(output);
  tone.connect(feedback).connect(delay);
  return {
    input,
    output,
    update(params, immediate) {
      setParam(delay.delayTime, p(params, 'timeMs') / 1000, ctx, immediate, 0.05);
      setParam(feedback.gain, Math.min(0.95, p(params, 'feedback')), ctx, immediate);
      setParam(tone.frequency, p(params, 'toneHz'), ctx, immediate);
      const mix = equalPowerMix(p(params, 'mix'));
      setParam(dry.gain, mix.dry, ctx, immediate);
      setParam(wet.gain, mix.wet, ctx, immediate);
    },
    dispose() {
      for (const n of [input, output, dry, wet, delay, tone, feedback]) safeDisconnect(n);
    },
  };
}

/** Distortion curve shape (fixed): tanh with k = 5.75; drive is applied as input gain. */
const SHAPER_CURVE_DRIVE = 0.25;
const SHAPER_SLOPE = (1 + 19 * SHAPER_CURVE_DRIVE) / Math.tanh(1 + 19 * SHAPER_CURVE_DRIVE);
/** Signals up to ±8 map onto the curve's [−1, 1] domain (beyond: hard clip). */
const SHAPER_INPUT_RANGE = 8;
const DRIVE_MAX_DB = 36;
const DRIVE_COMPENSATION_DB = 12;

/**
 * distortion: drive (0..36 dB input gain into a fixed 4×-oversampled tanh curve, with
 * partial level compensation of −12 dB at full drive) → tone lowpass → equal-power mix
 * → output gain. Driving the input gain instead of regenerating the curve keeps drive
 * changes smooth (no curve swaps).
 */
function createDistortion(g: GraphContext): EffectProcessor {
  const ctx = g.ctx;
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const wet = new GainNode(ctx);
  const pre = new GainNode(ctx);
  const shaper = new WaveShaperNode(ctx, { oversample: '4x' });
  shaper.curve = makeDistortionCurve(SHAPER_CURVE_DRIVE, 4097);
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass', Q: 0 });
  const post = new GainNode(ctx);
  input.connect(dry).connect(output);
  input.connect(pre).connect(shaper).connect(tone).connect(post).connect(wet).connect(output);
  const outputGain = new GainNode(ctx);
  output.connect(outputGain);
  return {
    input,
    output: outputGain,
    update(params, immediate) {
      const drive = Math.min(1, Math.max(0, p(params, 'drive')));
      setParam(pre.gain, dbToGain(drive * DRIVE_MAX_DB) / SHAPER_INPUT_RANGE, ctx, immediate);
      setParam(
        post.gain,
        (SHAPER_INPUT_RANGE / SHAPER_SLOPE) * dbToGain(-drive * DRIVE_COMPENSATION_DB),
        ctx,
        immediate,
      );
      setParam(tone.frequency, p(params, 'toneHz'), ctx, immediate);
      const mix = equalPowerMix(p(params, 'mix'));
      setParam(dry.gain, mix.dry, ctx, immediate);
      setParam(wet.gain, mix.wet, ctx, immediate);
      setParam(outputGain.gain, dbToGain(p(params, 'outputDb')), ctx, immediate);
    },
    dispose() {
      for (const n of [input, output, dry, wet, pre, shaper, tone, post, outputGain])
        safeDisconnect(n);
    },
  };
}

export const EFFECT_PROCESSORS: Readonly<Record<EffectKind, EffectProcessorFactory>> = {
  gain: createGain,
  eq3: createEq3,
  compressor: createCompressor,
  reverb: createReverb,
  delay: createDelay,
  distortion: createDistortion,
};
