/**
 * Global tier (§3.3, §3.4): shadcn/tweakcn names plus the names the audio registries use.
 * Dark values reproduce today's palette exactly; light values come from the same ramp.
 */
import {
  GRAPHIC_VS_BG,
  lit,
  modal,
  n,
  on,
  ref,
  type ColorExpr,
  type ColorTokenDef,
  type ContrastCheck,
  type TokenDef,
  type TokenGroup,
  type ValueTokenDef,
} from './registry';

export const DEFAULT_TRACK_PALETTE = [
  '#8B7CF6',
  '#5EA8FF',
  '#3CC8B4',
  '#7BD66B',
  '#F2C14E',
  '#F59152',
  '#F16D75',
  '#E57BD3',
] as const;

const SURFACES = ['background', 'card', 'popover', 'secondary', 'muted', 'accent'];

const c = (
  name: string,
  group: TokenGroup,
  derive: ColorTokenDef['derive'],
  extra: Partial<Omit<ColorTokenDef, 'name' | 'derive' | 'kind'>> = {},
): ColorTokenDef => ({
  name,
  tier: 'global',
  kind: 'color',
  modal: true,
  group,
  label: extra.label ?? name.replace(/-/g, ' '),
  derive,
  utility: true,
  canvas: true,
  ...extra,
});

/** Brand-class text colours: primary, destructive, record, primary-strong. */
const brandContract = (alphaTint = true): ContrastCheck[] => [
  { vs: ['background', 'card'], min: 4.5 },
  { vs: ['muted'], min: 3 },
  ...(alphaTint
    ? [{ vs: ['background'], min: 4.5, tint: { token: 'self', alpha: modal(0.2, 0.1) } }]
    : []),
];

const tintText = (of: string, soft: string): ContrastCheck[] => [
  { vs: ['background'], min: 4.5 },
  { vs: ['background'], min: 4.5, tint: { token: of, alpha: 0.15 } },
  { vs: [soft], min: 4.5 },
];

const soft = (token: string): ColorExpr => ({ op: 'soft', token, alpha: 0.16, base: 'card' });

/** A status/brand family: X, X-foreground (kind), X-soft, X-soft-foreground. */
function family(
  name: string,
  derive: ColorExpr,
  fgKind: 'on-fill' | 'tint-text',
  contract: readonly ContrastCheck[],
  group: TokenGroup,
): ColorTokenDef[] {
  const out: ColorTokenDef[] = [
    c(name, group, derive, { contract }),
    fgKind === 'on-fill'
      ? c(`${name}-foreground`, group, on(name), {
          fg: { kind: 'on-fill', of: name },
          contract: [{ vs: [name], min: 4.5 }],
          fallbackBW: true,
        })
      : c(`${name}-foreground`, group, ref(name), {
          fg: { kind: 'tint-text', of: name },
          contract: tintText(name, `${name}-soft`),
        }),
    c(`${name}-soft`, group, soft(name)),
    c(`${name}-soft-foreground`, group, ref(name), {
      fg: { kind: 'tint-text', of: `${name}-soft` },
      contract: tintText(name, `${name}-soft`),
    }),
  ];
  if (fgKind === 'tint-text') {
    out.push(
      c(`on-${name}`, group, on(name), {
        fg: { kind: 'on-fill', of: name },
        contract: [{ vs: [name], min: 4.5 }],
        fallbackBW: true,
      }),
    );
  }
  return out;
}

const onFill = (
  name: string,
  fill: string,
  group: TokenGroup,
  derive: ColorExpr = ref('foreground'),
) => c(name, group, derive, { fg: { kind: 'on-fill', of: fill } });

export const GLOBAL_COLOR_DEFS: readonly ColorTokenDef[] = [
  // Surfaces (neutral ramp)
  c('background', 'surfaces', modal(n(0.187, 0.55), n(0.975, 0.2))),
  c('foreground', 'text', modal(n(0.964, 0.15), n(0.205, 0.6)), {
    contract: [{ vs: SURFACES, min: 7 }],
  }),
  c('card', 'surfaces', modal(n(0.226, 0.7), n(0.99, 0.15))),
  onFill('card-foreground', 'card', 'surfaces'),
  c('popover', 'surfaces', modal(n(0.269, 1), n(1, 0))),
  onFill('popover-foreground', 'popover', 'surfaces'),
  c('secondary', 'surfaces', modal(n(0.269, 1), n(0.94, 0.35))),
  onFill('secondary-foreground', 'secondary', 'surfaces'),
  c('muted', 'surfaces', modal(n(0.305, 1.15), n(0.94, 0.35))),
  c('muted-foreground', 'text', modal(n(0.679, 1), n(0.48, 1)), {
    contract: [{ vs: ['background', 'card', 'popover', 'muted', 'accent'], min: 4.5 }],
  }),
  c('faint-foreground', 'text', modal(n(0.62, 1), n(0.5, 1)), {
    contract: [{ vs: ['background', 'card', 'popover', 'muted'], min: 4.5 }],
  }),
  c('accent', 'surfaces', modal(n(0.305, 1.15), n(0.925, 0.4)), {
    label: 'accent (hover surface)',
  }),
  onFill('accent-foreground', 'accent', 'surfaces'),
  c('border', 'lines', modal(n(0.325, 0.95), n(0.885, 0.5)), {
    allowAlpha: true,
    contract: [{ vs: ['background'], min: 3, highOnly: true }],
  }),
  c('border-strong', 'lines', modal(n(0.375, 1.1), n(0.84, 0.6)), { allowAlpha: true }),
  c('input', 'lines', ref('border-strong'), {
    allowAlpha: true,
    contract: [{ vs: ['background'], min: 3, highOnly: true }],
  }),
  // Brand
  c('primary', 'brand', lit('#8B7CF6'), { contract: brandContract() }),
  c('primary-foreground', 'brand', on('primary'), {
    fg: { kind: 'on-fill', of: 'primary' },
    contract: [{ vs: ['primary'], min: 4.5 }],
    fallbackBW: true,
  }),
  c(
    'primary-strong',
    'brand',
    { op: 'shiftL', token: 'primary', by: 0.07 },
    {
      contract: [{ vs: ['background', 'card'], min: 4.5 }],
    },
  ),
  c('primary-soft', 'brand', soft('primary')),
  c('primary-soft-foreground', 'brand', ref('primary'), {
    fg: { kind: 'tint-text', of: 'primary-soft' },
    contract: tintText('primary', 'primary-soft'),
  }),
  c('ring', 'brand', ref('primary'), {
    contract: [{ vs: ['background', 'card', 'popover'], min: 3, selfAlpha: 0.5 }],
  }),
  ...family('destructive', lit('#F16D75'), 'on-fill', brandContract(), 'status'),
  ...family('record', ref('destructive'), 'on-fill', brandContract(), 'status'),
  ...family('success', lit('#3CC8B4'), 'tint-text', GRAPHIC_VS_BG, 'status'),
  ...family('warning', lit('#F2C14E'), 'tint-text', GRAPHIC_VS_BG, 'status'),
  ...family('info', lit('#5EA8FF'), 'tint-text', GRAPHIC_VS_BG, 'status'),
  c('invert', 'surfaces', modal(n(0.37, 0.6), n(0.21, 0.6))),
  c('invert-foreground', 'surfaces', n(0.985, 0.1), {
    fg: { kind: 'on-fill', of: 'invert' },
    contract: [{ vs: ['invert'], min: 4.5 }],
    fallbackBW: true,
  }),
  // Charts
  ...[0, 1, 2, 3, 4].flatMap((i) => [
    c(`chart-${i + 1}`, 'charts', { op: 'track', index: i }, { contract: GRAPHIC_VS_BG }),
    c(`on-chart-${i + 1}`, 'charts', on(`chart-${i + 1}`), {
      fg: { kind: 'on-fill', of: `chart-${i + 1}` },
      contract: [{ vs: [`chart-${i + 1}`], min: 4.5 }],
      fallbackBW: true,
    }),
  ]),
  // Sidebar (shadcn)
  c('sidebar', 'sidebar', ref('card')),
  c('sidebar-foreground', 'sidebar', ref('foreground')),
  c('sidebar-primary', 'sidebar', ref('primary')),
  c('sidebar-primary-foreground', 'sidebar', ref('primary-foreground')),
  c('sidebar-accent', 'sidebar', ref('accent')),
  c('sidebar-accent-foreground', 'sidebar', ref('accent-foreground')),
  c('sidebar-border', 'sidebar', ref('border')),
  c('sidebar-ring', 'sidebar', ref('ring')),
  c('selection', 'brand', ref('primary', 0.25)),
  // Effects
  c('shadow-color', 'effects', modal(lit('#000000'), lit('hsl(225 20% 20%)')), {
    utility: false,
    canvas: false,
  }),
];

// ---------------------------------------------------------------------------
// Non-colour tokens (§3.4)
// ---------------------------------------------------------------------------

const v = (
  name: string,
  kind: ValueTokenDef['kind'],
  group: TokenGroup,
  derive: ValueTokenDef['derive'],
  extra: Partial<Omit<ValueTokenDef, 'name' | 'kind' | 'derive'>> = {},
): ValueTokenDef => ({
  name,
  tier: 'global',
  kind,
  modal: false,
  group,
  label: extra.label ?? name.replace(/-/g, ' '),
  derive,
  ...extra,
});

const px = (x: number): string => `${Number(x.toFixed(3))}px`;

export const RADIUS_STEPS = {
  xs: 0.4,
  sm: 0.6,
  md: 0.8,
  lg: 1,
  xl: 1.4,
  '2xl': 1.8,
  '3xl': 2.2,
  '4xl': 2.6,
} as const;

export const TEXT_STEPS = {
  '2xs': -3,
  xs: -2,
  sm: -1,
  base: 0,
  lg: 1,
  xl: 3,
  '2xl': 5,
  '3xl': 9,
} as const;
export type TextStep = keyof typeof TEXT_STEPS;

const CONTROL_H = {
  compact: [18, 22, 24, 28],
  default: [20, 24, 28, 32],
  comfortable: [24, 28, 32, 36],
} as const;
const DENSITY_GAP = { compact: 2, default: 4, comfortable: 6 } as const;
const MOTION = { fast: 90, base: 160, slow: 240 } as const;

/** Shadow parts per elevation preset (tweakcn's six controls). */
export const ELEVATION = {
  flat: { dark: { opacity: 0, blur: 0 }, light: { opacity: 0, blur: 0 } },
  subtle: { dark: { opacity: 0.35, blur: 8 }, light: { opacity: 0.1, blur: 8 } },
  raised: { dark: { opacity: 0.5, blur: 12 }, light: { opacity: 0.16, blur: 12 } },
} as const;

export const DEFAULT_FONTS = {
  sans: '"Inter Variable", Inter, Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  serif: 'ui-serif, Georgia, serif',
} as const;

const shadowPart = (
  name: string,
  kind: ValueTokenDef['kind'],
  derive: ValueTokenDef['derive'],
  range?: readonly [number, number],
): ValueTokenDef =>
  v(name, kind, 'effects', derive, {
    modal: true,
    deps: ['$elevation'],
    ...(range ? { range } : {}),
  });

export const GLOBAL_VALUE_DEFS: readonly ValueTokenDef[] = [
  v('radius', 'length', 'shape', (x) => px(x.seeds.radius), { deps: ['$radius'], range: [0, 32] }),
  ...Object.entries(RADIUS_STEPS).map(([step, k]) =>
    v(`radius-${step}`, 'length', 'shape', (x) => px(x.seeds.radius * k), {
      deps: ['$radius'],
      utility: true,
    }),
  ),
  v('spacing-ref', 'length', 'layout', (x) => px(x.seeds.spacing), { deps: ['$spacing'] }),
  ...(['xs', 'sm', 'md', 'lg'] as const).map((size, i) =>
    v(`control-h-${size}`, 'length', 'layout', (x) => px(CONTROL_H[x.seeds.density][i]!), {
      deps: ['$density'],
      range: [12, 64],
    }),
  ),
  v('density-gap', 'length', 'layout', (x) => px(DENSITY_GAP[x.seeds.density]), {
    deps: ['$density'],
    range: [0, 16],
  }),
  ...Object.entries(TEXT_STEPS).flatMap(([step, d]) => [
    v(`text-${step}`, 'length', 'typography', (x) => px(x.seeds.textBase + d), {
      deps: ['$textBase'],
      utility: true,
    }),
    v(`text-${step}-lh`, 'number', 'typography', d >= 3 ? 1.3 : 1.4, { range: [1, 2] }),
  ]),
  v('font-sans', 'font', 'typography', (x) => x.seeds.fontSans, {
    deps: ['$fontSans'],
    utility: true,
  }),
  v('font-mono', 'font', 'typography', (x) => x.seeds.fontMono, {
    deps: ['$fontMono'],
    utility: true,
  }),
  v('font-serif', 'font', 'typography', (x) => x.seeds.fontSerif, {
    deps: ['$fontSerif'],
    utility: true,
  }),
  v('font-heading', 'font', 'typography', (x) => x.seeds.fontHeading, {
    deps: ['$fontHeading'],
    utility: true,
  }),
  v('tracking-normal', 'length', 'typography', (x) => `${x.seeds.tracking}em`, {
    deps: ['$tracking'],
  }),
  ...(
    [
      ['tighter', -0.05],
      ['tight', -0.025],
      ['wide', 0.025],
      ['wider', 0.05],
      ['widest', 0.1],
    ] as const
  ).map(([step, d]) =>
    v(
      `tracking-${step}`,
      'length',
      'typography',
      (x) => `${Number((x.seeds.tracking + d).toFixed(4))}em`,
      {
        deps: ['$tracking'],
      },
    ),
  ),
  ...Object.entries(MOTION).map(([step, ms]) =>
    v(`motion-${step}`, 'duration', 'motion', (x) => `${Math.round(ms * x.seeds.motionScale)}ms`, {
      deps: ['$motionScale'],
    }),
  ),
  v('ease-standard', 'easing', 'motion', 'cubic-bezier(0.2, 0, 0, 1)'),
  v('default-transition-duration', 'duration', 'motion', (x) => x.str('motion-fast'), {
    deps: ['motion-fast'],
  }),
  v('focus-width', 'length', 'shape', '2px', { range: [1, 4] }),
  v('focus-offset', 'length', 'shape', '1px', { range: [0, 4] }),
  // Shadow parts (tweakcn) and composites.
  shadowPart(
    'shadow-opacity',
    'number',
    (x) => ELEVATION[x.seeds.elevation][x.mode].opacity,
    [0, 1],
  ),
  shadowPart(
    'shadow-blur',
    'length',
    (x) => px(ELEVATION[x.seeds.elevation][x.mode].blur),
    [0, 64],
  ),
  shadowPart('shadow-spread', 'length', '0px', [-16, 16]),
  shadowPart('shadow-offset-x', 'length', '0px', [-32, 32]),
  shadowPart(
    'shadow-offset-y',
    'length',
    (x) => (x.seeds.elevation === 'flat' ? '0px' : '2px'),
    [-32, 32],
  ),
];

/** Composite shadow steps, built by the resolver from the parts (tweakcn formula). */
export const SHADOW_STEPS = ['2xs', 'xs', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl'] as const;

const SHADOW_SECOND_LAYER: Partial<
  Record<(typeof SHADOW_STEPS)[number], readonly [number, number]>
> = {
  sm: [1, 2],
  DEFAULT: [1, 2],
  md: [2, 4],
  lg: [4, 6],
  xl: [8, 10],
};

const pxNum = (s: string): number => Number.parseFloat(s);

export const SHADOW_DEFS: readonly ValueTokenDef[] = SHADOW_STEPS.map((step) =>
  v(
    step === 'DEFAULT' ? 'shadow' : `shadow-${step}`,
    'shadow',
    'effects',
    (x) => {
      const op = Number(x.str('shadow-opacity'));
      const ox = x.str('shadow-offset-x');
      const oy = x.str('shadow-offset-y');
      const blur = x.str('shadow-blur');
      const spread = x.str('shadow-spread');
      const factor = step === '2xs' || step === 'xs' ? 0.5 : step === '2xl' ? 2.5 : 1;
      const first = `${ox} ${oy} ${blur} ${spread} ${x.colorAt('shadow-color', Math.min(1, op * factor))}`;
      const second = SHADOW_SECOND_LAYER[step];
      if (!second) return first;
      return `${first}, ${ox} ${second[0]}px ${second[1]}px ${px(pxNum(spread) - 1)} ${x.colorAt('shadow-color', op)}`;
    },
    {
      modal: true,
      utility: true,
      deps: [
        'shadow-color',
        'shadow-opacity',
        'shadow-offset-x',
        'shadow-offset-y',
        'shadow-blur',
        'shadow-spread',
      ],
    },
  ),
);

export const GLOBAL_DEFS: readonly TokenDef[] = [
  ...GLOBAL_COLOR_DEFS,
  ...GLOBAL_VALUE_DEFS,
  ...SHADOW_DEFS,
];
