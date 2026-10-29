/**
 * One capture session on the `studio-recorder` AudioWorklet processor.
 *
 * The worklet copies input frames into chunks and posts each chunk with the context
 * frame (`currentFrame`) of its first sample, so the take's position on the engine clock
 * is exact regardless of message latency. `stop()` resolves after the worklet has
 * flushed its partial chunk and acknowledged.
 */
import { RECORDER_CHUNK_FRAMES } from '../constants';
import { safeDisconnect } from '../util/audio-params';

type RecorderMessage =
  | { readonly type: 'chunk'; readonly frame: number; readonly channels: Float32Array[] }
  | { readonly type: 'stopped'; readonly frame: number };

export interface CapturedAudio {
  /** Context frame of the first captured sample (null when nothing was captured). */
  readonly firstFrame: number | null;
  readonly sampleRate: number;
  readonly channels: Float32Array[];
}

export class RecorderSession {
  private readonly node: AudioWorkletNode;
  private readonly chunks: { frame: number; channels: Float32Array[] }[] = [];
  private stopResolver: ((frame: number) => void) | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly source: AudioNode,
    readonly channelCount: 1 | 2,
  ) {
    this.node = new AudioWorkletNode(ctx, 'studio-recorder', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { chunkFrames: RECORDER_CHUNK_FRAMES, channelCount },
    });
    this.node.port.onmessage = (event: MessageEvent<RecorderMessage>) => {
      const message = event.data;
      if (message.type === 'chunk')
        this.chunks.push({ frame: message.frame, channels: message.channels });
      else this.stopResolver?.(message.frame);
    };
    source.connect(this.node);
  }

  start(): void {
    this.node.port.postMessage({ type: 'start' });
  }

  /** Frames captured so far (chunks received on the main thread). */
  get capturedFrames(): number {
    return this.chunks.reduce((sum, c) => sum + (c.channels[0]?.length ?? 0), 0);
  }

  async stop(timeoutMs = 2000): Promise<CapturedAudio> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), timeoutMs);
      this.stopResolver = () => {
        clearTimeout(timer);
        resolve();
      };
      this.node.port.postMessage({ type: 'stop' });
    });
    this.node.port.postMessage({ type: 'dispose' });
    this.node.port.onmessage = null;
    safeDisconnect(this.source, this.node);
    return this.assemble();
  }

  /** Concatenates chunks; gaps (dropped chunks) are filled with silence by frame. */
  private assemble(): CapturedAudio {
    const sampleRate = this.ctx.sampleRate;
    if (this.chunks.length === 0) {
      return {
        firstFrame: null,
        sampleRate,
        channels: Array.from({ length: this.channelCount }, () => new Float32Array(0)),
      };
    }
    const first = this.chunks[0]!.frame;
    const last = this.chunks[this.chunks.length - 1]!;
    const total = last.frame + (last.channels[0]?.length ?? 0) - first;
    const channels = Array.from({ length: this.channelCount }, () => new Float32Array(total));
    for (const chunk of this.chunks) {
      const offset = chunk.frame - first;
      chunk.channels.forEach((data, c) => {
        if (c < channels.length)
          channels[c]!.set(data.subarray(0, Math.max(0, total - offset)), offset);
      });
    }
    return { firstFrame: first, sampleRate, channels };
  }

  dispose(): void {
    this.node.port.postMessage({ type: 'dispose' });
    this.node.port.onmessage = null;
    safeDisconnect(this.source, this.node);
  }
}
