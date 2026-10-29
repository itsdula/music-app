/**
 * Metronome voice: synthesized accent/normal click buffers (audio-dsp) played on the
 * beat grid; its own gain (`metronome.gainDb`), summed after the master bus (not
 * metered, not processed by master effects).
 */
import { dbToGain, synthesizeMetronomeClick } from '@studio/audio-dsp';
import type { GraphContext } from './graph-context';
import { safeDisconnect, safeStop, setParam } from '../util/audio-params';

interface Click {
  readonly source: AudioBufferSourceNode;
  readonly startTime: number;
}

export class MetronomeVoice {
  readonly output: GainNode;
  private readonly accent: AudioBuffer;
  private readonly normal: AudioBuffer;
  private readonly clicks = new Set<Click>();

  constructor(
    private readonly g: GraphContext,
    gainDb: number,
    destination: AudioNode,
  ) {
    const ctx = g.ctx;
    this.output = new GainNode(ctx, { gain: dbToGain(gainDb) });
    this.output.connect(destination);
    const make = (accent: boolean) => {
      const samples = synthesizeMetronomeClick(ctx.sampleRate, accent);
      const buffer = new AudioBuffer({
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: ctx.sampleRate,
      });
      buffer.getChannelData(0).set(samples);
      return buffer;
    };
    this.accent = make(true);
    this.normal = make(false);
  }

  click(time: number, accent: boolean): void {
    const source = new AudioBufferSourceNode(this.g.ctx, {
      buffer: accent ? this.accent : this.normal,
    });
    source.connect(this.output);
    const click: Click = { source, startTime: time };
    source.onended = () => {
      safeDisconnect(source);
      this.clicks.delete(click);
    };
    source.start(time);
    this.clicks.add(click);
  }

  /** Drops clicks scheduled at or after `time`. */
  cancel(time: number): void {
    for (const click of [...this.clicks]) {
      if (click.startTime >= time) {
        click.source.onended = null;
        safeStop(click.source, 0);
        safeDisconnect(click.source);
        this.clicks.delete(click);
      }
    }
  }

  setGain(gainDb: number): void {
    setParam(this.output.gain, dbToGain(gainDb), this.g.ctx, false);
  }

  get pendingClicks(): number {
    return this.clicks.size;
  }

  dispose(): void {
    this.cancel(Number.NEGATIVE_INFINITY);
    safeDisconnect(this.output);
  }
}
