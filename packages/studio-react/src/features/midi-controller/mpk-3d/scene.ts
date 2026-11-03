/**
 * Procedural three.js model of the MPK Mini MK3, built from the shared layout data (no
 * model files, textures or brand marks). Pure: creates no renderer, so it runs in jsdom.
 */
import type { DeviceLayout, DeviceLayoutElement } from '@studio/midi-core';
import { controlIdsForLayoutElement } from '@studio/midi-akai-mpk-mini-mk3';
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Panel width in scene units (inches); depth follows the layout aspect ratio. */
export const PANEL_WIDTH = 12.5;
export const BODY_HEIGHT = 0.9;

export const MPK_3D_COLORS = {
  body: '#16171b',
  cheek: '#8B7CF6',
  joystick: '#8B7CF6',
  pad: '#3a3d44',
  button: '#1d1f24',
  knob: '#141518',
  pointer: '#f2f2f5',
  keyWhite: '#eceef2',
  keyBlack: '#141518',
  keybed: '#0b0c0e',
  oled: '#cfd3ff',
  accent: '#8B7CF6',
  padA: '#8B7CF6',
  padB: '#3CC8B4',
} as const;

export type ActivityMap = ReadonlyMap<string, { readonly value: number; readonly timeMs: number }>;

interface Animated {
  readonly layoutId: string;
  readonly shape: DeviceLayoutElement['shape'];
  /** Object that moves (pivot group). */
  readonly node: Object3D;
  /** Material whose emissive colour reflects activity, if any. */
  readonly material: MeshStandardMaterial | null;
  /** Key tilt (radians) at full press, so the front edge dips a fixed distance. */
  readonly pressAngle: number;
  /** Resting base colour of `material`. */
  readonly base: Color;
  current: number;
  target: number;
  /** Second axis (joystick y). */
  current2: number;
  target2: number;
  glow: Color;
}

export interface MpkScene {
  readonly root: Group;
  readonly width: number;
  readonly depth: number;
  /** Meshes (or groups) by layout id, e.g. `key.0`, `pad.1`, `knob.K1`, `joystick`. */
  readonly byLayoutId: ReadonlyMap<string, Object3D>;
  /** Reads live activity into targets. Returns true when anything changed. */
  applyActivity(activity: ActivityMap): boolean;
  /** Eases towards targets; `snap` jumps straight there. Returns true while still moving. */
  step(dt: number, snap: boolean): boolean;
  dispose(): void;
}

const deg = Math.PI / 180;
const KNOB_RANGE = 135 * deg;
const JOYSTICK_TILT = 20 * deg;
/** How far a key's front edge dips when fully pressed. */
const KEY_DIP = 0.08;

function standard(
  color: string,
  roughness: number,
  metalness = 0,
  extra: Partial<{ emissive: string; emissiveIntensity: number }> = {},
): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function shadowed<T extends Mesh>(mesh: T, cast = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  return mesh;
}

/** Builds the device model. All geometry/materials are owned and freed by `dispose()`. */
export function buildMpkScene(layout: DeviceLayout): MpkScene {
  const W = PANEL_WIDTH;
  const D = W / layout.aspectRatio;
  const root = new Group();
  root.name = 'mpk-mini-mk3';
  const byLayoutId = new Map<string, Object3D>();
  const animated: Animated[] = [];

  const center = (el: DeviceLayoutElement) => ({
    x: (el.rect.x + el.rect.w / 2) * W - W / 2,
    z: (el.rect.y + el.rect.h / 2) * D - D / 2,
    w: el.rect.w * W,
    d: el.rect.h * D,
  });

  // Shared materials.
  const bodyMat = standard(MPK_3D_COLORS.body, 0.7);
  const cheekMat = standard(MPK_3D_COLORS.cheek, 0.55, 0.05);
  const keybedMat = standard(MPK_3D_COLORS.keybed, 0.85);
  const buttonMat = standard(MPK_3D_COLORS.button, 0.85);
  const knobMat = standard(MPK_3D_COLORS.knob, 0.55);
  const pointerMat = standard(MPK_3D_COLORS.pointer, 0.4, 0, {
    emissive: '#ffffff',
    emissiveIntensity: 0.25,
  });
  const ownedMaterials: Material[] = [bodyMat, cheekMat, keybedMat, buttonMat, knobMat, pointerMat];
  const ownedGeometries: BufferGeometry[] = [];
  const geo = <G extends BufferGeometry>(g: G): G => {
    ownedGeometries.push(g);
    return g;
  };

  // Body: a rounded slab with its top face at y = 0.
  const cheekW = 0.2;
  const body = shadowed(
    new Mesh(geo(new RoundedBoxGeometry(W - cheekW * 2, BODY_HEIGHT, D, 4, 0.12)), bodyMat),
  );
  body.position.y = -BODY_HEIGHT / 2;
  root.add(body);

  // Side cheeks, slightly proud of the panel.
  const cheekGeo = geo(new RoundedBoxGeometry(cheekW, BODY_HEIGHT + 0.1, D, 4, 0.06));
  for (const side of [-1, 1]) {
    const cheek = shadowed(new Mesh(cheekGeo, cheekMat));
    cheek.position.set(side * (W / 2 - cheekW / 2), -BODY_HEIGHT / 2 + 0.05, 0);
    root.add(cheek);
  }

  // Keybed recess behind/under the keys (derived from the white keys' extent).
  const whiteKeys = layout.elements.filter((e) => e.shape === 'key-white');
  if (whiteKeys.length > 0) {
    const x0 = Math.min(...whiteKeys.map((e) => e.rect.x));
    const x1 = Math.max(...whiteKeys.map((e) => e.rect.x + e.rect.w));
    const y0 = Math.min(...whiteKeys.map((e) => e.rect.y));
    const pad = 0.006;
    const bedW = (x1 - x0 + pad * 2) * W;
    const bedD = (1 - y0 + pad) * D;
    const bed = shadowed(new Mesh(geo(new BoxGeometry(bedW, 0.02, bedD)), keybedMat), false);
    bed.position.set(((x0 + x1) / 2) * W - W / 2, 0.002, (y0 - pad) * D - D / 2 + bedD / 2);
    root.add(bed);
  }

  const knobBody = geo(new CylinderGeometry(1, 1.04, 1, 40));
  const ridgeGeo = geo(new BoxGeometry(1, 1, 1));
  const keyCache = new Map<string, BufferGeometry>();
  const sizedGeo = (kind: string, make: () => BufferGeometry) => {
    let g = keyCache.get(kind);
    if (!g) {
      g = geo(make());
      keyCache.set(kind, g);
    }
    return g;
  };

  for (const el of layout.elements) {
    const c = center(el);
    let node: Object3D;
    let material: MeshStandardMaterial | null = null;
    switch (el.shape) {
      case 'key-white':
      case 'key-black': {
        const white = el.shape === 'key-white';
        const kw = c.w - (white ? 0.05 : 0.02);
        const kd = c.d - 0.03;
        const kh = white ? 0.32 : 0.36;
        const topY = white ? 0.13 : 0.3;
        material = standard(
          white ? MPK_3D_COLORS.keyWhite : MPK_3D_COLORS.keyBlack,
          white ? 0.35 : 0.55,
        );
        ownedMaterials.push(material);
        const g = sizedGeo(`${el.shape}:${kw.toFixed(3)}:${kd.toFixed(3)}`, () =>
          white ? new RoundedBoxGeometry(kw, kh, kd, 2, 0.03) : new BoxGeometry(kw, kh, kd),
        );
        const mesh = shadowed(new Mesh(g, material));
        mesh.name = el.controlId;
        // Pivot at the back edge so a press tips the front down.
        const pivot = new Group();
        pivot.position.set(c.x, topY - kh / 2, c.z - c.d / 2);
        mesh.position.z = c.d / 2;
        pivot.add(mesh);
        root.add(pivot);
        byLayoutId.set(el.controlId, mesh);
        node = pivot;
        break;
      }
      case 'pad': {
        material = standard(MPK_3D_COLORS.pad, 0.9);
        ownedMaterials.push(material);
        const size = Math.min(c.w, c.d);
        const g = sizedGeo(
          `pad:${size.toFixed(3)}`,
          () => new RoundedBoxGeometry(size, 0.2, size, 3, 0.06),
        );
        const mesh = shadowed(new Mesh(g, material));
        mesh.name = el.controlId;
        mesh.position.set(c.x, 0.04, c.z);
        root.add(mesh);
        byLayoutId.set(el.controlId, mesh);
        node = mesh;
        break;
      }
      case 'button': {
        const g = sizedGeo(
          `button:${c.w.toFixed(3)}:${c.d.toFixed(3)}`,
          () => new RoundedBoxGeometry(c.w * 0.92, 0.16, c.d * 0.85, 3, 0.05),
        );
        material = buttonMat.clone();
        ownedMaterials.push(material);
        const mesh = shadowed(new Mesh(g, material));
        mesh.name = el.controlId;
        mesh.position.set(c.x, 0.03, c.z);
        root.add(mesh);
        byLayoutId.set(el.controlId, mesh);
        node = mesh;
        break;
      }
      case 'knob': {
        const r = Math.min(c.w, c.d) / 2;
        const h = 0.5;
        const group = new Group();
        group.name = el.controlId;
        group.position.set(c.x, 0, c.z);
        const cap = shadowed(new Mesh(knobBody, knobMat));
        cap.scale.set(r * 0.86, h, r * 0.86);
        cap.position.y = h / 2;
        group.add(cap);
        const ridges = 28;
        for (let i = 0; i < ridges; i++) {
          const a = (i / ridges) * Math.PI * 2;
          const ridge = new Mesh(ridgeGeo, knobMat);
          ridge.scale.set(0.05, h * 0.92, 0.07);
          ridge.position.set(Math.sin(a) * r * 0.88, h * 0.46, Math.cos(a) * r * 0.88);
          ridge.rotation.y = a;
          ridge.castShadow = true;
          group.add(ridge);
        }
        const pointer = new Mesh(ridgeGeo, pointerMat);
        pointer.scale.set(0.045, 0.02, r * 0.62);
        pointer.position.set(0, h + 0.005, -r * 0.5);
        group.add(pointer);
        root.add(group);
        byLayoutId.set(el.controlId, group);
        node = group;
        break;
      }
      case 'joystick': {
        const r = Math.min(c.w, c.d) / 2;
        const base = shadowed(
          new Mesh(geo(new CylinderGeometry(r * 1.05, r * 1.12, 0.06, 40)), knobMat),
        );
        base.position.set(c.x, 0.03, c.z);
        root.add(base);
        const tilt = new Group();
        tilt.name = el.controlId;
        tilt.position.set(c.x, 0.05, c.z);
        const domeMat = standard(MPK_3D_COLORS.joystick, 0.85);
        ownedMaterials.push(domeMat);
        const dome = shadowed(new Mesh(geo(new CylinderGeometry(r * 0.92, r, 0.42, 40)), domeMat));
        dome.position.y = 0.21;
        tilt.add(dome);
        const top = shadowed(
          new Mesh(geo(new CylinderGeometry(r * 0.8, r * 0.92, 0.05, 40)), domeMat),
        );
        top.position.y = 0.445;
        tilt.add(top);
        root.add(tilt);
        byLayoutId.set(el.controlId, tilt);
        material = domeMat;
        node = tilt;
        break;
      }
      case 'display': {
        const frame = shadowed(
          new Mesh(geo(new BoxGeometry(c.w, 0.06, c.d)), standard('#050608', 0.3)),
          false,
        );
        ownedMaterials.push(frame.material);
        frame.position.set(c.x, 0.03, c.z);
        root.add(frame);
        const screenMat = standard('#05060a', 0.2, 0, {
          emissive: MPK_3D_COLORS.oled,
          emissiveIntensity: 0.06,
        });
        ownedMaterials.push(screenMat);
        const screen = new Mesh(geo(new BoxGeometry(c.w * 0.86, 0.01, c.d * 0.7)), screenMat);
        screen.position.set(c.x, 0.065, c.z);
        screen.name = el.controlId;
        root.add(screen);
        // Two lit "text" lines.
        const lineMat = standard('#ffffff', 0.4, 0, {
          emissive: MPK_3D_COLORS.oled,
          emissiveIntensity: 0.9,
        });
        ownedMaterials.push(lineMat);
        for (const [i, frac] of [0.62, 0.4].entries()) {
          const line = new Mesh(ridgeGeo, lineMat);
          line.scale.set(c.w * 0.86 * frac, 0.005, c.d * 0.1);
          line.position.set(
            c.x - (c.w * 0.86 * (1 - frac)) / 2 + 0.06,
            0.072,
            c.z - c.d * 0.14 + i * c.d * 0.26,
          );
          root.add(line);
        }
        byLayoutId.set(el.controlId, screen);
        material = screenMat;
        node = screen;
        break;
      }
    }
    animated.push({
      layoutId: el.controlId,
      shape: el.shape,
      node,
      material,
      current: el.shape === 'joystick' ? 0.5 : 0,
      target: el.shape === 'joystick' ? 0.5 : 0,
      current2: 0,
      target2: 0,
      glow: new Color(MPK_3D_COLORS.accent),
      base: material ? material.color.clone() : new Color(),
      pressAngle: KEY_DIP / Math.max(0.1, el.rect.h * D),
    });
  }

  const drawn = new Map<string, number>();
  const padA = new Color(MPK_3D_COLORS.padA);
  const padB = new Color(MPK_3D_COLORS.padB);

  const applyActivity = (activity: ActivityMap): boolean => {
    let changed = false;
    for (const a of animated) {
      if (a.shape === 'display') continue;
      if (a.shape === 'joystick') {
        const x = activity.get('joystick.x');
        const y = activity.get('joystick.y');
        const stamp = Math.max(x?.timeMs ?? -1, y?.timeMs ?? -1);
        if (drawn.get(a.layoutId) === stamp) continue;
        drawn.set(a.layoutId, stamp);
        a.target = x?.value ?? 0.5;
        a.target2 = y?.value ?? 0;
        changed = true;
        continue;
      }
      let latest: { value: number; timeMs: number; id: string } | null = null;
      for (const id of controlIdsForLayoutElement(a.layoutId)) {
        const v = activity.get(id);
        if (v && (!latest || v.timeMs > latest.timeMs)) latest = { ...v, id };
      }
      if (!latest || drawn.get(a.layoutId) === latest.timeMs) continue;
      drawn.set(a.layoutId, latest.timeMs);
      a.target = a.shape === 'knob' ? latest.value : latest.value > 0 ? 1 : 0;
      if (a.shape === 'pad') a.glow.copy(latest.id.includes('.B') ? padB : padA);
      changed = true;
    }
    return changed;
  };

  function pose(a: Animated): void {
    const v = a.current;
    switch (a.shape) {
      case 'key-white':
      case 'key-black':
        a.node.rotation.x = v * a.pressAngle;
        if (a.material) {
          // White keys take on the accent; black keys glow it.
          a.material.color.copy(a.base).lerp(a.glow, a.shape === 'key-white' ? v * 0.65 : 0);
          a.material.emissive.copy(a.glow);
          a.material.emissiveIntensity = v * (a.shape === 'key-white' ? 0.15 : 0.9);
        }
        break;
      case 'pad':
        a.node.position.y = 0.04 - v * 0.05;
        a.material?.emissive.copy(a.glow);
        if (a.material) a.material.emissiveIntensity = v * 1.6;
        break;
      case 'button':
        a.node.position.y = 0.03 - v * 0.05;
        a.material?.emissive.copy(a.glow);
        if (a.material) a.material.emissiveIntensity = v * 0.35;
        break;
      case 'knob':
        // Clockwise from above as the value rises.
        a.node.rotation.y = -(-KNOB_RANGE + v * KNOB_RANGE * 2);
        break;
      case 'joystick':
        a.node.rotation.z = -(v - 0.5) * 2 * JOYSTICK_TILT;
        a.node.rotation.x = -a.current2 * JOYSTICK_TILT;
        break;
      case 'display':
        break;
    }
  }

  const step = (dt: number, snap: boolean): boolean => {
    let moving = false;
    const k = snap ? 1 : 1 - Math.exp(-dt * 28);
    for (const a of animated) {
      if (a.current === a.target && a.current2 === a.target2) continue;
      a.current += (a.target - a.current) * k;
      a.current2 += (a.target2 - a.current2) * k;
      if (Math.abs(a.target - a.current) < 1e-3) a.current = a.target;
      if (Math.abs(a.target2 - a.current2) < 1e-3) a.current2 = a.target2;
      if (a.current !== a.target || a.current2 !== a.target2) moving = true;
      pose(a);
    }
    return moving;
  };

  // Rest pose (knobs at 0 → -135°).
  for (const a of animated) pose(a);

  return {
    root,
    width: W,
    depth: D,
    byLayoutId,
    applyActivity,
    step,
    dispose() {
      for (const g of ownedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      root.clear();
    },
  };
}
