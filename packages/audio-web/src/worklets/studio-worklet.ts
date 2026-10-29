/**
 * AudioWorklet processors, bundled by `pnpm codegen` into a string
 * (`STUDIO_WORKLET_SOURCE`) and loaded from a Blob URL (see docs/audio-engine.md).
 *
 * This file runs in AudioWorkletGlobalScope, which the DOM lib does not describe, so
 * the few globals it uses are declared locally. It must not import anything that
 * touches DOM APIs.
 *
 * Processors:
 * - `studio-meter`: accumulates per-channel peak, sum of squares and clip flags; on a
 *   'read' message it replies with the accumulated stats and resets (pull model — no
 *   messages while nobody reads meters).
 * - `studio-recorder`: captures input frames into fixed-size chunks and posts each chunk
 *   (transferring its buffers) together with the context frame of its first sample.
 */

interface WorkletProcessorInstance {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  prototype: WorkletProcessorInstance;
  new (options?: AudioWorkletNodeOptions): WorkletProcessorInstance;
};
declare const currentFrame: number;
declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => WorkletProcessorInstance,
): void;

const RENDER_QUANTUM = 128;

class MeterProcessor extends AudioWorkletProcessor {
  private readonly peak = new Float64Array(2);
  private readonly sumSq = new Float64Array(2);
  private frames = 0;
  private clipped = false;
  private alive = true;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data === 'read') {
        const stats = new Float64Array([
          this.peak[0]!,
          this.peak[1]!,
          this.sumSq[0]!,
          this.sumSq[1]!,
          this.frames,
          this.clipped ? 1 : 0,
        ]);
        this.port.postMessage(stats, [stats.buffer]);
        this.peak.fill(0);
        this.sumSq.fill(0);
        this.frames = 0;
        this.clipped = false;
      } else if (event.data === 'dispose') {
        this.alive = false;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    let frames = RENDER_QUANTUM;
    if (input && input.length > 0) {
      frames = input[0]!.length;
      const channels = Math.min(2, input.length);
      for (let c = 0; c < 2; c++) {
        // Mono input is reported on both meter channels.
        const data = input[c < channels ? c : 0]!;
        let peak = this.peak[c]!;
        let sum = this.sumSq[c]!;
        for (let i = 0; i < data.length; i++) {
          const v = data[i]!;
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          if (a >= 1) this.clipped = true;
          sum += v * v;
        }
        this.peak[c] = peak;
        this.sumSq[c] = sum;
      }
    }
    this.frames += frames;
    return this.alive;
  }
}

interface RecorderOptions {
  readonly chunkFrames?: number;
  readonly channelCount?: number;
}

class RecorderProcessor extends AudioWorkletProcessor {
  private readonly chunkFrames: number;
  private readonly channelCount: number;
  private buffers: Float32Array[] = [];
  private fill = 0;
  private chunkStartFrame = 0;
  private recording = false;
  private alive = true;

  constructor(options?: AudioWorkletNodeOptions) {
    super(options);
    const opts = (options?.processorOptions ?? {}) as RecorderOptions;
    this.chunkFrames = Math.max(RENDER_QUANTUM, opts.chunkFrames ?? 4096);
    this.channelCount = Math.max(1, Math.min(2, opts.channelCount ?? 1));
    this.port.onmessage = (event: MessageEvent<{ type: string }>) => {
      const type = event.data?.type;
      if (type === 'start') {
        this.recording = true;
        this.fill = 0;
        this.buffers = [];
      } else if (type === 'stop') {
        if (this.recording) this.flush();
        this.recording = false;
        this.port.postMessage({ type: 'stopped', frame: currentFrame });
      } else if (type === 'dispose') {
        this.recording = false;
        this.alive = false;
      }
    };
  }

  private allocate(): void {
    this.buffers = [];
    for (let c = 0; c < this.channelCount; c++)
      this.buffers.push(new Float32Array(this.chunkFrames));
    this.fill = 0;
  }

  private flush(): void {
    if (this.fill === 0 || this.buffers.length === 0) return;
    const channels = this.buffers.map((b) => b.slice(0, this.fill));
    this.port.postMessage(
      { type: 'chunk', frame: this.chunkStartFrame, channels },
      channels.map((c) => c.buffer),
    );
    this.buffers = [];
    this.fill = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    if (!this.recording) return this.alive;
    const input = inputs[0];
    const frames = input && input.length > 0 ? input[0]!.length : RENDER_QUANTUM;
    let offset = 0;
    while (offset < frames) {
      if (this.buffers.length === 0) {
        this.allocate();
        this.chunkStartFrame = currentFrame + offset;
      }
      const count = Math.min(frames - offset, this.chunkFrames - this.fill);
      for (let c = 0; c < this.channelCount; c++) {
        const target = this.buffers[c]!;
        const source = input && input.length > 0 ? input[Math.min(c, input.length - 1)] : undefined;
        if (source) target.set(source.subarray(offset, offset + count), this.fill);
        // Missing input (inactive stream) records silence to keep the timeline continuous.
      }
      this.fill += count;
      offset += count;
      if (this.fill === this.chunkFrames) {
        const channels = this.buffers;
        this.port.postMessage(
          { type: 'chunk', frame: this.chunkStartFrame, channels },
          channels.map((c) => c.buffer),
        );
        this.buffers = [];
        this.fill = 0;
      }
    }
    return this.alive;
  }
}

registerProcessor('studio-meter', MeterProcessor);
registerProcessor('studio-recorder', RecorderProcessor);
