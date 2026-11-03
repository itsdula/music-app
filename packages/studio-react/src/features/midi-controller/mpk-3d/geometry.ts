/** Procedural part geometries for the MPK Mini MK3 model (all built from primitives). */
import {
  type BufferGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Path,
  Shape,
  Vector2,
  type BufferAttribute,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

function positions(g: BufferGeometry): BufferAttribute {
  return g.getAttribute('position') as BufferAttribute;
}

/**
 * Extrudes a side profile (points as [z, y] in world units, any winding) along X with a
 * bevel, so its outer surface matches the profile exactly. Centred on x = 0.
 */
export function sideProfileSlab(
  profile: ReadonlyArray<readonly [number, number]>,
  width: number,
  bevel: number,
): BufferGeometry {
  // Shrink the profile by the bevel so the bevelled surface lands on the given outline.
  const cz = profile.reduce((s, p) => s + p[0], 0) / profile.length;
  const cy = profile.reduce((s, p) => s + p[1], 0) / profile.length;
  const shape = new Shape();
  profile.forEach(([z, y], i) => {
    const dz = Math.sign(z - cz) * bevel;
    const dy = Math.sign(y - cy) * bevel;
    // Shape x = -z (rotateY(+90°) maps shape x to world -z).
    const sx = -(z - dz);
    const sy = y - dy;
    if (i === 0) shape.moveTo(sx, sy);
    else shape.lineTo(sx, sy);
  });
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, width - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 4,
    curveSegments: 4,
  });
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}

/**
 * A white key seen from above: full width at the front, narrowed at the back where black
 * keys sit (`notchLeft/Right` are the back-part insets), rounded front corners, bevelled
 * edges. Local origin: back edge centre, bottom; extends to +z (front) and +y (up).
 */
export function whiteKeyGeometry(opts: {
  width: number;
  depth: number;
  height: number;
  notchLeft: number;
  notchRight: number;
  notchDepth: number;
}): BufferGeometry {
  const bev = 0.022;
  const w = opts.width / 2 - bev;
  const d = opts.depth - bev;
  const nl = opts.notchLeft;
  const nr = opts.notchRight;
  const nd = opts.notchDepth;
  const rc = 0.06;
  const s = new Shape();
  // Shape y = -z (rotateX(-90°) maps shape y to world -z).
  s.moveTo(-w + nl, -bev);
  s.lineTo(w - nr, -bev);
  if (nr > 0) {
    s.lineTo(w - nr, -nd);
    s.lineTo(w, -nd);
  }
  s.lineTo(w, -(d - rc));
  s.quadraticCurveTo(w, -d, w - rc, -d);
  s.lineTo(-w + rc, -d);
  s.quadraticCurveTo(-w, -d, -w, -(d - rc));
  if (nl > 0) {
    s.lineTo(-w, -nd);
    s.lineTo(-w + nl, -nd);
  }
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth: opts.height - bev * 2,
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: 3,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bev, 0);
  return g;
}

/** A black key: bevelled, tapered towards the top (narrower and shorter at the front). */
export function blackKeyGeometry(width: number, depth: number, height: number): BufferGeometry {
  const g = new RoundedBoxGeometry(width, height, depth, 3, 0.03);
  const pos = positions(g);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + height / 2) / height;
    pos.setX(i, pos.getX(i) * (1 - 0.2 * t));
    const z = pos.getZ(i);
    // Pull the front face back at the top (sloped front), keep the back flush.
    const front = (z + depth / 2) / depth;
    pos.setZ(i, z - 0.14 * t * front);
  }
  g.computeVertexNormals();
  // Local origin: back edge centre, bottom.
  g.translate(0, height / 2, depth / 2);
  return g;
}

/** A soft rubber pad: rounded block with a slightly domed top. Origin at its base centre. */
export function padGeometry(size: number, height: number): BufferGeometry {
  const g = new RoundedBoxGeometry(size, height, size, 6, 0.075);
  const pos = positions(g);
  const half = size / 2;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < height / 2 - 0.08) continue;
    const r2 = (pos.getX(i) ** 2 + pos.getZ(i) ** 2) / (half * half * 2);
    pos.setY(i, y + 0.03 * Math.max(0, 1 - r2));
  }
  g.computeVertexNormals();
  g.translate(0, height / 2, 0);
  return g;
}

/** A small bevelled rubber button cap. Origin at its base centre. */
export function buttonGeometry(width: number, depth: number, height: number): BufferGeometry {
  const g = new RoundedBoxGeometry(width, height, depth, 4, Math.min(0.05, height * 0.45));
  g.translate(0, height / 2, 0);
  return g;
}

/**
 * Knurled knob: lathe profile with a base flange, a knurled grip and a domed top; the
 * knurling is a radial displacement of the grip band. Origin at its base centre.
 */
export function knobGeometry(radius: number, height: number, ridges = 48): BufferGeometry {
  const R = radius;
  const h = height;
  const profile = [
    [0.98, 0],
    [0.98, 0.07],
    [0.9, 0.1],
    [0.84, 0.16],
    [0.84, 0.8],
    [0.8, 0.86],
    [0.74, 0.9],
    [0.55, 0.95],
    [0.3, 0.985],
    [0, 1],
  ].map(([r = 0, y = 0]) => new Vector2(r * R, y * h));
  const segments = ridges * 4;
  const g = new LatheGeometry(profile, segments);
  const pos = positions(g);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h;
    if (y < 0.15 || y > 0.81) continue;
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(x, z);
    const k = 1 + 0.055 * (0.5 + 0.5 * Math.cos(phi * ridges));
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Rubber joystick cap: rounded puck with a shallow dimple on top. Origin at its base. */
export function joystickCapGeometry(radius: number, height: number): BufferGeometry {
  const R = radius;
  const h = height;
  const profile = [
    [0.92, 0],
    [1, 0.12],
    [1, 0.7],
    [0.96, 0.86],
    [0.86, 0.96],
    [0.72, 1],
    [0.5, 0.97],
    [0.25, 0.93],
    [0, 0.92],
  ].map(([r = 0, y = 0]) => new Vector2(r * R, y * h));
  const g = new LatheGeometry(profile, 64);
  g.computeVertexNormals();
  return g;
}

/** Joystick boot: a low rubber collar the cap rises from. Origin at its base. */
export function joystickBootGeometry(radius: number, height: number): BufferGeometry {
  const profile = [
    [1.12, 0],
    [1.1, 0.4],
    [1.02, 0.85],
    [0.92, 1],
    [0.8, 1],
  ].map(([r = 0, y = 0]) => new Vector2(r * radius, y * height));
  return new LatheGeometry(profile, 64);
}

/** A flat rounded-rectangle frame (bezel) of the given outer size and border. */
export function bezelGeometry(
  width: number,
  depth: number,
  border: number,
  height: number,
): BufferGeometry {
  const rect = (path: Path, w: number, d: number, r: number) => {
    path.moveTo(-w / 2 + r, -d / 2);
    path.lineTo(w / 2 - r, -d / 2);
    path.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
    path.lineTo(w / 2, d / 2 - r);
    path.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
    path.lineTo(-w / 2 + r, d / 2);
    path.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
    path.lineTo(-w / 2, -d / 2 + r);
    path.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  };
  const outer = new Shape();
  rect(outer, width, depth, 0.06);
  const hole = new Path();
  rect(hole, width - border * 2, depth - border * 2, 0.03);
  outer.holes.push(hole);
  const g = new ExtrudeGeometry(outer, {
    depth: height - 0.02,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.01, 0);
  return g;
}

/** Triangle count of a geometry (indexed or not). */
export function triangleCount(g: BufferGeometry): number {
  const index = g.getIndex();
  return (index ? index.count : positions(g).count) / 3;
}
