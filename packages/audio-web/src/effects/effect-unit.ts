/**
 * Effect units. Every unit has the same outer structure:
 *
 *     input ─┬─ bypassGain (1 when bypassed) ──────────────┬─ output
 *            └─ [processor] ── activeGain (1 when active) ─┘
 *
 * so bypass is a 10 ms linear crossfade between the dry signal and the processed one
 * (click-free, and exactly the dry signal once settled). Parameter changes glide with
 * setTargetAtTime. Kind-specific processors live in ./processors.ts.
 */
import {
  EFFECT_PARAM_SPECS,
  sanitizeParamValues,
  type EffectId,
  type EffectKind,
  type EffectSlot,
} from '@studio/domain';
import { BYPASS_CROSSFADE_SECONDS } from '../constants';
import { rampParam, safeDisconnect } from '../util/audio-params';
import type { GraphContext } from '../graph/graph-context';

export type EffectParams = Readonly<Record<string, number>>;

/** Kind-specific processing between `input` and `output` of the processor section. */
export interface EffectProcessor {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Applies parameters; `immediate` on construction, smoothed afterwards. */
  update(params: EffectParams, immediate: boolean): void;
  dispose(): void;
}

export type EffectProcessorFactory = (g: GraphContext, id: EffectId) => EffectProcessor;

export class EffectUnit {
  readonly id: EffectId;
  readonly kind: EffectKind;
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly bypassGain: GainNode;
  private readonly activeGain: GainNode;
  private readonly processor: EffectProcessor;
  private bypassed: boolean;
  private params: EffectParams;

  constructor(
    private readonly g: GraphContext,
    slot: EffectSlot,
    factory: EffectProcessorFactory,
  ) {
    const ctx = g.ctx;
    this.id = slot.id;
    this.kind = slot.kind;
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.bypassGain = new GainNode(ctx, { gain: slot.bypass ? 1 : 0 });
    this.activeGain = new GainNode(ctx, { gain: slot.bypass ? 0 : 1 });
    this.processor = factory(g, slot.id);
    this.params = sanitizeParamValues(EFFECT_PARAM_SPECS[slot.kind], slot.params);
    this.processor.update(this.params, true);
    this.bypassed = slot.bypass;
    this.input.connect(this.bypassGain).connect(this.output);
    this.input.connect(this.processor.input);
    this.processor.output.connect(this.activeGain).connect(this.output);
  }

  get isBypassed(): boolean {
    return this.bypassed;
  }

  get currentParams(): EffectParams {
    return this.params;
  }

  update(slot: EffectSlot): void {
    const params = sanitizeParamValues(EFFECT_PARAM_SPECS[slot.kind], slot.params);
    if (!paramsEqual(params, this.params)) {
      this.params = params;
      this.processor.update(params, false);
    }
    if (slot.bypass !== this.bypassed) {
      this.bypassed = slot.bypass;
      rampParam(this.bypassGain.gain, slot.bypass ? 1 : 0, this.g.ctx, BYPASS_CROSSFADE_SECONDS);
      rampParam(this.activeGain.gain, slot.bypass ? 0 : 1, this.g.ctx, BYPASS_CROSSFADE_SECONDS);
    }
  }

  dispose(): void {
    this.processor.dispose();
    for (const node of [this.input, this.output, this.bypassGain, this.activeGain])
      safeDisconnect(node);
  }
}

function paramsEqual(a: EffectParams, b: EffectParams): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

/** Equal-power dry/wet gains for a 0..1 mix: dry = cos(mix·π/2), wet = sin(mix·π/2). */
export function equalPowerMix(mix: number): { dry: number; wet: number } {
  const m = Math.min(1, Math.max(0, mix));
  return { dry: Math.cos((m * Math.PI) / 2), wet: Math.sin((m * Math.PI) / 2) };
}
