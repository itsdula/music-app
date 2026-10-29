/**
 * Ordered chain of effect units between a fixed input and output node, reconciled
 * against `EffectSlot[]` by effect id. Parameter/bypass changes update units in place;
 * structural changes (add/remove/reorder) rewire the chain behind a short output dip
 * (10 ms fade out, rewire, fade in) in realtime, or immediately offline.
 */
import type { EffectId, EffectSlot } from '@studio/domain';
import { BYPASS_CROSSFADE_SECONDS } from '../constants';
import type { GraphContext } from '../graph/graph-context';
import { rampParam, safeDisconnect } from '../util/audio-params';
import { EffectUnit } from './effect-unit';
import { EFFECT_PROCESSORS } from './processors';

export class EffectChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly dip: GainNode;
  /** Desired order (updated immediately on every reconcile). */
  private target: EffectUnit[];
  /** Order currently connected (lags `target` by the dip in realtime). */
  private wired: EffectUnit[] = [];
  private readonly owner = {};

  constructor(
    private readonly g: GraphContext,
    slots: readonly EffectSlot[],
  ) {
    this.input = new GainNode(g.ctx);
    this.dip = new GainNode(g.ctx);
    this.output = new GainNode(g.ctx);
    this.dip.connect(this.output);
    this.target = slots.map((slot) => this.createUnit(slot));
    this.wire();
  }

  get size(): number {
    return this.target.length;
  }

  unit(id: EffectId): EffectUnit | undefined {
    return this.target.find((u) => u.id === id);
  }

  private createUnit(slot: EffectSlot): EffectUnit {
    return new EffectUnit(this.g, slot, EFFECT_PROCESSORS[slot.kind]);
  }

  /** Connects `target` in order and disposes units that left the chain. */
  private wire(): void {
    safeDisconnect(this.input);
    for (const unit of this.wired) safeDisconnect(unit.output);
    let previous: AudioNode = this.input;
    for (const unit of this.target) {
      safeDisconnect(unit.output);
      previous.connect(unit.input);
      previous = unit.output;
    }
    previous.connect(this.dip);
    const keep = new Set(this.target);
    for (const unit of this.wired) if (!keep.has(unit)) unit.dispose();
    this.wired = this.target.slice();
  }

  /** Reconciles the chain with `slots` (same id and kind → in-place update). */
  update(slots: readonly EffectSlot[]): void {
    const existing = new Map(this.target.map((u) => [u.id, u]));
    const next: EffectUnit[] = [];
    let structural = slots.length !== this.target.length;
    slots.forEach((slot, index) => {
      const unit = existing.get(slot.id);
      if (unit && unit.kind === slot.kind) {
        unit.update(slot);
        existing.delete(slot.id);
        next.push(unit);
        if (this.target[index] !== unit) structural = true;
      } else {
        next.push(this.createUnit(slot));
        structural = true;
      }
    });
    if (!structural) return;
    // Units created but never wired (superseded within one dip) are disposed here.
    const wiredSet = new Set(this.wired);
    for (const unit of existing.values()) if (!wiredSet.has(unit)) unit.dispose();
    this.target = next;
    if (!this.g.realtime) {
      this.wire();
      return;
    }
    rampParam(this.dip.gain, 0, this.g.ctx, BYPASS_CROSSFADE_SECONDS);
    this.g.defer(this.owner, BYPASS_CROSSFADE_SECONDS * 1000 + 5, () => {
      this.wire();
      rampParam(this.dip.gain, 1, this.g.ctx, BYPASS_CROSSFADE_SECONDS);
    });
  }

  dispose(): void {
    this.g.cancelDeferred(this.owner);
    const all = new Set([...this.target, ...this.wired]);
    for (const unit of all) unit.dispose();
    this.target = [];
    this.wired = [];
    for (const node of [this.input, this.dip, this.output]) safeDisconnect(node);
  }
}
