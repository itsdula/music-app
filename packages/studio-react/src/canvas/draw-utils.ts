/** Small canvas drawing helpers shared by renderers. */
import { colors } from '@studio/ui';

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** Parses #RRGGBB into an rgba() string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Mixes a colour towards white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1]!, 16);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.min(1, Math.abs(amount));
  const ch = (shift: number) =>
    Math.round(((n >> shift) & 255) + (target - ((n >> shift) & 255)) * t);
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Crisp 1px line at a fractional coordinate. */
export function vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number): void {
  const px = Math.round(x) + 0.5;
  ctx.beginPath();
  ctx.moveTo(px, y0);
  ctx.lineTo(px, y1);
  ctx.stroke();
}

export function hline(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number): void {
  const py = Math.round(y) + 0.5;
  ctx.beginPath();
  ctx.moveTo(x0, py);
  ctx.lineTo(x1, py);
  ctx.stroke();
}

export const canvasFont = (sizePx: number, weight = 500) =>
  `${weight} ${sizePx}px "Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif`;

export const palette = colors;

export function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  x: number,
  height: number,
  recording: boolean,
): void {
  ctx.strokeStyle = recording ? colors.record : colors.text;
  ctx.lineWidth = 1;
  vline(ctx, x, 0, height);
}
