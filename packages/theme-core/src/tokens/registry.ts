/**
 * Token registry types. Every CSS custom property Studio emits is described by exactly one
 * {@link TokenDef}: its tier, kind, whether it differs per mode, how it is derived and which
 * contrast contract it must meet. The resolver, the CSS and canvas emitters, the JSON Schema
 * and the Appearance editor all read this one table.
 */

export type Mode = 'dark' | 'light';
export const MODES: readonly Mode[] = ['dark', 'light'];

export type TokenKind =
  'color' | 'length' | 'number' | 'font' | 'shadow' | 'duration' | 'easing' | 'string';

/** A value that is either the same in both modes or given per mode. */
export type Modal<T> = T | { readonly dark: T; readonly light: T };

/** Colour derivation expressions (evaluated in JS; CSS only ever sees literals). */
export type ColorExpr =
  /** A literal colour. */
  | { readonly op: 'lit'; readonly value: string }
  /** Another token, optionally at an alpha (`x@a`). */
  | { readonly op: 'ref'; readonly token: string; readonly alpha?: number }
  /** Neutral ramp stop `gamut(oklch(l, neutral.chroma·k, neutral.hue))`. */
  | { readonly op: 'n'; readonly l: number; readonly k: number }
  /** Best readable ink on a fill (on-fill foreground). */
  | { readonly op: 'on'; readonly token: string }
  /** `over(token@alpha, base)`: an opaque soft tint. */
  | { readonly op: 'soft'; readonly token: string; readonly alpha: number; readonly base: string }
  /** OKLCH lightness shift of a token; `by` is applied away from the surfaces (+dark, −light). */
  | { readonly op: 'shiftL'; readonly token: string; readonly by: number }
  /** OKLab mix of two tokens. */
  | { readonly op: 'mix'; readonly a: string; readonly b: string; readonly t: number }
  /** An entry of the resolved track palette. */
  | { readonly op: 'track'; readonly index: number };

/** One contrast requirement. `min` is the AA value; `contrast:'high'` raises it. */
export interface ContrastCheck {
  /** The token(s) the colour is checked against (each must pass). */
  readonly vs: readonly string[];
  readonly min: number;
  /**
   * Check against `over(tint@alpha, vs)` instead of `vs` itself. `tint` is a token name, or
   * `'self'` for the colour under test (for example `primary` text on a `primary/20` fill).
   */
  readonly tint?: { readonly token: string; readonly alpha: Modal<number> };
  /** Composite the colour under test at this alpha over `vs` first (focus rings). */
  readonly selfAlpha?: number;
  /** Only enforced when `options.contrast === 'high'` (borders and inputs). */
  readonly highOnly?: boolean;
}

export type FgKind = 'on-fill' | 'tint-text';

export type TokenTier = 'global' | `set:${string}`;

export type TokenGroup =
  | 'surfaces'
  | 'text'
  | 'brand'
  | 'status'
  | 'lines'
  | 'charts'
  | 'sidebar'
  | 'effects'
  | 'shape'
  | 'typography'
  | 'motion'
  | 'layout'
  | 'set';

/** Read-only view of the evaluation context for computed (non-colour) tokens. */
export interface ComputeContext {
  readonly mode: Mode;
  readonly seeds: ResolvedSeeds;
  /** The literal of another non-colour token (already evaluated). */
  str(token: string): string;
  /** A colour token at the given alpha (multiplied with its own), as `#rrggbbaa`. */
  colorAt(token: string, alpha: number): string;
}

export interface ResolvedSeeds {
  readonly radius: number;
  readonly spacing: number;
  readonly density: 'compact' | 'default' | 'comfortable';
  readonly textBase: number;
  readonly tracking: number;
  readonly fontSans: string;
  readonly fontMono: string;
  readonly fontSerif: string;
  readonly fontHeading: string;
  readonly motionScale: number;
  readonly elevation: 'flat' | 'subtle' | 'raised';
  readonly neutral: { readonly hue: number; readonly chroma: number };
}

export type SeedName = keyof ResolvedSeeds;

interface TokenDefBase {
  readonly name: string;
  readonly tier: TokenTier;
  readonly label: string;
  readonly group: TokenGroup;
  /** Mapped into Tailwind's `@theme inline` (`--color-<name>` etc.). */
  readonly utility?: boolean;
  /** Included in the canvas palette. */
  readonly canvas?: boolean;
}

export interface ColorTokenDef extends TokenDefBase {
  readonly kind: 'color';
  readonly modal: boolean;
  readonly derive: Modal<ColorExpr>;
  readonly contract?: readonly ContrastCheck[];
  readonly fg?: { readonly kind: FgKind; readonly of: string };
  /** Translucent values allowed in config (`#rrggbbaa`, rgba). */
  readonly allowAlpha?: boolean;
  /** When the contract still fails at L=0/1, fall back to pure black/white (on-fill only). */
  readonly fallbackBW?: boolean;
}

export interface ValueTokenDef extends TokenDefBase {
  readonly kind: Exclude<TokenKind, 'color'>;
  readonly modal: boolean;
  /** Literal default, or a computation over seeds and other non-colour tokens. */
  readonly derive: string | number | ((ctx: ComputeContext) => string | number);
  /** Tokens or seeds (`$radius`) this computation reads; drives the DAG and scope diffs. */
  readonly deps?: readonly string[];
  /** Inclusive range for numbers and px lengths a config may set. */
  readonly range?: readonly [number, number];
  /** Emitted only into CSS when true (default); `false` keeps it canvas/editor-only. */
  readonly css?: boolean;
}

export type TokenDef = ColorTokenDef | ValueTokenDef;

export const isColorToken = (t: TokenDef): t is ColorTokenDef => t.kind === 'color';

export const pickMode = <T>(value: Modal<T>, mode: Mode): T =>
  typeof value === 'object' && value !== null && 'dark' in value && 'light' in value
    ? (value as { dark: T; light: T })[mode]
    : (value as T);

/** Static dependencies of a token (other tokens, plus `$seed` pseudo-nodes). */
export function tokenDeps(def: TokenDef): string[] {
  const out = new Set<string>();
  if (isColorToken(def)) {
    for (const mode of MODES) {
      const e = pickMode(def.derive, mode);
      switch (e.op) {
        case 'ref':
        case 'on':
        case 'shiftL':
          out.add(e.token);
          break;
        case 'soft':
          out.add(e.token);
          out.add(e.base);
          break;
        case 'mix':
          out.add(e.a);
          out.add(e.b);
          break;
        case 'n':
          out.add('$neutral');
          break;
        case 'track':
          out.add('$trackPalette');
          break;
        case 'lit':
          break;
      }
    }
    for (const c of def.contract ?? []) {
      for (const v of c.vs) out.add(v);
      if (c.tint && c.tint.token !== 'self') out.add(c.tint.token);
    }
  } else {
    for (const d of def.deps ?? []) out.add(d);
  }
  out.delete(def.name);
  return [...out];
}

/** Human-readable formula, e.g. `= border · 70%`. */
export function describeDerivation(def: TokenDef, mode: Mode): string {
  if (!isColorToken(def)) {
    return typeof def.derive === 'function'
      ? `computed from ${(def.deps ?? []).join(', ')}`
      : String(def.derive);
  }
  const e = pickMode(def.derive, mode);
  switch (e.op) {
    case 'lit':
      return e.value;
    case 'ref':
      return e.alpha === undefined
        ? `= ${e.token}`
        : `= ${e.token} · ${Math.round(e.alpha * 100)}%`;
    case 'n':
      return `neutral L ${e.l} · chroma ×${e.k}`;
    case 'on':
      return `readable on ${e.token}`;
    case 'soft':
      return `${e.token} · ${Math.round(e.alpha * 100)}% over ${e.base}`;
    case 'shiftL':
      return `${e.token} ${e.by >= 0 ? 'lighter' : 'darker'} by ${Math.abs(e.by)}`;
    case 'mix':
      return `mix(${e.a}, ${e.b}, ${e.t})`;
    case 'track':
      return `track palette #${e.index + 1}`;
  }
}

// Small constructors keep the token tables readable.
export const lit = (value: string): ColorExpr => ({ op: 'lit', value });
export const ref = (token: string, alpha?: number): ColorExpr =>
  alpha === undefined ? { op: 'ref', token } : { op: 'ref', token, alpha };
export const n = (l: number, k: number): ColorExpr => ({ op: 'n', l, k });
export const on = (token: string): ColorExpr => ({ op: 'on', token });
export const modal = <T>(dark: T, light: T): { dark: T; light: T } => ({ dark, light });

/** Contract presets (§5.3). */
export const GRAPHIC_VS_BG: readonly ContrastCheck[] = [{ vs: ['background'], min: 3 }];
