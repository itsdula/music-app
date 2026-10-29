/**
 * Design tokens. `tokens.css` mirrors these values for Tailwind (`@theme`) and CSS; a unit
 * test keeps both in sync. Canvas renderers read colours from here.
 */
export const colors = {
  surface0: '#111318',
  surface1: '#191C23',
  surface2: '#222630',
  surface3: '#2A2F3B',
  line: '#30343E',
  lineStrong: '#3C414D',
  text: '#F2F3F5',
  textMuted: '#9298A5',
  textFaint: '#6B7180',
  accent: '#8B7CF6',
  accentStrong: '#A397FF',
  record: '#F16D75',
  success: '#3CC8B4',
  warning: '#F2C14E',
} as const;

export type ColorToken = keyof typeof colors;

export const fonts = {
  sans: '"Inter Variable", Inter, Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
} as const;

export const radii = { sm: 4, md: 6, lg: 10 } as const;

/** Motion durations (ms); respect prefers-reduced-motion in consumers. */
export const motion = { fast: 90, base: 160, slow: 240 } as const;
