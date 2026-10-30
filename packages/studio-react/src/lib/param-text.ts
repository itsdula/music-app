import { clampParam, normalizeParam, type ParamSpec } from '@studio/domain';

const NUMBER = /[-+]?\d*[.,]?\d+/u;

/**
 * Reads a value typed into a parameter control, in the units `formatParamValue` shows
 * ("1.2 kHz", "350 ms", "-inf", "40%", "3:1", "Saw"), and returns it normalized to 0..1.
 * Returns null when the text holds no value.
 */
export function parseParamText(spec: ParamSpec, text: string): number | null {
  const trimmed = text.trim().replaceAll('−', '-').toLowerCase();
  const option = spec.options?.find((o) => o.label.toLowerCase() === trimmed);
  if (option) return normalizeParam(spec, option.value);
  if (spec.unit === 'dB' && /^-?(inf|infinity|∞)/u.test(trimmed)) return 0;
  const match = NUMBER.exec(trimmed);
  if (!match) return null;
  let value = Number.parseFloat(match[0].replace(',', '.'));
  const suffix = trimmed.slice(match.index + match[0].length).trim();
  if (spec.unit === 'Hz' && suffix.startsWith('k')) value *= 1000;
  if (spec.unit === 'ms' && suffix.startsWith('s')) value *= 1000;
  if (spec.unit === '%') value /= 100;
  return normalizeParam(spec, clampParam(spec, value));
}
