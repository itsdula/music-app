/** Colour operations used by token derivations. */
import { clipRgb, gamutMapOklch } from './gamut';
import {
  clamp01,
  oklabToOklch,
  oklabToRgbUnclamped,
  rgbToOklab,
  rgbToOklch,
  type Oklch,
  type Rgb,
} from './convert';

export const withAlpha = (c: Rgb, alpha: number): Rgb => ({ ...c, alpha: clamp01(alpha) });

/** Composites `fg` (with its alpha) over an opaque `bg` in gamma sRGB, as browsers do. */
export function over(fg: Rgb, bg: Rgb): Rgb {
  const a = clamp01(fg.alpha);
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    alpha: 1,
  };
}

/** `color-mix(in oklab, a (1-t), b t)` for opaque inputs. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  const lab = {
    l: x.l + (y.l - x.l) * t,
    a: x.a + (y.a - x.a) * t,
    b: x.b + (y.b - x.b) * t,
    alpha: a.alpha + (b.alpha - a.alpha) * t,
  };
  const direct = oklabToRgbUnclamped(lab);
  return direct.r >= 0 &&
    direct.r <= 1 &&
    direct.g >= 0 &&
    direct.g <= 1 &&
    direct.b >= 0 &&
    direct.b <= 1
    ? direct
    : gamutMapOklch(oklabToOklch(lab));
}

/** Shifts OKLCH lightness by `delta`, keeping hue and chroma (gamut-mapped). */
export function shiftL(c: Rgb, delta: number): Rgb {
  const o = rgbToOklch(c);
  return gamutMapOklch({ ...o, l: clamp01(o.l + delta) });
}

/** Builds an sRGB colour from OKLCH (gamut-mapped). */
export const fromOklch = (l: number, c: number, h: number, alpha = 1): Rgb =>
  gamutMapOklch({ l, c, h, alpha });

export const toOklch = (c: Rgb): Oklch => rgbToOklch(c);

/** ΔE_OK: Euclidean distance in OKLab. */
export function deltaEOK(a: Rgb, b: Rgb): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

export const clip = clipRgb;
