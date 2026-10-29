/**
 * Stereo panner implementing engine-core's `mixerPanGains` law (equal-power, unity at
 * centre) per channel: input (2 ch, mono up-mixed) → splitter → L/R gains → merger.
 * Used instead of StereoPannerNode so the law is identical on every backend.
 */
import { mixerPanGains } from '@studio/engine-core';
import { safeDisconnect, setParam } from '../util/audio-params';

export class BalancePanner {
  readonly input: GainNode;
  readonly output: ChannelMergerNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly left: GainNode;
  private readonly right: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    pan: number,
  ) {
    this.input = new GainNode(ctx, {
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    this.splitter = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    const gains = mixerPanGains(pan);
    this.left = new GainNode(ctx, { gain: gains.left });
    this.right = new GainNode(ctx, { gain: gains.right });
    this.output = new ChannelMergerNode(ctx, { numberOfInputs: 2 });
    this.input.connect(this.splitter);
    this.splitter.connect(this.left, 0).connect(this.output, 0, 0);
    this.splitter.connect(this.right, 1).connect(this.output, 0, 1);
  }

  set(pan: number, immediate: boolean): void {
    const gains = mixerPanGains(pan);
    setParam(this.left.gain, gains.left, this.ctx, immediate);
    setParam(this.right.gain, gains.right, this.ctx, immediate);
  }

  dispose(): void {
    for (const node of [this.input, this.splitter, this.left, this.right, this.output])
      safeDisconnect(node);
  }
}
