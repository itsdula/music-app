/**
 * Original drum-voice synthesis (no third-party samples or patch data).
 *
 * Every voice is rendered offline into a mono float buffer from oscillators, seeded
 * noise, envelopes and simple filters, so a kit can be pre-rendered once per context
 * sample rate and played as one-shot buffers. Output is fully deterministic for a given
 * (kind, sampleRate, params) — including the noise, which is drawn from
 * `createSeededRandom(deriveSeed(seed, kindIndex))`.
 *
 * Parameters (all optional):
 * - `tuneSemitones` (−12..12): scales every oscillator frequency and filter centre that
 *   defines the voice's pitch by 2^(tune/12) while keeping its length.
 * - `decayScale` (0.25..4): multiplies every decay time constant (and the length).
 * - `tone` (0..1): brightness — pitch-sweep depth, noise share and filter cutoffs.
 * - `seed`: noise seed (default 1).
 */
import { applyBiquad, biquadCoefficients, onePoleCoefficient } from './filters';
import { createSeededRandom, deriveSeed } from './random';

export type DrumVoiceKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'closedHat'
  | 'openHat'
  | 'lowTom'
  | 'midTom'
  | 'highTom'
  | 'rim'
  | 'cowbell'
  | 'crash';

export const DRUM_VOICE_KINDS: readonly DrumVoiceKind[] = [
  'kick',
  'snare',
  'clap',
  'closedHat',
  'openHat',
  'lowTom',
  'midTom',
  'highTom',
  'rim',
  'cowbell',
  'crash',
];

export interface DrumVoiceParams {
  readonly tuneSemitones?: number;
  readonly decayScale?: number;
  readonly tone?: number;
  readonly seed?: number;
}

/** General MIDI percussion notes (channel 10 convention) mapped to kit voices. */
export const GM_DRUM_MAP: Readonly<Record<number, DrumVoiceKind>> = {
  35: 'kick',
  36: 'kick',
  37: 'rim',
  38: 'snare',
  39: 'clap',
  40: 'snare',
  41: 'lowTom',
  42: 'closedHat',
  43: 'lowTom',
  44: 'closedHat',
  45: 'midTom',
  46: 'openHat',
  47: 'midTom',
  48: 'highTom',
  49: 'crash',
  50: 'highTom',
  56: 'cowbell',
  57: 'crash',
};

/** Kit voice for a MIDI note, or undefined when the note is not mapped. O(1). */
export function drumKindForNote(note: number): DrumVoiceKind | undefined {
  return GM_DRUM_MAP[note];
}

/** Notes whose onset chokes (silences) a sounding open hi-hat. */
export const HAT_CHOKE_NOTES: readonly number[] = [42, 44, 46];

const MAX_VOICE_SECONDS = 8;
/** Metallic partials (Hz) shared by hats/cowbell/crash, inharmonic by design. */
const METAL_PARTIALS = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

interface VoiceContext {
  readonly sr: number;
  readonly tune: number;
  readonly decay: number;
  readonly tone: number;
  readonly noise: () => number;
}

/**
 * Renders one drum voice.
 *
 * - Units: `sampleRate` in Hz; output samples peak-normalized to a per-kind level in
 *   (0, 1) and faded to exactly 0 at the end.
 * - Determinism: bit-exact for identical inputs on IEEE-754 engines using the same
 *   `Math.sin`/`Math.exp` (golden fixtures should compare with ~1e-6 tolerance when
 *   ported, since libm implementations differ in the last ulp).
 * - Ownership: returns a new buffer owned by the caller.
 * - Complexity: O(length) where length ≈ 6.9 · longest decay constant · sampleRate,
 *   capped at 8 s.
 */
export function synthesizeDrumVoice(
  kind: DrumVoiceKind,
  sampleRate: number,
  params: DrumVoiceParams = {},
): Float32Array<ArrayBuffer> {
  const kindIndex = DRUM_VOICE_KINDS.indexOf(kind);
  if (kindIndex < 0) throw new Error(`synthesizeDrumVoice: unknown kind ${String(kind)}`);
  const ctx: VoiceContext = {
    sr: sampleRate,
    tune: Math.pow(2, clamp(params.tuneSemitones ?? 0, -24, 24) / 12),
    decay: clamp(params.decayScale ?? 1, 0.05, 8),
    tone: clamp(params.tone ?? 0.5, 0, 1),
    noise: whiteNoise(createSeededRandom(deriveSeed(params.seed ?? 1, kindIndex))),
  };
  let out: Float32Array<ArrayBuffer>;
  let level: number;
  switch (kind) {
    case 'kick':
      out = kick(ctx);
      level = 0.95;
      break;
    case 'snare':
      out = snare(ctx);
      level = 0.85;
      break;
    case 'clap':
      out = clap(ctx);
      level = 0.8;
      break;
    case 'closedHat':
      out = hat(ctx, 0.022);
      level = 0.55;
      break;
    case 'openHat':
      out = hat(ctx, 0.2);
      level = 0.55;
      break;
    case 'lowTom':
      out = tom(ctx, 95, 0.22);
      level = 0.85;
      break;
    case 'midTom':
      out = tom(ctx, 135, 0.19);
      level = 0.85;
      break;
    case 'highTom':
      out = tom(ctx, 185, 0.16);
      level = 0.85;
      break;
    case 'rim':
      out = rim(ctx);
      level = 0.7;
      break;
    case 'cowbell':
      out = cowbell(ctx);
      level = 0.65;
      break;
    case 'crash':
      out = crash(ctx);
      level = 0.6;
      break;
  }
  finish(out, sampleRate, level);
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

function whiteNoise(random: () => number): () => number {
  return () => random() * 2 - 1;
}

function allocate(
  ctx: VoiceContext,
  longestTau: number,
  extraSeconds = 0.005,
): Float32Array<ArrayBuffer> {
  const seconds = Math.min(MAX_VOICE_SECONDS, longestTau * 6.9 + extraSeconds);
  return new Float32Array(Math.max(16, Math.ceil(seconds * ctx.sr)));
}

/** Peak-normalizes to `level` and applies a 2 ms linear fade-out ending at zero. */
function finish(out: Float32Array, sampleRate: number, level: number): void {
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]!));
  const gain = peak > 0 ? level / peak : 0;
  const fade = Math.min(out.length, Math.ceil(0.002 * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const fromEnd = out.length - 1 - i;
    const f = fromEnd < fade ? fromEnd / fade : 1;
    out[i] = fromEnd === 0 ? 0 : out[i]! * gain * f;
  }
}

function kick(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tauAmp = 0.16 * c.decay;
  const out = allocate(c, tauAmp);
  const base = (45 + 10 * c.tone) * c.tune;
  const sweep = (110 + 150 * c.tone) * c.tune;
  const clickLevel = 0.15 + 0.35 * c.tone;
  const lp = onePoleCoefficient(c.sr, 2500 + 6000 * c.tone);
  let phase = 0;
  let click = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    phase += (2 * Math.PI * (base + sweep * Math.exp(-t / 0.035))) / c.sr;
    const body = Math.tanh(1.6 * Math.sin(phase)) * Math.exp(-t / tauAmp);
    click = (1 - lp) * c.noise() + lp * click;
    out[i] = body + click * clickLevel * Math.exp(-t / 0.003);
  }
  return out;
}

function snare(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tauBody = 0.06 * c.decay;
  const tauNoise = 0.1 * c.decay * (0.8 + 0.4 * c.tone);
  const out = allocate(c, Math.max(tauBody, tauNoise));
  const noise = new Float32Array(out.length);
  for (let i = 0; i < noise.length; i++) noise[i] = c.noise();
  applyBiquad(noise, biquadCoefficients('highpass', c.sr, 1200 + 2500 * c.tone, 0.7));
  const bodyGain = 0.55 - 0.25 * c.tone;
  const noiseGain = 0.45 + 0.35 * c.tone;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const drop = 1 + 0.12 * Math.exp(-t / 0.01);
    p1 += (2 * Math.PI * 180 * c.tune * drop) / c.sr;
    p2 += (2 * Math.PI * 330 * c.tune * drop) / c.sr;
    const body = (0.6 * Math.sin(p1) + 0.4 * Math.sin(p2)) * Math.exp(-t / tauBody);
    out[i] = bodyGain * body + noiseGain * noise[i]! * Math.exp(-t / tauNoise);
  }
  return out;
}

function clap(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tauTail = 0.11 * c.decay;
  const burstTimes = [0, 0.011, 0.022, 0.033];
  const tailStart = burstTimes[burstTimes.length - 1]!;
  const out = allocate(c, tauTail, tailStart + 0.005);
  for (let i = 0; i < out.length; i++) out[i] = c.noise();
  applyBiquad(out, biquadCoefficients('bandpass', c.sr, (900 + 900 * c.tone) * c.tune, 1.4));
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    let env = 0;
    for (const start of burstTimes) {
      if (t >= start) env = Math.max(env, Math.exp(-(t - start) / 0.004));
    }
    if (t >= tailStart) env = Math.max(env, 0.7 * Math.exp(-(t - tailStart) / tauTail));
    out[i] = out[i]! * env;
  }
  return out;
}

/** Square-wave cluster of inharmonic partials (phase accumulators, no trig). */
function metal(
  c: VoiceContext,
  out: Float32Array,
  partials: readonly number[],
  scale: number,
): void {
  const phases = new Float64Array(partials.length);
  const increments = partials.map((f) => (f * scale * c.tune) / c.sr);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < phases.length; k++) {
      phases[k] = (phases[k]! + increments[k]!) % 1;
      sum += phases[k]! < 0.5 ? 1 : -1;
    }
    out[i] = sum / phases.length;
  }
}

function hat(c: VoiceContext, tauSeconds: number): Float32Array<ArrayBuffer> {
  const tau = tauSeconds * c.decay;
  const out = allocate(c, tau);
  metal(c, out, METAL_PARTIALS, 1);
  for (let i = 0; i < out.length; i++) out[i] = 0.6 * out[i]! + 0.5 * c.noise();
  const hp = biquadCoefficients('highpass', c.sr, (6000 + 3000 * c.tone) * Math.sqrt(c.tune), 0.7);
  applyBiquad(out, hp);
  applyBiquad(out, hp);
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const attack = Math.min(1, t / 0.0005);
    out[i] = out[i]! * attack * Math.exp(-t / tau);
  }
  return out;
}

function tom(c: VoiceContext, baseHz: number, tauSeconds: number): Float32Array<ArrayBuffer> {
  const tau = tauSeconds * c.decay;
  const out = allocate(c, tau);
  const base = baseHz * c.tune;
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const f = base * (1 + (0.35 + 0.3 * c.tone) * Math.exp(-t / 0.05));
    phase += (2 * Math.PI * f) / c.sr;
    phase2 += (2 * Math.PI * f * 1.5) / c.sr;
    const env = Math.exp(-t / tau);
    const partial = 0.2 * c.tone * Math.sin(phase2) * Math.exp(-t / (tau * 0.5));
    out[i] = (Math.sin(phase) + partial) * env + 0.1 * c.noise() * Math.exp(-t / 0.008);
  }
  return out;
}

function rim(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tau = 0.008 * c.decay;
  const out = allocate(c, tau * 1.5);
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const ping =
      Math.sin(2 * Math.PI * 1700 * c.tune * t) * Math.exp(-t / tau) +
      0.6 * Math.sin(2 * Math.PI * 480 * c.tune * t) * Math.exp(-t / (tau * 1.5));
    out[i] = ping + (0.2 + 0.4 * c.tone) * c.noise() * Math.exp(-t / 0.002);
  }
  return out;
}

function cowbell(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tauLong = 0.18 * c.decay;
  const out = allocate(c, tauLong);
  metal(c, out, [560, 835], 1);
  applyBiquad(out, biquadCoefficients('bandpass', c.sr, (900 + 900 * c.tone) * c.tune, 0.9));
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const env = 0.6 * Math.exp(-t / (0.012 * c.decay)) + 0.4 * Math.exp(-t / tauLong);
    out[i] = out[i]! * env;
  }
  return out;
}

function crash(c: VoiceContext): Float32Array<ArrayBuffer> {
  const tau = 0.85 * c.decay;
  const out = allocate(c, tau);
  metal(c, out, METAL_PARTIALS, 1.7);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * out[i]! + c.noise();
  applyBiquad(
    out,
    biquadCoefficients('highpass', c.sr, (3500 + 3000 * c.tone) * Math.sqrt(c.tune), 0.7),
  );
  for (let i = 0; i < out.length; i++) {
    const t = i / c.sr;
    const attack = Math.min(1, t / 0.001);
    out[i] = out[i]! * attack * Math.exp(-t / tau);
  }
  return out;
}
