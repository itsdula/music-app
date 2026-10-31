/** Serialisers. CSS and canvas always receive `#rrggbb` or `#rrggbbaa` (lowercase). */
import { clamp01, rgbToOklch, type Rgb } from './convert';

const hex2 = (v: number): string =>
  Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');

/** `#rrggbb`, plus `aa` when alpha rounds below 255. */
export function formatHex(c: Rgb): string {
  const a = Math.round(clamp01(c.alpha) * 255);
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${a < 255 ? a.toString(16).padStart(2, '0') : ''}`;
}

/** `#rrggbb`, ignoring alpha. */
export const formatHex6 = (c: Rgb): string => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/** Rounds every channel to 8 bits, which is what CSS and canvas actually paint. */
export function quantize(c: Rgb): Rgb {
  const q = (v: number): number => Math.round(clamp01(v) * 255) / 255;
  return { r: q(c.r), g: q(c.g), b: q(c.b), alpha: q(c.alpha) };
}

const trim = (n: number, digits: number): string => String(Number(n.toFixed(digits)));

/** `oklch(L C H)` for display (L as 0..1). */
export function formatOklch(c: Rgb): string {
  const o = rgbToOklch(c);
  const alpha = c.alpha < 1 ? ` / ${trim(c.alpha, 3)}` : '';
  return `oklch(${trim(o.l, 4)} ${trim(o.c, 4)} ${trim(o.h, 2)}${alpha})`;
}

/** `hsl(H S% L%)` for the tweakcn round-trip. */
export function formatHsl(c: Rgb): string {
  const r = clamp01(c.r);
  const g = clamp01(c.g);
  const b = clamp01(c.b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const alpha = c.alpha < 1 ? ` / ${trim(c.alpha, 3)}` : '';
  return `hsl(${trim(h, 1)} ${trim(s * 100, 1)}% ${trim(l * 100, 1)}%${alpha})`;
}
