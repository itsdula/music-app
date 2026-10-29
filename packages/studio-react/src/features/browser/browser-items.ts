/**
 * Items offered by the left browser and their drag payload format.
 */
import { EFFECT_KINDS, EFFECT_LABELS, SYNTH_PRESETS, type AssetId, type EffectKind, type InstrumentKind } from '@studio/domain';

export const BROWSER_DRAG_MIME = 'application/x-studio-browser-item';

export type BrowserItem =
  | { readonly kind: 'instrument'; readonly instrument: InstrumentKind; readonly presetId?: string; readonly label: string }
  | { readonly kind: 'effect'; readonly effect: EffectKind; readonly label: string }
  | { readonly kind: 'asset'; readonly assetId: AssetId; readonly label: string };

export const INSTRUMENT_ITEMS: readonly BrowserItem[] = [
  ...SYNTH_PRESETS.map((p) => ({ kind: 'instrument' as const, instrument: 'synth' as const, presetId: p.id, label: p.label })),
  { kind: 'instrument', instrument: 'drums', label: 'Drum Kit (synthesized)' },
  { kind: 'instrument', instrument: 'sampler', label: 'Sampler' },
];

export const EFFECT_ITEMS: readonly BrowserItem[] = EFFECT_KINDS.map((effect) => ({
  kind: 'effect' as const,
  effect,
  label: EFFECT_LABELS[effect],
}));

export function encodeBrowserItem(item: BrowserItem): string {
  return JSON.stringify(item);
}

export function decodeBrowserItem(data: string): BrowserItem | null {
  try {
    const value = JSON.parse(data) as Partial<BrowserItem> & { kind?: string };
    if (value.kind === 'instrument' && typeof value.label === 'string') return value as BrowserItem;
    if (value.kind === 'effect' && typeof value.label === 'string') return value as BrowserItem;
    if (value.kind === 'asset' && typeof value.label === 'string') return value as BrowserItem;
    return null;
  } catch {
    return null;
  }
}

export function matchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || label.toLowerCase().includes(q);
}
