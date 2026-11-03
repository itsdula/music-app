import { MPK_MINI_MK3_LAYOUT } from '@studio/midi-akai-mpk-mini-mk3';
import type { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { buildMpkScene } from '../src/features/midi-controller/mpk-3d/scene';

const idsWithPrefix = (ids: Iterable<string>, prefix: string) =>
  [...ids].filter((id) => id.startsWith(prefix));

describe('buildMpkScene', () => {
  it('builds every control of the layout without a renderer', () => {
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT);
    const ids = [...model.byLayoutId.keys()];
    expect(idsWithPrefix(ids, 'key.')).toHaveLength(25);
    expect(idsWithPrefix(ids, 'pad.')).toHaveLength(8);
    expect(idsWithPrefix(ids, 'knob.')).toHaveLength(8);
    expect(model.byLayoutId.has('joystick')).toBe(true);
    expect(model.width).toBeCloseTo(12.5);
    expect(model.depth).toBeCloseTo(7.13);
    model.dispose();
  });

  it('looks keys up by control id and animates them from activity', () => {
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT);
    const key = model.byLayoutId.get('key.0') as Mesh | undefined;
    expect(key?.name).toBe('key.0');
    const pivot = key?.parent;
    expect(pivot?.rotation.x).toBe(0);

    const activity = new Map([
      ['key.0', { value: 0.8, timeMs: 1 }],
      ['pad.B3', { value: 1, timeMs: 2 }],
      ['knob.K1', { value: 1, timeMs: 3 }],
    ]);
    expect(model.applyActivity(activity)).toBe(true);
    model.step(0, true);
    expect(pivot?.rotation.x).toBeGreaterThan(0);
    const pad = model.byLayoutId.get('pad.3') as Mesh<never, MeshStandardMaterial>;
    expect(pad.material.emissive.getHexString()).toBe('3cc8b4');
    expect(model.byLayoutId.get('knob.K1')?.rotation.y).toBeCloseTo((-135 * Math.PI) / 180);
    // Unchanged activity is not re-applied.
    expect(model.applyActivity(activity)).toBe(false);
    model.dispose();
  });
});
