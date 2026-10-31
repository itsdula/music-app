/** Constructors for component-set tokens (`--<set>-<role>`, registry names kept as-is). */
import type { ColorExpr, ColorTokenDef, ContrastCheck, Modal, ValueTokenDef } from '../registry';

export interface SetColorExtra {
  readonly contract?: readonly ContrastCheck[];
  readonly canvas?: boolean;
  readonly utility?: boolean;
  /** Mode-independent (a physical material, e.g. piano keys or the MPK body). */
  readonly invariant?: boolean;
  readonly label?: string;
  readonly fg?: ColorTokenDef['fg'];
}

export const setColor =
  (set: string, defaults: { canvas?: boolean; utility?: boolean } = {}) =>
  (name: string, derive: Modal<ColorExpr>, extra: SetColorExtra = {}): ColorTokenDef => ({
    name,
    tier: `set:${set}`,
    kind: 'color',
    modal: !extra.invariant,
    group: 'set',
    label: extra.label ?? name.replace(/-/g, ' '),
    derive,
    allowAlpha: true,
    ...(extra.contract ? { contract: extra.contract } : {}),
    ...(extra.fg ? { fg: extra.fg } : {}),
    canvas: extra.canvas ?? defaults.canvas ?? false,
    utility: extra.utility ?? defaults.utility ?? false,
  });

export const setValue =
  (set: string, defaults: { canvas?: boolean } = {}) =>
  (
    name: string,
    kind: ValueTokenDef['kind'],
    derive: ValueTokenDef['derive'],
    extra: Partial<Pick<ValueTokenDef, 'range' | 'deps' | 'canvas' | 'label' | 'css'>> = {},
  ): ValueTokenDef => ({
    name,
    tier: `set:${set}`,
    kind,
    modal: false,
    group: 'set',
    label: extra.label ?? name.replace(/-/g, ' '),
    derive,
    canvas: extra.canvas ?? defaults.canvas ?? false,
    ...(extra.range ? { range: extra.range } : {}),
    ...(extra.deps ? { deps: extra.deps } : {}),
    ...(extra.css === undefined ? {} : { css: extra.css }),
  });
