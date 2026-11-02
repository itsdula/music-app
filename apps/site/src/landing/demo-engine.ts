/**
 * A tiny bass-line synth for the landing page's "try it" strip: a 16-step pattern of saw
 * notes through one resonant low-pass filter. It exists to make the knobs audible; the real
 * engine lives in the Studio.
 *
 * Rules it follows (see the web-audio skill): the AudioContext is created and resumed only
 * from the click that starts playback, parameters move with setTargetAtTime (never
 * `param.value =` from a drag), notes are scheduled on the audio clock with a look-ahead
 * timer, and a limiter keeps the loudest setting under full scale.
 */

/** MIDI notes for one bar of sixteenths in A minor; null is a rest. */
export const PATTERN: readonly (number | null)[] = [
  33,
  null,
  33,
  45,
  null,
  33,
  43,
  null,
  33,
  null,
  36,
  null,
  38,
  null,
  40,
  43,
];

const BPM = 112;
const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD_SECONDS = 0.12;
const TIMER_MS = 25;
/** Smoothing for knob moves: short enough to feel direct, long enough not to click. */
const PARAM_TIME_CONSTANT = 0.03;

function midiToHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export interface DemoParams {
  cutoffHz: number;
  resonance: number;
  volumeDb: number;
}

export class DemoEngine {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private master: GainNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;
  private buffers: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private nextStep = 0;
  /** Steps already scheduled, so the display can follow what is audible right now. */
  private queue: { step: number; time: number }[] = [];
  private lastStep = -1;
  private params: DemoParams;

  constructor(params: DemoParams) {
    this.params = { ...params };
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Call from a click handler: creating and resuming the context needs a user gesture. */
  async start(): Promise<void> {
    if (this.timer) return;
    const ctx = this.ensureGraph();
    await ctx.resume();
    const now = ctx.currentTime;
    this.master?.gain.cancelScheduledValues(now);
    this.master?.gain.setTargetAtTime(dbToGain(this.params.volumeDb), now, 0.01);
    this.nextTime = now + 0.05;
    this.nextStep = 0;
    this.queue = [];
    this.lastStep = -1;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    if (this.ctx && this.master) {
      // Fade rather than cut, so stopping mid-note does not click.
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
    }
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.filter = null;
    this.master = null;
    this.analysers = null;
    this.buffers = null;
  }

  setParams(next: Partial<DemoParams>): void {
    this.params = { ...this.params, ...next };
    const ctx = this.ctx;
    if (!ctx || !this.filter || !this.master) return;
    const now = ctx.currentTime;
    if (next.cutoffHz !== undefined) {
      this.filter.frequency.setTargetAtTime(next.cutoffHz, now, PARAM_TIME_CONSTANT);
    }
    if (next.resonance !== undefined) {
      this.filter.Q.setTargetAtTime(next.resonance, now, PARAM_TIME_CONSTANT);
    }
    if (next.volumeDb !== undefined && this.timer) {
      this.master.gain.setTargetAtTime(dbToGain(next.volumeDb), now, PARAM_TIME_CONSTANT);
    }
  }

  /** The step that is sounding now, or -1 when stopped. */
  currentStep(): number {
    const ctx = this.ctx;
    if (!ctx || !this.timer) return -1;
    const now = ctx.currentTime;
    let current = -1;
    while (this.queue.length > 0 && this.queue[0]!.time <= now) {
      current = this.queue.shift()!.step;
    }
    if (current !== -1) this.lastStep = current;
    return this.lastStep;
  }

  /**
   * Sample-peak level per channel in dBFS over the analyser window (−Infinity when silent
   * or stopped). Peak rather than RMS: the plucky bass is mostly decay and silence, so RMS
   * sits far below what the ear reads as loud, and DAW channel meters show peaks too.
   */
  levels(): [number, number] {
    if (!this.analysers || !this.buffers) return [-Infinity, -Infinity];
    const out: [number, number] = [-Infinity, -Infinity];
    for (let ch = 0; ch < 2; ch++) {
      const buf = this.buffers[ch]!;
      this.analysers[ch]!.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
      out[ch] = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    }
    return out;
  }

  private ensureGraph(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = this.params.cutoffHz;
    filter.Q.value = this.params.resonance;

    const master = ctx.createGain();
    master.gain.value = 0;

    // Resonance can add a lot of gain at the cutoff; the limiter keeps that under 0 dBFS.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.1;

    const splitter = ctx.createChannelSplitter(2);
    const left = ctx.createAnalyser();
    const right = ctx.createAnalyser();
    left.fftSize = 1024;
    right.fftSize = 1024;

    filter.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    // The analysers only listen; they are never connected to the speakers.
    limiter.connect(splitter);
    splitter.connect(left, 0);
    splitter.connect(right, 1);

    this.ctx = ctx;
    this.filter = filter;
    this.master = master;
    this.analysers = [left, right];
    this.buffers = [new Float32Array(left.fftSize), new Float32Array(right.fftSize)];
    return ctx;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_SECONDS) {
      const note = PATTERN[this.nextStep];
      if (note != null) this.playNote(note, this.nextTime, this.nextStep);
      this.queue.push({ step: this.nextStep, time: this.nextTime });
      this.nextStep = (this.nextStep + 1) % PATTERN.length;
      this.nextTime += STEP_SECONDS;
    }
  }

  private playNote(note: number, time: number, step: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.filter) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToHz(note), time);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.32, time + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, time + STEP_SECONDS * 1.8);

    // Alternate notes slightly left and right so the stereo meter has something to show.
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(step % 2 === 0 ? -0.25 : 0.25, time);

    osc.connect(env);
    env.connect(pan);
    pan.connect(this.filter);
    osc.start(time);
    osc.stop(time + STEP_SECONDS * 2);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      pan.disconnect();
    };
  }
}
