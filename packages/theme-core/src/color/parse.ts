/**
 * Colour parser for the ThemeConfig grammar: hex (3/4/6/8), rgb()/rgba(), hsl()/hsla(),
 * oklch(), oklab(), `black`/`white`/`transparent` and, on import only, the legacy shadcn v3
 * `H S% L%` triple. Every value is re-serialised from its parsed form, so nothing a user
 * typed is ever interpolated into CSS.
 */
import { clamp01, oklabToOklch, type Rgb } from './convert';
import { gamutMapOklch } from './gamut';

export const MAX_COLOR_LENGTH = 64;

export interface ParseColorOptions {
  /** Accept the bare `H S% L%` triple (shadcn v3 / tweakcn legacy). */
  readonly legacyHsl?: boolean;
}

const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?';
const numRe = new RegExp(`^${NUM}$`, 'i');

function parseNumber(token: string, percentScale?: number): number | null {
  const pct = token.endsWith('%');
  const raw = pct ? token.slice(0, -1) : token;
  if (!numRe.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (pct) return percentScale === undefined ? null : (n / 100) * percentScale;
  return n;
}

function parseAngle(token: string): number | null {
  const m = /^(.*?)(deg|turn|rad|grad)?$/i.exec(token);
  if (!m?.[1]) return null;
  const n = parseNumber(m[1]);
  if (n === null) return null;
  const unit = (m[2] ?? 'deg').toLowerCase();
  const deg =
    unit === 'turn'
      ? n * 360
      : unit === 'rad'
        ? (n * 180) / Math.PI
        : unit === 'grad'
          ? n * 0.9
          : n;
  return ((deg % 360) + 360) % 360;
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const n = parseNumber(token, 1);
  return n === null ? null : clamp01(n);
}

/** Splits `a b c / d` or `a, b, c, d` into channel tokens and an optional alpha token. */
function splitArgs(body: string): { channels: string[]; alpha?: string } | null {
  const trimmed = body.trim();
  if (trimmed.includes(',')) {
    const parts = trimmed.split(',').map((p) => p.trim());
    if (parts.some((p) => p === '' || /\s/.test(p))) return null;
    if (parts.length === 3) return { channels: parts };
    if (parts.length === 4) return { channels: parts.slice(0, 3), alpha: parts[3] };
    return null;
  }
  const [main, alpha, ...rest] = trimmed.split('/');
  if (rest.length > 0 || main === undefined) return null;
  const channels = main.trim().split(/\s+/);
  if (channels.length !== 3) return null;
  const a = alpha?.trim();
  if (alpha !== undefined && (!a || /\s/.test(a))) return null;
  return a === undefined ? { channels } : { channels, alpha: a };
}

function hslToRgb(h: number, s: number, l: number, alpha: number): Rgb {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0), g: f(8), b: f(4), alpha };
}

function parseHex(s: string): Rgb | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('');
  const v = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: v(0), g: v(2), b: v(4), alpha: h.length === 8 ? v(6) : 1 };
}

function parseFn(name: string, body: string): Rgb | null {
  const args = splitArgs(body);
  if (!args) return null;
  const alpha = parseAlpha(args.alpha);
  if (alpha === null) return null;
  const [c0, c1, c2] = args.channels as [string, string, string];
  switch (name) {
    case 'rgb':
    case 'rgba': {
      const ch = [c0, c1, c2].map((t) => parseNumber(t, 255));
      if (ch.some((v) => v === null)) return null;
      const [r, g, b] = ch as [number, number, number];
      return { r: clamp01(r / 255), g: clamp01(g / 255), b: clamp01(b / 255), alpha };
    }
    case 'hsl':
    case 'hsla': {
      const h = parseAngle(c0);
      const s = parseNumber(c1, 100);
      const l = parseNumber(c2, 100);
      if (h === null || s === null || l === null) return null;
      return hslToRgb(h, clamp01(s / 100), clamp01(l / 100), alpha);
    }
    case 'oklch': {
      const l = parseNumber(c0, 1);
      const c = parseNumber(c1, 0.4);
      const h = c2 === 'none' ? 0 : parseAngle(c2);
      if (l === null || c === null || h === null) return null;
      return gamutMapOklch({ l: clamp01(l), c: Math.max(0, c), h, alpha });
    }
    case 'oklab': {
      const l = parseNumber(c0, 1);
      const a = parseNumber(c1, 0.4);
      const b = parseNumber(c2, 0.4);
      if (l === null || a === null || b === null) return null;
      return gamutMapOklch(oklabToOklch({ l: clamp01(l), a, b, alpha }));
    }
    default:
      return null;
  }
}

/** Parses a colour, or returns `null`. Never throws. */
export function parseColor(input: string, options: ParseColorOptions = {}): Rgb | null {
  if (typeof input !== 'string' || input.length > MAX_COLOR_LENGTH) return null;
  const s = input.trim().toLowerCase();
  if (s === 'black') return { r: 0, g: 0, b: 0, alpha: 1 };
  if (s === 'white') return { r: 1, g: 1, b: 1, alpha: 1 };
  if (s === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  if (s.startsWith('#')) return parseHex(s);
  const fn = /^([a-z]+)\(([^()]*)\)$/.exec(s);
  if (fn?.[1] !== undefined && fn[2] !== undefined) return parseFn(fn[1], fn[2]);
  if (options.legacyHsl) {
    const m = /^(\S+)\s+(\S+%)\s+(\S+%)(?:\s*\/\s*(\S+))?$/.exec(s);
    if (m?.[1] && m[2] && m[3])
      return parseFn('hsl', `${m[1]} ${m[2]} ${m[3]}${m[4] ? ` / ${m[4]}` : ''}`);
  }
  return null;
}

/** `var(--name)` reference (import only), or `null`. */
export function parseVarRef(input: string): string | null {
  const m = /^var\(\s*--([a-z0-9-]{1,64})\s*\)$/i.exec(input.trim());
  return m?.[1]?.toLowerCase() ?? null;
}
