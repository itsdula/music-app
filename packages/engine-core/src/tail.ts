/**
 * Render tail estimation: how long sound continues after the last event stops.
 */
import {
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  sanitizeParamValues,
  type EffectSlot,
  type InstrumentConfig,
  type MasterBus,
  type Track,
} from '@studio/domain';
import { resolveTrackGates } from './mix';

/** Upper bound for `tailSeconds: 'auto'`. */
export const DEFAULT_MAX_TAIL_SECONDS = 12;
/** Echoes are counted until they fall below −60 dB. */
const ECHO_FLOOR = 0.001;
/** DynamicsCompressor lookahead (Chromium: 6 ms) plus margin. */
const COMPRESSOR_TAIL_SECONDS = 0.01;
/** Margin after a synth/sampler release before voices are stopped. */
export const VOICE_STOP_MARGIN_SECONDS = 0.02;
/**
 * Longest drum voice at decayScale 1: the crash (τ = 0.85 s, rendered for 6.9·τ + 5 ms,
 * see `synthesizeDrumVoice` in @studio/audio-dsp). Voices are capped at 8 s.
 */
export const DRUM_KIT_TAIL_SECONDS = 0.85 * 6.9 + 0.005;
const DRUM_VOICE_MAX_SECONDS = 8;

/**
 * Tail added by one effect (0 when bypassed): reverb = decay + pre-delay; delay =
 * time · number of echoes until −60 dB (`ceil(ln 0.001 / ln feedback)`, at least one);
 * compressor = lookahead; gain/EQ/distortion = 0.
 * Units: seconds. O(params).
 */
export function effectTailSeconds(slot: EffectSlot): number {
  if (slot.bypass) return 0;
  const p = sanitizeParamValues(EFFECT_PARAM_SPECS[slot.kind], slot.params);
  switch (slot.kind) {
    case 'reverb':
      return p.decaySeconds! + p.preDelayMs! / 1000;
    case 'delay': {
      const feedback = p.feedback!;
      const repeats =
        feedback > 0 ? Math.max(1, Math.ceil(Math.log(ECHO_FLOOR) / Math.log(feedback))) : 1;
      return (p.timeMs! / 1000) * repeats;
    }
    case 'compressor':
      return COMPRESSOR_TAIL_SECONDS;
    default:
      return 0;
  }
}

/**
 * Sound an instrument produces after its last note-off: synth/sampler release (+ stop
 * margin), the longest drum voice scaled by decayScale (≤ 8 s). One-shot sampler notes
 * play their whole sample; pass `sampleSeconds` to include it. Units: seconds. O(1).
 */
export function instrumentTailSeconds(
  config: InstrumentConfig | undefined,
  options: { readonly sampleSeconds?: number } = {},
): number {
  if (!config) return 0;
  const p = sanitizeParamValues(INSTRUMENT_PARAM_SPECS[config.kind], config.params);
  switch (config.kind) {
    case 'synth':
      return p.release! + VOICE_STOP_MARGIN_SECONDS;
    case 'sampler': {
      const release = p.release! + VOICE_STOP_MARGIN_SECONDS;
      return p.oneShot! >= 0.5 ? Math.max(release, options.sampleSeconds ?? 0) : release;
    }
    case 'drums':
      return Math.min(DRUM_VOICE_MAX_SECONDS, DRUM_KIT_TAIL_SECONDS * p.decayScale!);
  }
}

/** Instrument tail plus the serial sum of its effect tails. Seconds. O(effects). */
export function trackTailSeconds(track: Track): number {
  let tail = instrumentTailSeconds(track.instrument);
  for (const slot of track.effects) tail += effectTailSeconds(slot);
  return tail;
}

/**
 * Estimated render tail for a mix: the longest tail among audible tracks (mute/solo
 * resolved) plus the master chain's effect tails, clamped to [0, maxSeconds].
 * Deterministic; O(tracks · effects).
 */
export function estimateTailSeconds(
  mix: { readonly tracks: readonly Track[]; readonly master: MasterBus },
  options: { readonly maxSeconds?: number } = {},
): number {
  const max = options.maxSeconds ?? DEFAULT_MAX_TAIL_SECONDS;
  const gates = resolveTrackGates(mix.tracks);
  let longest = 0;
  for (const track of mix.tracks) {
    if (gates.get(track.id) === 0) continue;
    longest = Math.max(longest, trackTailSeconds(track));
  }
  let master = 0;
  for (const slot of mix.master.effects) master += effectTailSeconds(slot);
  return Math.min(max, Math.max(0, longest + master));
}
