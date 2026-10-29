import { formatBarsBeats, formatSeconds, ticksToSeconds, type TimeSignature } from '@studio/domain';

export function formatPosition(
  ticks: number,
  bpm: number,
  meter: TimeSignature,
): { bars: string; time: string } {
  return { bars: formatBarsBeats(ticks, meter), time: formatSeconds(ticksToSeconds(ticks, bpm)) };
}

export function formatBpm(bpm: number): string {
  return bpm % 1 === 0 ? bpm.toFixed(0) : bpm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function parseBpm(text: string): number | null {
  const n = Number.parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function formatDb(db: number): string {
  if (db <= -60) return '-inf';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}

export function formatPan(pan: number): string {
  if (Math.abs(pan) < 0.005) return 'C';
  return `${Math.round(Math.abs(pan) * 100)}${pan < 0 ? 'L' : 'R'}`;
}
