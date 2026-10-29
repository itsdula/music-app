import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { colors, fonts, radii } from '../src/tokens';

const css = readFileSync(join(import.meta.dirname, '../src/tokens.css'), 'utf8');

function cssVars(prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  const pattern = new RegExp(`--${prefix}-([a-z0-9-]+)\\s*:\\s*([^;]+);`, 'g');
  for (const match of css.matchAll(pattern)) {
    out.set(match[1]!, match[2]!.trim());
  }
  return out;
}

const camel = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const normalizeFontStack = (stack: string): string =>
  stack.replace(/["']/g, '"').replace(/\s+/g, ' ').trim();

describe('design tokens', () => {
  it('defines exactly the colours from tokens.ts with matching values', () => {
    const cssColors = cssVars('color');
    const fromCss = Object.fromEntries(
      [...cssColors].map(([name, value]) => [camel(name), value.toLowerCase()]),
    );
    const fromTs = Object.fromEntries(
      Object.entries(colors).map(([name, value]) => [name, value.toLowerCase()]),
    );
    expect(fromCss).toEqual(fromTs);
  });

  it('uses hex colours only', () => {
    for (const value of cssVars('color').values()) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('matches font stacks', () => {
    const cssFonts = cssVars('font');
    expect(Object.keys(fonts).sort()).toEqual([...cssFonts.keys()].map(camel).sort());
    for (const [name, value] of Object.entries(fonts)) {
      expect(normalizeFontStack(cssFonts.get(name) ?? '')).toBe(normalizeFontStack(value));
    }
  });

  it('matches radii', () => {
    const cssRadii = cssVars('radius');
    expect(Object.keys(radii).sort()).toEqual([...cssRadii.keys()].sort());
    for (const [name, value] of Object.entries(radii)) {
      expect(cssRadii.get(name)).toBe(`${value}px`);
    }
  });
});
