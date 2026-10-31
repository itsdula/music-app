/** WCAG 2.x relative luminance and contrast ratio, plus an advisory APCA Lc. */
import { clamp01, toLinear, type Rgb } from './convert';

export const luminance = (c: Rgb): number =>
  0.2126 * toLinear(clamp01(c.r)) +
  0.7152 * toLinear(clamp01(c.g)) +
  0.0722 * toLinear(clamp01(c.b));

/** WCAG contrast ratio of two opaque colours (1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * APCA-W3 0.0.98G lightness contrast (Lc) of `text` on `bg`. Advisory only (never a gate).
 */
export function apcaContrast(text: Rgb, bg: Rgb): number {
  const y = (c: Rgb): number => {
    const v =
      0.2126729 * clamp01(c.r) ** 2.4 +
      0.7151522 * clamp01(c.g) ** 2.4 +
      0.072175 * clamp01(c.b) ** 2.4;
    return v < 0.022 ? v + (0.022 - v) ** 1.414 : v;
  };
  const yt = y(text);
  const yb = y(bg);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  if (yb > yt) {
    const s = (yb ** 0.56 - yt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (yb ** 0.65 - yt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}
