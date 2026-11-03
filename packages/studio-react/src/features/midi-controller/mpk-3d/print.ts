/**
 * Runtime-drawn 2D canvases for the 3D model: the printed top panel (legends, group outlines,
 * control wells) and the OLED screen. Mirrors the print of the 2D panel (mpk-panel); no
 * images, logos or wordmarks. Drawing is skipped quietly where no 2D context exists (jsdom).
 */
import type { DeviceLayout, DeviceLayoutElement } from '@studio/midi-core';
import { MPK_MINI_MK3_PANEL_LEGENDS } from '@studio/midi-akai-mpk-mini-mk3';

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement;

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const PRINT_FONT = '"Inter Variable", Inter, system-ui, -apple-system, sans-serif';
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Colours shared with the meshes so the print blends into the body. */
export const PRINT_COLORS = {
  body: '#17181c',
  well: '#0a0b0d',
  ink: '#e6e7eb',
  inkSoft: '#c9ccd4',
} as const;

/** Buttons each printed group outline surrounds (as in the 2D panel). */
const LEGEND_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'legend.arpeggiator': ['button.arpOnOff', 'button.tapTempo'],
  'legend.padControls': [
    'button.bankAB',
    'button.padCC',
    'button.padProgramChange',
    'button.programSelect',
  ],
};

/** Top of the white keys as a fraction of the panel depth. */
export function keysTop(layout: DeviceLayout): number {
  const whites = layout.elements.filter((e) => e.shape === 'key-white');
  return whites.length ? Math.min(...whites.map((e) => e.rect.y)) : 0.53;
}

/** Fraction of a button's rect taken by the cap (the legend is printed below it). */
export const BUTTON_CAP_FRACTION = 0.62;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Deterministic PRNG so the matte grain is identical on every draw. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draws the whole top panel (fractions 0..1 of the layout) onto `canvas`. Units `u` follow
 * the 2D panel's 1000-wide viewBox so sizes match the SVG drawing.
 */
export function drawPanelPrint(canvas: HTMLCanvasElement, layout: DeviceLayout): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const u = cw / 1000;
  const px = (el: DeviceLayoutElement) => ({
    x: el.rect.x * cw,
    y: el.rect.y * ch,
    w: el.rect.w * cw,
    h: el.rect.h * ch,
  });
  const font = (size: number, weight = 600) => `${weight} ${size * u}px ${PRINT_FONT}`;
  const text = (
    s: string,
    x: number,
    y: number,
    size: number,
    { align = 'center', color = PRINT_COLORS.ink, weight = 600, spacing = 0.4 } = {} as {
      align?: CanvasTextAlign;
      color?: string;
      weight?: number;
      spacing?: number;
    },
  ) => {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.letterSpacing = `${spacing * u}px`;
    ctx.fillText(s, x, y);
    ctx.letterSpacing = '0px';
  };

  // Matte body with fine grain and a soft top-light gradient.
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#1b1c21');
  grad.addColorStop(1, PRINT_COLORS.body);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
  const rand = mulberry32(7);
  for (let i = 0; i < 26_000; i++) {
    const v = rand();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.12)';
    ctx.fillRect(rand() * cw, rand() * ch, 1.6, 1.6);
  }

  // Wells the rubber parts sit in (read as shallow recesses with a soft inner shadow).
  const well = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = PRINT_COLORS.well;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1.2 * u;
    roundRect(ctx, x, y + 0.8 * u, w, h, r);
    ctx.stroke();
    ctx.restore();
  };

  for (const el of layout.elements) {
    const r = px(el);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    switch (el.shape) {
      case 'pad':
        well(r.x - 4 * u, r.y - 4 * u, r.w + 8 * u, r.h + 8 * u, 9 * u);
        if (el.legend)
          text(el.legend, r.x + 2 * u, r.y - 9 * u, 8, { align: 'left', spacing: 0.6 });
        break;
      case 'button': {
        const capH = r.h * BUTTON_CAP_FRACTION;
        well(r.x - 2.5 * u, r.y - 2.5 * u, r.w + 5 * u, capH + 5 * u, 5 * u);
        if (el.legend) {
          const size = el.legend.length > 9 ? 5.4 : 6.6;
          text(el.legend, cx, r.y + capH + 10 * u, size, { color: '#d3d6dd', spacing: 0.3 });
        }
        break;
      }
      case 'knob': {
        const rr = Math.min(r.w, r.h) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 1.04, 0, Math.PI * 2);
        ctx.fillStyle = PRINT_COLORS.well;
        ctx.fill();
        // Value scale ticks around the knob (-135°..+135°).
        ctx.strokeStyle = 'rgba(201,204,212,0.45)';
        ctx.lineWidth = 1.2 * u;
        for (let i = 0; i <= 10; i++) {
          const a = ((-135 + i * 27) * Math.PI) / 180;
          const r0 = rr * 1.12;
          const r1 = rr * (i % 5 === 0 ? 1.24 : 1.19);
          ctx.beginPath();
          ctx.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0);
          ctx.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
          ctx.stroke();
        }
        // Outlined label pill under the knob.
        const pw = 26 * u;
        const ph = 12 * u;
        const py = r.y + r.h + 6 * u;
        roundRect(ctx, cx - pw / 2, py, pw, ph, 3 * u);
        ctx.strokeStyle = 'rgba(201,204,212,0.65)';
        ctx.lineWidth = 1.1 * u;
        ctx.stroke();
        if (el.legend) text(el.legend, cx, py + 9 * u, 8, { weight: 700, spacing: 0.3 });
        break;
      }
      case 'joystick': {
        const rr = Math.min(r.w, r.h) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rr + 3 * u, 0, Math.PI * 2);
        ctx.fillStyle = '#060608';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1.5 * u;
        ctx.stroke();
        break;
      }
      case 'display':
        well(r.x - 6 * u, r.y - 6 * u, r.w + 12 * u, r.h + 12 * u, 6 * u);
        break;
      default:
        break;
    }
  }

  // Printed group outlines with knocked-out titles.
  for (const legend of MPK_MINI_MK3_PANEL_LEGENDS) {
    const members = layout.elements.filter((e) => LEGEND_GROUPS[legend.id]?.includes(e.controlId));
    let x = legend.rect.x * cw;
    let y = legend.rect.y * ch;
    let w = legend.rect.w * cw;
    let h = legend.rect.h * ch;
    if (members.length) {
      const x0 = Math.min(...members.map((e) => e.rect.x)) * cw - 7 * u;
      const y0 = Math.min(...members.map((e) => e.rect.y)) * ch - 9 * u;
      const x1 = Math.max(...members.map((e) => e.rect.x + e.rect.w)) * cw + 7 * u;
      const y1 = Math.max(...members.map((e) => e.rect.y + e.rect.h)) * ch + 6 * u;
      [x, y, w, h] = [x0, y0, x1 - x0, y1 - y0];
    }
    roundRect(ctx, x, y, w, h, 5 * u);
    ctx.strokeStyle = 'rgba(217,219,226,0.75)';
    ctx.lineWidth = 1.3 * u;
    ctx.stroke();
    ctx.font = font(9.5);
    ctx.letterSpacing = `${1.4 * u}px`;
    const tw = ctx.measureText(legend.text).width + 10 * u;
    ctx.letterSpacing = '0px';
    ctx.fillStyle = PRINT_COLORS.body;
    ctx.fillRect(x + w / 2 - tw / 2, y - 6 * u, tw, 12 * u);
    text(legend.text, x + w / 2, y + 3.5 * u, 9.5, { spacing: 1.4 });
  }

  // Key legends printed above the keybed (staggered: black-key legends sit higher).
  const top = keysTop(layout) * ch;
  for (const el of layout.elements) {
    if (!el.shape.startsWith('key') || !el.secondaryLegend) continue;
    const r = px(el);
    const black = el.shape === 'key-black';
    text(el.secondaryLegend, r.x + r.w / 2, top - (black ? 25 : 14) * u, 7, {
      color: PRINT_COLORS.inkSoft,
      spacing: 0.3,
    });
  }
}

/** Fits `s` into `maxWidth` with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, s: string, maxWidth: number): string {
  if (ctx.measureText(s).width <= maxWidth) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${s.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}…`;
}

/** Draws the OLED screen: purple-tinted glass, a status line and the last MIDI message. */
export function drawOled(canvas: HTMLCanvasElement, message: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#2a2368');
  bg.addColorStop(1, '#17133f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // Faint pixel grid.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(0, 0, w, h * 0.42);

  const pad = w * 0.05;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${h * 0.17}px ${MONO_FONT}`;
  ctx.fillStyle = 'rgba(214,208,255,0.6)';
  ctx.fillText('MIDI', pad, h * 0.24);
  ctx.fillRect(pad, h * 0.38, w - pad * 2, Math.max(1, h * 0.012));

  ctx.textAlign = 'left';
  ctx.font = `500 ${h * 0.22}px ${MONO_FONT}`;
  ctx.fillStyle = '#e4dfff';
  ctx.shadowColor = 'rgba(163,151,255,0.9)';
  ctx.shadowBlur = h * 0.06;
  ctx.fillText(fit(ctx, message, w - pad * 2), pad, h * 0.66);
  ctx.shadowBlur = 0;
}
