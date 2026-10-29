import {
  EFFECT_PARAM_SPECS,
  asEffectId,
  asTrackId,
  createEffectSlot,
  defaultParamValues,
  type EffectSlot,
} from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { apply, expectCommandError, expectNoop, ids, makeProject } from './fixtures';

const reverb = (id = 'fx_rev'): EffectSlot => createEffectSlot(asEffectId(id), 'reverb');

describe('effect.add', () => {
  it('appends to a track chain or the master chain', () => {
    const p = makeProject();
    const onTrack = apply(p, { type: 'effect.add', target: ids.inst, effect: reverb() });
    expect(onTrack.tracks[ids.inst]!.effects.map((e) => e.id)).toEqual([
      ids.trackFx,
      ids.trackFx2,
      'fx_rev',
    ]);
    expect(onTrack.tracks[ids.inst]!.effects[0]).toBe(p.tracks[ids.inst]!.effects[0]);
    expect(onTrack.master).toBe(p.master);
    const onMaster = apply(p, { type: 'effect.add', target: 'master', effect: reverb(), index: 0 });
    expect(onMaster.master.effects.map((e) => e.id)).toEqual(['fx_rev', ids.masterFx]);
    expect(onMaster.tracks).toBe(p.tracks);
  });

  it('clamps the insertion index and sanitizes params', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'effect.add',
      target: ids.inst,
      effect: { id: asEffectId('fx_g'), kind: 'gain', bypass: false, params: { gainDb: 100 } },
      index: -2,
    });
    expect(next.tracks[ids.inst]!.effects[0]).toEqual({
      id: 'fx_g',
      kind: 'gain',
      bypass: false,
      params: { gainDb: 24 },
    });
    const filled = apply(p, {
      type: 'effect.add',
      target: 'master',
      effect: { id: asEffectId('fx_d'), kind: 'delay', bypass: true, params: {} },
      index: 10,
    });
    expect(filled.master.effects[1]!.params).toEqual(defaultParamValues(EFFECT_PARAM_SPECS.delay));
  });

  it('allows the same effect id on different chains but not twice on one', () => {
    const p = makeProject();
    apply(p, { type: 'effect.add', target: ids.audio, effect: reverb(ids.trackFx) });
    expectCommandError(
      p,
      { type: 'effect.add', target: ids.inst, effect: reverb(ids.trackFx) },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'effect.add', target: 'master', effect: reverb(ids.masterFx) },
      'invalid-argument',
    );
  });

  it('validates the effect and target', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'effect.add', target: asTrackId('x'), effect: reverb() },
      'not-found',
    );
    expectCommandError(
      p,
      {
        type: 'effect.add',
        target: ids.inst,
        effect: { ...reverb(), kind: 'flanger' as 'reverb' },
      },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'effect.add', target: ids.inst, effect: { ...reverb(), params: { size: 1 } } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'effect.add', target: ids.inst, effect: { ...reverb(), id: asEffectId('') } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'effect.add', target: ids.inst, effect: reverb(), index: 0.5 },
      'invalid-argument',
    );
  });
});

describe('effect.remove', () => {
  it('removes from track and master chains', () => {
    const p = makeProject();
    expect(
      apply(p, { type: 'effect.remove', target: ids.inst, effectId: ids.trackFx }).tracks[
        ids.inst
      ]!.effects.map((e) => e.id),
    ).toEqual([ids.trackFx2]);
    expect(
      apply(p, { type: 'effect.remove', target: 'master', effectId: ids.masterFx }).master.effects,
    ).toEqual([]);
  });

  it('fails for unknown effects', () => {
    expectCommandError(
      makeProject(),
      { type: 'effect.remove', target: ids.audio, effectId: ids.trackFx },
      'not-found',
    );
  });
});

describe('effect.move', () => {
  it('reorders within the chain with clamping', () => {
    const p = makeProject();
    expect(
      apply(p, { type: 'effect.move', target: ids.inst, effectId: ids.trackFx, toIndex: 5 }).tracks[
        ids.inst
      ]!.effects.map((e) => e.id),
    ).toEqual([ids.trackFx2, ids.trackFx]);
    expectNoop(p, { type: 'effect.move', target: ids.inst, effectId: ids.trackFx, toIndex: -1 });
    expectNoop(p, { type: 'effect.move', target: 'master', effectId: ids.masterFx, toIndex: 0 });
    expectCommandError(
      p,
      { type: 'effect.move', target: ids.inst, effectId: asEffectId('x'), toIndex: 0 },
      'not-found',
    );
  });
});

describe('effect.setParams', () => {
  it('merges and clamps params', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'effect.setParams',
      target: ids.inst,
      effectId: ids.trackFx,
      params: { lowGainDb: -40, midQ: 2 },
    });
    const effect = next.tracks[ids.inst]!.effects[0]!;
    expect(effect.params).toMatchObject({ lowGainDb: -18, midQ: 2, highFreq: 5000 });
    expect(next.tracks[ids.inst]!.effects[1]).toBe(p.tracks[ids.inst]!.effects[1]);
    const master = apply(p, {
      type: 'effect.setParams',
      target: 'master',
      effectId: ids.masterFx,
      params: { ratio: 50 },
    });
    expect(master.master.effects[0]!.params.ratio).toBe(20);
  });

  it('rejects unknown params and is a no-op for identical values', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'effect.setParams', target: ids.inst, effectId: ids.trackFx, params: { ratio: 2 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'effect.setParams',
        target: ids.inst,
        effectId: ids.trackFx,
        params: { midQ: Number.NaN },
      },
      'invalid-argument',
    );
    expectNoop(p, {
      type: 'effect.setParams',
      target: ids.inst,
      effectId: ids.trackFx,
      params: { midQ: 0.7 },
    });
  });
});

describe('effect.setBypass', () => {
  it('toggles bypass and is a no-op when unchanged', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'effect.setBypass',
      target: ids.inst,
      effectId: ids.trackFx2,
      bypass: true,
    });
    expect(next.tracks[ids.inst]!.effects[1]!.bypass).toBe(true);
    expect(next.tracks[ids.inst]!.effects[1]!.params).toBe(p.tracks[ids.inst]!.effects[1]!.params);
    expectNoop(p, {
      type: 'effect.setBypass',
      target: 'master',
      effectId: ids.masterFx,
      bypass: false,
    });
    expectCommandError(
      p,
      { type: 'effect.setBypass', target: asTrackId('x'), effectId: ids.masterFx, bypass: true },
      'not-found',
    );
  });
});

describe('master.setGain', () => {
  it('clamps and shares the master chain', () => {
    const p = makeProject();
    const next = apply(p, { type: 'master.setGain', gainDb: 12 });
    expect(next.master.gainDb).toBe(6);
    expect(next.master.effects).toBe(p.master.effects);
    expect(apply(p, { type: 'master.setGain', gainDb: -1e6 }).master.gainDb).toBe(-60);
    expectNoop(p, { type: 'master.setGain', gainDb: 0 });
    expectCommandError(p, { type: 'master.setGain', gainDb: Number.NaN }, 'invalid-argument');
  });
});
