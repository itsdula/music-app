/**
 * Procedural three.js model of the MPK Mini MK3, built from the shared layout data (no
 * model files, image textures or brand marks: the panel print and OLED are drawn on
 * canvases at runtime). Pure: creates no renderer, so it runs in jsdom.
 */
import type { DeviceLayout, DeviceLayoutElement } from '@studio/midi-core';
import { controlIdsForLayoutElement } from '@studio/midi-akai-mpk-mini-mk3';
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import {
  bezelGeometry,
  blackKeyGeometry,
  buttonGeometry,
  joystickBootGeometry,
  joystickCapGeometry,
  knobGeometry,
  padGeometry,
  sideProfileSlab,
  triangleCount,
  whiteKeyGeometry,
} from './geometry';
import {
  BUTTON_CAP_FRACTION,
  PRINT_COLORS,
  defaultCanvasFactory,
  drawOled,
  drawPanelPrint,
  keysTop,
  type CanvasFactory,
} from './print';

/** Panel width in scene units (inches); depth follows the layout aspect ratio. */
export const PANEL_WIDTH = 12.5;
/** Body height at the back and the front (the device is a slight wedge). */
const HEIGHT_BACK = 1.05;
const HEIGHT_FRONT = 0.75;
/** Keybed floor below the panel top. */
const KEYBED_FLOOR = -0.16;
const CHEEK_W = 0.17;

export const MPK_3D_COLORS = {
  body: PRINT_COLORS.body,
  cheek: '#8B7CF6',
  joystick: '#8B7CF6',
  pad: '#3b3d44',
  button: '#24262c',
  knob: '#18191d',
  pointer: '#f4f5f7',
  keyWhite: '#eef0f3',
  keyBlack: '#0c0d0f',
  keybed: '#060709',
  accent: '#8B7CF6',
  accentStrong: '#A397FF',
  padA: '#8B7CF6',
  padB: '#3CC8B4',
} as const;

export const OLED_IDLE_TEXT = 'Nawa · ready';

export type ActivityMap = ReadonlyMap<string, { readonly value: number; readonly timeMs: number }>;

interface Animated {
  readonly layoutId: string;
  readonly shape: DeviceLayoutElement['shape'];
  /** Object that moves (pivot group or mesh). */
  readonly node: Object3D;
  /** Material whose colour/emissive reflects activity, if any. */
  readonly material: MeshStandardMaterial | null;
  /** Key tilt (radians) at full press, so the front edge dips a fixed distance. */
  readonly pressAngle: number;
  /** Resting base colour of `material`. */
  readonly base: Color;
  /** Resting height of `node`. */
  readonly baseY: number;
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
  /** Printed top panel (legends, outlines, wells), drawn on a canvas. */
  readonly panelTexture: CanvasTexture;
  /** OLED screen, redrawn only when its text changes. */
  readonly oledTexture: CanvasTexture;
  /** Total triangles of all meshes. */
  readonly triangles: number;
  /** Reads live activity into targets. Returns true when anything changed. */
  applyActivity(activity: ActivityMap): boolean;
  /** Eases towards targets; `snap` jumps straight there. Returns true while still moving. */
  step(dt: number, snap: boolean): boolean;
  /** Shows `text` on the OLED. Returns true when the texture was redrawn. */
  setOledText(text: string): boolean;
  /** Redraws the panel print (e.g. once web fonts have loaded). */
  redrawPrint(): void;
  dispose(): void;
}

export interface BuildOptions {
  /** Canvas factory for the print/OLED textures (tests pass a stub). */
  createCanvas?: CanvasFactory;
}

const deg = Math.PI / 180;
const KNOB_RANGE = 135 * deg;
const JOYSTICK_TILT = 18 * deg;
/** How far a key's front edge dips when fully pressed. */
const KEY_DIP = 0.08;
const KEY_GAP = 0.045;

/** Builds the device model. All geometry, materials and textures are freed by `dispose()`. */
export function buildMpkScene(layout: DeviceLayout, options: BuildOptions = {}): MpkScene {
  const createCanvas = options.createCanvas ?? defaultCanvasFactory;
  const W = PANEL_WIDTH;
  const D = W / layout.aspectRatio;
  const X = (f: number) => f * W - W / 2;
  const Z = (f: number) => f * D - D / 2;
  /** Underside height at depth z (wedge). */
  const bottomAt = (z: number) => -HEIGHT_BACK + ((z + D / 2) / D) * (HEIGHT_BACK - HEIGHT_FRONT);

  const root = new Group();
  root.name = 'mpk-mini-mk3';
  // Everything is modelled with the panel top at y = 0, then tipped so the base sits level.
  const deck = new Group();
  deck.rotation.x = Math.atan2(HEIGHT_BACK - HEIGHT_FRONT, D);
  root.add(deck);

  const byLayoutId = new Map<string, Object3D>();
  const animated: Animated[] = [];
  const ownedGeometries = new Set<BufferGeometry>();
  const ownedMaterials = new Set<Material>();
  const geo = <G extends BufferGeometry>(g: G): G => {
    ownedGeometries.add(g);
    return g;
  };
  const mat = <M extends Material>(m: M): M => {
    ownedMaterials.add(m);
    return m;
  };
  const add = (
    g: BufferGeometry,
    m: Material,
    parent: Object3D = deck,
    { cast = true, receive = true } = {},
  ) => {
    const mesh = new Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
    return mesh;
  };

  // --- Materials -------------------------------------------------------------------------
  const bodyMat = mat(new MeshStandardMaterial({ color: MPK_3D_COLORS.body, roughness: 0.78 }));
  const cheekMat = mat(
    new MeshPhysicalMaterial({
      color: MPK_3D_COLORS.cheek,
      roughness: 0.5,
      clearcoat: 0.15,
      clearcoatRoughness: 0.6,
      envMapIntensity: 0.6,
    }),
  );
  const keybedMat = mat(new MeshStandardMaterial({ color: MPK_3D_COLORS.keybed, roughness: 0.9 }));
  const knobMat = mat(
    new MeshStandardMaterial({ color: MPK_3D_COLORS.knob, roughness: 0.48, metalness: 0.15 }),
  );
  const pointerMat = mat(
    new MeshStandardMaterial({
      color: MPK_3D_COLORS.pointer,
      roughness: 0.4,
      emissive: '#ffffff',
      emissiveIntensity: 0.2,
    }),
  );
  const darkMat = mat(new MeshStandardMaterial({ color: '#050506', roughness: 0.6 }));
  const metalMat = mat(
    new MeshStandardMaterial({ color: '#b9bdc6', roughness: 0.3, metalness: 1 }),
  );
  const bezelMat = mat(new MeshStandardMaterial({ color: '#0b0c0f', roughness: 0.35 }));

  // --- Printed panel and OLED textures ---------------------------------------------------
  const printCanvas = createCanvas(2048, Math.round(2048 / layout.aspectRatio));
  drawPanelPrint(printCanvas, layout);
  const panelTexture = new CanvasTexture(printCanvas);
  panelTexture.colorSpace = SRGBColorSpace;
  panelTexture.anisotropy = 8;

  // --- Body ------------------------------------------------------------------------------
  const top = keysTop(layout);
  const zBedBack = Z(top - 0.012);
  const bodyW = W - CHEEK_W * 2;
  const bevel = 0.05;
  // Rear deck (panel top at y = 0); its front face is the keybed's back wall.
  add(
    geo(
      sideProfileSlab(
        [
          [-D / 2, 0],
          [zBedBack, 0],
          [zBedBack, bottomAt(zBedBack)],
          [-D / 2, -HEIGHT_BACK],
        ],
        bodyW,
        bevel,
      ),
    ),
    bodyMat,
  );
  // Front base under the keybed.
  const zBase = zBedBack - 0.1;
  add(
    geo(
      sideProfileSlab(
        [
          [zBase, KEYBED_FLOOR],
          [D / 2, KEYBED_FLOOR],
          [D / 2, -HEIGHT_FRONT],
          [zBase, bottomAt(zBase)],
        ],
        bodyW,
        0.03,
      ),
    ),
    bodyMat,
  );
  // Raised rails either side of the keybed.
  const whites = layout.elements.filter((e) => e.shape === 'key-white');
  const bedX0 = Math.min(...whites.map((e) => e.rect.x)) - 0.007;
  const bedX1 = Math.max(...whites.map((e) => e.rect.x + e.rect.w)) + 0.007;
  const railW = X(bedX0) - (-W / 2 + CHEEK_W);
  const railGeo = geo(
    sideProfileSlab(
      [
        [zBase, 0],
        [D / 2, 0],
        [D / 2, -HEIGHT_FRONT],
        [zBase, bottomAt(zBase)],
      ],
      railW,
      0.035,
    ),
  );
  for (const side of [-1, 1]) {
    const rail = add(railGeo, bodyMat);
    rail.position.x = side * (W / 2 - CHEEK_W - railW / 2);
  }
  // Keybed floor.
  const floor = add(
    geo(new PlaneGeometry((bedX1 - bedX0) * W, D / 2 - zBedBack)),
    keybedMat,
    deck,
    { cast: false },
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(X((bedX0 + bedX1) / 2), KEYBED_FLOOR + 0.002, (zBedBack + D / 2) / 2);

  // Side cheeks: raised, bevelled accent panels.
  const cheekGeo = geo(
    sideProfileSlab(
      [
        [-D / 2 - 0.015, 0.07],
        [D / 2 + 0.015, 0.07],
        [D / 2 + 0.015, -HEIGHT_FRONT],
        [-D / 2 - 0.015, -HEIGHT_BACK],
      ],
      CHEEK_W,
      0.05,
    ),
  );
  for (const side of [-1, 1]) {
    const cheek = add(cheekGeo, cheekMat);
    cheek.position.x = side * (W / 2 - CHEEK_W / 2);
  }

  // Printed top plate over the flat part of the rear deck.
  {
    const x0 = -bodyW / 2 + bevel;
    const x1 = bodyW / 2 - bevel;
    const z0 = -D / 2 + bevel;
    const z1 = zBedBack - bevel;
    const printMat = mat(new MeshStandardMaterial({ map: panelTexture, roughness: 0.8 }));
    const plate = add(geo(new PlaneGeometry(x1 - x0, z1 - z0)), printMat, deck, { cast: false });
    plate.rotation.x = -Math.PI / 2;
    plate.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
    // Map the plate onto its part of the whole-panel canvas (v = 1 at the back).
    const fx0 = (x0 + W / 2) / W;
    const fx1 = (x1 + W / 2) / W;
    const fz0 = (z0 + D / 2) / D;
    const fz1 = (z1 + D / 2) / D;
    panelTexture.repeat.set(fx1 - fx0, fz1 - fz0);
    panelTexture.offset.set(fx0, 1 - fz1);
  }

  // Rear connectors: USB port and sustain jack.
  {
    const zBack = -D / 2 - 0.005;
    const usb = add(geo(new BoxGeometry(0.38, 0.15, 0.04)), darkMat, deck, { cast: false });
    usb.position.set(-W * 0.3, -0.42, zBack);
    const tongue = add(geo(new BoxGeometry(0.26, 0.04, 0.03)), metalMat, deck, { cast: false });
    tongue.position.set(-W * 0.3, -0.42, zBack - 0.01);
    const jack = add(geo(new CylinderGeometry(0.09, 0.09, 0.04, 24)), darkMat, deck, {
      cast: false,
    });
    jack.rotation.x = Math.PI / 2;
    jack.position.set(-W * 0.2, -0.42, zBack);
    const ring = add(geo(new TorusGeometry(0.11, 0.022, 10, 32)), metalMat, deck, {
      cast: false,
    });
    ring.position.set(-W * 0.2, -0.42, zBack - 0.01);
  }

  // --- Controls --------------------------------------------------------------------------
  const center = (el: DeviceLayoutElement) => ({
    x: X(el.rect.x + el.rect.w / 2),
    z: Z(el.rect.y + el.rect.h / 2),
    w: el.rect.w * W,
    d: el.rect.h * D,
  });
  const cache = new Map<string, BufferGeometry>();
  const shared = (key: string, make: () => BufferGeometry) => {
    let g = cache.get(key);
    if (!g) {
      g = geo(make());
      cache.set(key, g);
    }
    return g;
  };

  const blacks = layout.elements.filter((e) => e.shape === 'key-black');
  const whiteBottom = KEYBED_FLOOR + 0.02;
  const whiteHeight = 0.06 - whiteBottom;
  const blackHeight = 0.27 - whiteBottom;

  let oledCanvas: HTMLCanvasElement | null = null;
  let oledTexture: CanvasTexture | null = null;

  for (const el of layout.elements) {
    const c = center(el);
    let node: Object3D;
    let material: MeshStandardMaterial | null = null;
    let baseY = 0;
    let pressDepth = 1;
    switch (el.shape) {
      case 'key-white':
      case 'key-black': {
        const white = el.shape === 'key-white';
        let g: BufferGeometry;
        if (white) {
          const x0 = el.rect.x;
          const x1 = el.rect.x + el.rect.w;
          const left = blacks.find((b) => b.rect.x < x0 && b.rect.x + b.rect.w > x0);
          const right = blacks.find((b) => b.rect.x < x1 && b.rect.x + b.rect.w > x1);
          const notchDepth = Math.max(...blacks.map((b) => b.rect.h)) * D + KEY_GAP / 2;
          const notchLeft = left ? (left.rect.x + left.rect.w - x0) * W : 0;
          const notchRight = right ? (x1 - right.rect.x) * W : 0;
          g = shared(`white:${notchLeft.toFixed(3)}:${notchRight.toFixed(3)}`, () =>
            whiteKeyGeometry({
              width: c.w - KEY_GAP,
              depth: c.d - 0.02,
              height: whiteHeight,
              notchLeft,
              notchRight,
              notchDepth,
            }),
          );
          material = mat(
            new MeshPhysicalMaterial({
              color: MPK_3D_COLORS.keyWhite,
              roughness: 0.3,
              clearcoat: 0.35,
              clearcoatRoughness: 0.35,
            }),
          );
        } else {
          g = shared('black', () => blackKeyGeometry(c.w - 0.02, c.d - 0.02, blackHeight));
          material = mat(
            new MeshPhysicalMaterial({
              color: MPK_3D_COLORS.keyBlack,
              roughness: 0.55,
              clearcoat: 0.12,
              clearcoatRoughness: 0.45,
              envMapIntensity: 0.35,
            }),
          );
        }
        const mesh = add(g, material, deck);
        mesh.name = el.controlId;
        // Pivot at the back edge so a press tips the front down.
        deck.remove(mesh);
        const pivot = new Group();
        pivot.position.set(c.x, whiteBottom, Z(el.rect.y) + 0.005);
        pivot.add(mesh);
        deck.add(pivot);
        byLayoutId.set(el.controlId, mesh);
        node = pivot;
        baseY = pivot.position.y;
        pressDepth = c.d;
        break;
      }
      case 'pad': {
        const size = Math.min(c.w, c.d) * 0.97;
        material = mat(
          new MeshStandardMaterial({ color: MPK_3D_COLORS.pad, roughness: 0.92, metalness: 0 }),
        );
        const mesh = add(
          shared(`pad:${size.toFixed(3)}`, () => padGeometry(size, 0.2)),
          material,
        );
        mesh.name = el.controlId;
        baseY = -0.03;
        mesh.position.set(c.x, baseY, c.z);
        byLayoutId.set(el.controlId, mesh);
        node = mesh;
        break;
      }
      case 'button': {
        const capD = el.rect.h * BUTTON_CAP_FRACTION * D;
        const cz = Z(el.rect.y + (el.rect.h * BUTTON_CAP_FRACTION) / 2);
        material = mat(new MeshStandardMaterial({ color: MPK_3D_COLORS.button, roughness: 0.88 }));
        const mesh = add(
          shared(`button:${c.w.toFixed(3)}:${capD.toFixed(3)}`, () =>
            buttonGeometry(c.w * 0.94, capD * 0.92, 0.13),
          ),
          material,
        );
        mesh.name = el.controlId;
        baseY = -0.02;
        mesh.position.set(c.x, baseY, cz);
        byLayoutId.set(el.controlId, mesh);
        node = mesh;
        break;
      }
      case 'knob': {
        const r = (Math.min(c.w, c.d) / 2) * 0.94;
        const h = 0.56;
        const group = new Group();
        group.name = el.controlId;
        group.position.set(c.x, 0, c.z);
        add(
          shared(`knob:${r.toFixed(3)}`, () => knobGeometry(r, h, 48)),
          knobMat,
          group,
        );
        // White pointer line, inset into the domed top.
        const pointer = add(
          shared('pointer', () => new BoxGeometry(1, 1, 1)),
          pointerMat,
          group,
          { cast: false },
        );
        pointer.scale.set(0.045, 0.03, r * 0.5);
        pointer.position.set(0, h * 0.975, -r * 0.42);
        pointer.rotation.x = -0.06;
        deck.add(group);
        byLayoutId.set(el.controlId, group);
        node = group;
        break;
      }
      case 'joystick': {
        const r = (Math.min(c.w, c.d) / 2) * 0.86;
        const well = add(geo(new CylinderGeometry(r * 1.2, r * 1.2, 0.02, 48)), darkMat, deck, {
          cast: false,
        });
        well.position.set(c.x, 0.005, c.z);
        const bootMat = mat(new MeshStandardMaterial({ color: '#0d0e11', roughness: 0.9 }));
        const boot = add(geo(joystickBootGeometry(r, 0.12)), bootMat);
        boot.position.set(c.x, 0, c.z);
        const tilt = new Group();
        tilt.name = el.controlId;
        tilt.position.set(c.x, 0.05, c.z);
        material = mat(
          new MeshStandardMaterial({ color: MPK_3D_COLORS.joystick, roughness: 0.86 }),
        );
        add(geo(joystickCapGeometry(r, 0.42)), material, tilt);
        deck.add(tilt);
        byLayoutId.set(el.controlId, tilt);
        node = tilt;
        break;
      }
      case 'display': {
        const bw = c.w + 0.14;
        const bd = c.d + 0.14;
        const border = 0.09;
        const bezel = add(geo(bezelGeometry(bw, bd, border, 0.05)), bezelMat, deck, {
          cast: false,
        });
        bezel.position.set(c.x, 0, c.z);
        const sw = bw - border * 2;
        const sd = bd - border * 2;
        oledCanvas = createCanvas(768, Math.round((768 * sd) / sw));
        drawOled(oledCanvas, OLED_IDLE_TEXT);
        oledTexture = new CanvasTexture(oledCanvas);
        oledTexture.colorSpace = SRGBColorSpace;
        oledTexture.anisotropy = 4;
        const screenMat = mat(
          new MeshStandardMaterial({
            color: '#000000',
            roughness: 0.12,
            emissive: '#ffffff',
            emissiveMap: oledTexture,
            emissiveIntensity: 1.15,
          }),
        );
        const screen = add(geo(new PlaneGeometry(sw, sd)), screenMat, deck, { cast: false });
        screen.rotation.x = -Math.PI / 2;
        screen.position.set(c.x, 0.012, c.z);
        screen.name = el.controlId;
        byLayoutId.set(el.controlId, screen);
        node = screen;
        break;
      }
    }
    animated.push({
      layoutId: el.controlId,
      shape: el.shape,
      node,
      material,
      pressAngle: KEY_DIP / Math.max(0.1, pressDepth),
      base: material ? material.color.clone() : new Color(),
      baseY,
      current: el.shape === 'joystick' ? 0.5 : 0,
      target: el.shape === 'joystick' ? 0.5 : 0,
      current2: 0,
      target2: 0,
      glow: new Color(MPK_3D_COLORS.accent),
    });
  }

  if (!oledCanvas || !oledTexture) {
    // Layouts without a display still expose a (blank) OLED texture.
    oledCanvas = createCanvas(4, 4);
    oledTexture = new CanvasTexture(oledCanvas);
  }
  const oled = { canvas: oledCanvas, texture: oledTexture, text: OLED_IDLE_TEXT };

  // --- Live state ------------------------------------------------------------------------
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
    const m = a.material;
    switch (a.shape) {
      case 'key-white':
      case 'key-black':
        a.node.rotation.x = v * a.pressAngle;
        if (m) {
          // White keys take on the accent; black keys glow it.
          m.color.copy(a.base).lerp(a.glow, a.shape === 'key-white' ? v * 0.65 : 0);
          m.emissive.copy(a.glow);
          m.emissiveIntensity = v * (a.shape === 'key-white' ? 0.15 : 0.9);
        }
        break;
      case 'pad':
        a.node.position.y = a.baseY - v * 0.05;
        if (m) {
          m.color.copy(a.base).lerp(a.glow, v * 0.5);
          m.emissive.copy(a.glow);
          m.emissiveIntensity = v * 1.5;
        }
        break;
      case 'button':
        a.node.position.y = a.baseY - v * 0.05;
        if (m) {
          m.emissive.copy(a.glow);
          m.emissiveIntensity = v * 0.35;
        }
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

  let triangles = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) triangles += triangleCount(o.geometry as BufferGeometry);
  });

  return {
    root,
    width: W,
    depth: D,
    byLayoutId,
    panelTexture,
    oledTexture: oled.texture,
    triangles,
    applyActivity,
    step,
    setOledText(text: string) {
      if (text === oled.text) return false;
      oled.text = text;
      drawOled(oled.canvas, text);
      oled.texture.needsUpdate = true;
      return true;
    },
    redrawPrint() {
      drawPanelPrint(printCanvas, layout);
      panelTexture.needsUpdate = true;
    },
    dispose() {
      for (const g of ownedGeometries) g.dispose();
      for (const m of ownedMaterials) m.dispose();
      panelTexture.dispose();
      oled.texture.dispose();
      root.clear();
    },
  };
}
