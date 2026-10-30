/** Digital silence. */
export const SILENCE_DB = Number.NEGATIVE_INFINITY;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Decibels to linear gain. `-Infinity` gives 0. */
export const dbToGain = (db: number): number => (db === SILENCE_DB ? 0 : 10 ** (db / 20));

/** Linear gain to decibels. 0 (or less) gives `-Infinity`. */
export const gainToDb = (gain: number): number => (gain <= 0 ? SILENCE_DB : 20 * Math.log10(gain));

/** Formats decibels for display: "−12.3 dB", "+3.0 dB", "−∞ dB". */
export function formatDb(db: number, decimals = 1): string {
  if (Number.isNaN(db)) return '-- dB';
  if (db === SILENCE_DB) return '−∞ dB';
  const rounded = Number(db.toFixed(decimals));
  const magnitude = Math.abs(rounded).toFixed(decimals);
  if (rounded > 0) return `+${magnitude} dB`;
  if (rounded < 0) return `−${magnitude} dB`;
  return `${magnitude} dB`;
}
