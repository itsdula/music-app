/**
 * Colour space conversions: sRGB (gamma encoded, 0..1) <-> linear sRGB <-> OKLab <-> OKLCH,
 * using Björn Ottosson's published matrices. Pure arithmetic, no allocation beyond results.
 */

/** sRGB colour with gamma-encoded channels in 0..1 and alpha in 0..1. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
}

export interface Oklab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
  readonly alpha: number;
}

/** OKLCH; `h` in degrees 0..360 (0 for achromatic colours). */
export interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export const toLinear = (c: number): number =>
  Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;

export const fromLinear = (c: number): number =>
  Math.abs(c) <= 0.0031308 ? 12.92 * c : Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055);

export function linearRgbToOklab(r: number, g: number, b: number, alpha = 1): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  };
}

/** OKLab to linear sRGB; channels may fall outside 0..1 (out of gamut). */
export function oklabToLinearRgb(lab: Oklab): [number, number, number] {
  const l_ = lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b;
  const m_ = lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b;
  const s_ = lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export const rgbToOklab = (c: Rgb): Oklab =>
  linearRgbToOklab(toLinear(c.r), toLinear(c.g), toLinear(c.b), c.alpha);

/** OKLab to sRGB without gamut mapping (channels may be outside 0..1). */
export function oklabToRgbUnclamped(lab: Oklab): Rgb {
  const [r, g, b] = oklabToLinearRgb(lab);
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(b), alpha: lab.alpha };
}

export function oklabToOklch(lab: Oklab): Oklch {
  const c = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h: c < 1e-7 ? 0 : h, alpha: lab.alpha };
}

export function oklchToOklab(lch: Oklch): Oklab {
  const rad = (lch.h * Math.PI) / 180;
  return { l: lch.l, a: lch.c * Math.cos(rad), b: lch.c * Math.sin(rad), alpha: lch.alpha };
}

export const rgbToOklch = (c: Rgb): Oklch => oklabToOklch(rgbToOklab(c));
