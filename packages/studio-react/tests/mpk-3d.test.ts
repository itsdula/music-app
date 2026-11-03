import { MPK_MINI_MK3_LAYOUT } from '@studio/midi-akai-mpk-mini-mk3';
import type { Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildMpkScene, OLED_IDLE_TEXT } from '../src/features/midi-controller/mpk-3d/scene';

/** jsdom has no 2D canvas: a stub context that accepts every call and records fillText. */
function stubCanvasFactory() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'fillText') return (s: string) => texts.push(s);
      if (prop === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (prop === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
  const createCanvas = vi.fn(
    (width: number, height: number) =>
      ({ width, height, getContext: () => ctx }) as unknown as HTMLCanvasElement,
  );
  return { createCanvas, texts };
}

const idsWithPrefix = (ids: Iterable<string>, prefix: string) =>
  [...ids].filter((id) => id.startsWith(prefix));

describe('buildMpkScene', () => {
  it('builds every control of the layout without a renderer', () => {
    const { createCanvas } = stubCanvasFactory();
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT, { createCanvas });
    const ids = [...model.byLayoutId.keys()];
    expect(idsWithPrefix(ids, 'key.')).toHaveLength(25);
    expect(idsWithPrefix(ids, 'pad.')).toHaveLength(8);
    expect(idsWithPrefix(ids, 'knob.')).toHaveLength(8);
    expect(model.byLayoutId.has('joystick')).toBe(true);
    expect(model.width).toBeCloseTo(12.5);
    expect(model.depth).toBeCloseTo(7.13);
    expect(model.triangles).toBeGreaterThan(20_000);
    expect(model.triangles).toBeLessThan(150_000);
    model.dispose();
  });

  it('prints the panel legends onto a canvas texture', () => {
    const { createCanvas, texts } = stubCanvasFactory();
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT, { createCanvas });
    expect(model.panelTexture.image).toMatchObject({ width: 2048 });
    for (const legend of ['PAD 1', 'PAD 8', 'K1', 'K8', 'ARPEGGIATOR', 'PAD CONTROLS', 'OCT +']) {
      expect(texts).toContain(legend);
    }
    expect(texts).toContain('SWING 64%');
    model.dispose();
  });

  it('redraws the OLED texture only when its text changes', () => {
    const { createCanvas, texts } = stubCanvasFactory();
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT, { createCanvas });
    expect(model.oledTexture).toBeDefined();
    expect(texts).toContain(OLED_IDLE_TEXT);
    const version = model.oledTexture.version;
    expect(model.setOledText(OLED_IDLE_TEXT)).toBe(false);
    expect(model.oledTexture.version).toBe(version);
    expect(model.setOledText('Note On C3 vel 100')).toBe(true);
    expect(model.oledTexture.version).toBe(version + 1);
    expect(texts).toContain('Note On C3 vel 100');
    expect(model.setOledText('Note On C3 vel 100')).toBe(false);
    expect(model.oledTexture.version).toBe(version + 1);
    model.dispose();
  });

  it('looks keys up by control id and animates them from activity', () => {
    const { createCanvas } = stubCanvasFactory();
    const model = buildMpkScene(MPK_MINI_MK3_LAYOUT, { createCanvas });
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
