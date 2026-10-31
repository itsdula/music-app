/**
 * Gamut mapping to sRGB following CSS Color 4: keep OKLCH lightness and hue, bisect chroma
 * until the clipped colour is within a just-noticeable difference (ΔE_OK 0.02), then clip.
 */
import {
  clamp01,
  oklabToRgbUnclamped,
  oklchToOklab,
  rgbToOklab,
  type Oklch,
  type Rgb,
} from './convert';

const JND = 0.02;
const EPS = 1e-6;

const inGamut = (c: Rgb): boolean =>
  c.r >= -EPS && c.r <= 1 + EPS && c.g >= -EPS && c.g <= 1 + EPS && c.b >= -EPS && c.b <= 1 + EPS;

const clip = (c: Rgb): Rgb => ({
  r: clamp01(c.r),
  g: clamp01(c.g),
  b: clamp01(c.b),
  alpha: clamp01(c.alpha),
});

function deltaE(a: Rgb, b: Rgb): number {
  const x = rgbToOklab(a);
  const y = rgbToOklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/** Maps an OKLCH colour into sRGB (CSS Color 4 algorithm). */
export function gamutMapOklch(lch: Oklch): Rgb {
  if (lch.l >= 1) return { r: 1, g: 1, b: 1, alpha: lch.alpha };
  if (lch.l <= 0) return { r: 0, g: 0, b: 0, alpha: lch.alpha };
  const direct = oklabToRgbUnclamped(oklchToOklab(lch));
  if (inGamut(direct)) return clip(direct);
  let lo = 0;
  let hi = lch.c;
  let best = clip(direct);
  for (let i = 0; i < 24 && hi - lo > 1e-5; i++) {
    const mid = (lo + hi) / 2;
    const cand = oklabToRgbUnclamped(oklchToOklab({ ...lch, c: mid }));
    if (inGamut(cand)) {
      lo = mid;
      best = clip(cand);
      continue;
    }
    const clipped = clip(cand);
    if (deltaE(clipped, cand) < JND) {
      best = clipped;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** Clips an sRGB colour that may hold out-of-range channels. */
export const clipRgb = clip;
