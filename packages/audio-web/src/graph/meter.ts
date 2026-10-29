/**
 * Meter tap: peak / RMS / clip per channel "since the previous read".
 *
 * Primary implementation: a `studio-meter` AudioWorkletNode (a sink with no outputs)
 * that accumulates statistics on the audio thread. `read()` returns everything that has
 * arrived since the last read and posts the next 'read' request, so the values lag the
 * audio by one request round trip (≈ one UI frame) but no sample is ever missed or
 * counted twice, and no messages flow while nobody reads.
 *
 * Fallback (no AudioWorklet): two AnalyserNodes; each read inspects the most recent
 * 2048 samples (≈ 43 ms at 48 kHz), so peaks between reads spaced further apart can be
 * missed.
 */
import type { ChannelMeter } from '@studio/audio-contracts';
import type { GraphContext } from './graph-context';
import { safeDisconnect } from '../util/audio-params';

const ANALYSER_SIZE = 2048;
const SILENT: ChannelMeter = { peak: [0, 0], rms: [0, 0], clipped: false };

export class MeterTap {
  private readonly node: AudioWorkletNode | null = null;
  private readonly splitter: ChannelSplitterNode | null = null;
  private readonly analysers: AnalyserNode[] = [];
  private readonly scratch: Float32Array<ArrayBuffer> | null = null;
  private pending = false;
  private peak = [0, 0];
  private sumSq = [0, 0];
  private frames = 0;
  private clipped = false;

  constructor(
    g: GraphContext,
    private readonly source: AudioNode,
  ) {
    const ctx = g.ctx;
    if (g.workletReady) {
      this.node = new AudioWorkletNode(ctx, 'studio-meter', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.node.port.onmessage = (event: MessageEvent<Float64Array>) => this.accumulate(event.data);
      source.connect(this.node);
    } else {
      this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
      source.connect(this.splitter);
      for (let c = 0; c < 2; c++) {
        const analyser = new AnalyserNode(ctx, { fftSize: ANALYSER_SIZE });
        this.splitter.connect(analyser, c);
        this.analysers.push(analyser);
      }
      this.scratch = new Float32Array(ANALYSER_SIZE);
    }
  }

  private accumulate(stats: Float64Array): void {
    this.pending = false;
    this.peak[0] = Math.max(this.peak[0]!, stats[0]!);
    this.peak[1] = Math.max(this.peak[1]!, stats[1]!);
    this.sumSq[0]! += stats[2]!;
    this.sumSq[1]! += stats[3]!;
    this.frames += stats[4]!;
    if (stats[5]! > 0) this.clipped = true;
  }

  /** Statistics since the previous read; resets the accumulator. */
  read(): ChannelMeter {
    if (this.node) {
      const result: ChannelMeter =
        this.frames > 0
          ? {
              peak: [this.peak[0]!, this.peak[1]!],
              rms: [
                Math.sqrt(this.sumSq[0]! / this.frames),
                Math.sqrt(this.sumSq[1]! / this.frames),
              ],
              clipped: this.clipped,
            }
          : SILENT;
      this.peak = [0, 0];
      this.sumSq = [0, 0];
      this.frames = 0;
      this.clipped = false;
      if (!this.pending) {
        this.pending = true;
        this.node.port.postMessage('read');
      }
      return result;
    }
    const peak: number[] = [];
    const rms: number[] = [];
    let clipped = false;
    for (const analyser of this.analysers) {
      const data = this.scratch!;
      analyser.getFloatTimeDomainData(data);
      let p = 0;
      let s = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i]!;
        const a = Math.abs(v);
        if (a > p) p = a;
        s += v * v;
      }
      if (p >= 1) clipped = true;
      peak.push(p);
      rms.push(Math.sqrt(s / data.length));
    }
    return { peak, rms, clipped };
  }

  dispose(): void {
    if (this.node) {
      this.node.port.postMessage('dispose');
      this.node.port.onmessage = null;
      safeDisconnect(this.source, this.node);
    }
    if (this.splitter) {
      safeDisconnect(this.source, this.splitter);
      safeDisconnect(this.splitter);
    }
  }
}
