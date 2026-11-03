/**
 * The sounds behind the playable MPK mini on the landing page: a soft two-oscillator synth for
 * the keys and a small synthesised drum kit for the pads. The AudioContext is created on the
 * first press (a user gesture), so the page stays silent until someone plays it.
 */

type DrumKind = 'kick' | 'snare' | 'hat' | 'clap' | 'tom' | 'rim' | 'openHat' | 'perc';

/** Pads 1–4 (bottom row) are the core kit, 5–8 the extras, as on a typical drum layout. */
const PAD_KIT: readonly DrumKind[] = [
  'kick',
  'snare',
  'hat',
  'clap',
  'tom',
  'rim',
  'openHat',
  'perc',
];

/** `key.0` is C3. */
const LOWEST_NOTE = 48;

const midiToHz = (note: number) => 440 * 2 ** ((note - 69) / 12);

export class MpkVoices {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly held = new Map<string, () => void>();

  private context(): { ctx: AudioContext; out: GainNode } | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const out = ctx.createGain();
      out.gain.value = 0.32;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      out.connect(limiter).connect(ctx.destination);
      this.ctx = ctx;
      this.out = out;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.out ? { ctx: this.ctx, out: this.out } : null;
  }

  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /** Starts the sound for a key (`key.N`) or pad (`pad.N`); keys sustain until `release`. */
  press(layoutId: string): void {
    const audio = this.context();
    if (!audio) return;
    this.release(layoutId);
    const [kind, index] = layoutId.split('.');
    const n = Number(index);
    if (kind === 'key') this.held.set(layoutId, this.key(audio.ctx, audio.out, LOWEST_NOTE + n));
    else if (kind === 'pad') this.drum(audio.ctx, audio.out, PAD_KIT[(n - 1) % PAD_KIT.length]!);
  }

  release(layoutId: string): void {
    this.held.get(layoutId)?.();
    this.held.delete(layoutId);
  }

  dispose(): void {
    for (const stop of this.held.values()) stop();
    this.held.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.out = null;
  }

  private key(ctx: AudioContext, out: AudioNode, note: number): () => void {
    const t = ctx.currentTime;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.5, t + 0.008);
    env.gain.setTargetAtTime(0.32, t + 0.008, 0.25);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(5200, t);
    filter.frequency.setTargetAtTime(1800, t, 0.18);
    filter.connect(env).connect(out);
    const oscs = [-6, 6].map((cents) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiToHz(note);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      return osc;
    });
    return () => {
      const end = ctx.currentTime;
      env.gain.cancelScheduledValues(end);
      env.gain.setValueAtTime(env.gain.value, end);
      env.gain.setTargetAtTime(0, end, 0.08);
      for (const osc of oscs) osc.stop(end + 0.6);
    };
  }

  private drum(ctx: AudioContext, out: AudioNode, kind: DrumKind): void {
    const t = ctx.currentTime;
    const amp = (peak: number, decay: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      g.connect(out);
      return g;
    };
    const tone = (from: number, to: number, decay: number, peak: number, type: OscillatorType) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
      osc.connect(amp(peak, decay));
      osc.start(t);
      osc.stop(t + decay + 0.05);
    };
    const noise = (type: BiquadFilterType, freq: number, decay: number, peak: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      src.connect(filter).connect(amp(peak, decay));
      src.start(t);
      src.stop(t + decay + 0.05);
    };
    switch (kind) {
      case 'kick':
        tone(150, 45, 0.45, 1.2, 'sine');
        break;
      case 'snare':
        tone(220, 160, 0.12, 0.5, 'triangle');
        noise('bandpass', 2400, 0.2, 0.8);
        break;
      case 'hat':
        noise('highpass', 8000, 0.05, 0.45);
        break;
      case 'openHat':
        noise('highpass', 7000, 0.35, 0.35);
        break;
      case 'clap':
        noise('bandpass', 1500, 0.25, 0.9);
        break;
      case 'tom':
        tone(180, 90, 0.35, 0.8, 'sine');
        break;
      case 'rim':
        tone(1700, 1500, 0.04, 0.45, 'square');
        break;
      case 'perc':
        tone(800, 760, 0.18, 0.4, 'triangle');
        break;
    }
  }
}
