/**
 * Musical horizontal axis shared by the arrangement, piano roll, audio and vocal editors so
 * every view converts ticks ↔ pixels identically. Immutable: zoom/scroll return new axes.
 */
import { PPQ } from '@studio/domain';

export const MIN_PX_PER_TICK = 0.002; // ≈ 2 px per quarter note
export const MAX_PX_PER_TICK = 2; // ≈ 1920 px per quarter note

export class TimeAxis {
  readonly pxPerTick: number;
  readonly scrollTick: number;

  constructor(pxPerTick: number, scrollTick: number) {
    this.pxPerTick = Math.min(MAX_PX_PER_TICK, Math.max(MIN_PX_PER_TICK, pxPerTick));
    this.scrollTick = Math.max(0, scrollTick);
  }

  static fromPxPerBeat(pxPerQuarter: number, scrollTick = 0): TimeAxis {
    return new TimeAxis(pxPerQuarter / PPQ, scrollTick);
  }

  tickToX(tick: number): number {
    return (tick - this.scrollTick) * this.pxPerTick;
  }

  xToTick(x: number): number {
    return this.scrollTick + x / this.pxPerTick;
  }

  /** Width in px of a tick span. */
  span(ticks: number): number {
    return ticks * this.pxPerTick;
  }

  /** Visible [start, end) ticks for a viewport width. */
  visibleRange(widthPx: number): { readonly startTick: number; readonly endTick: number } {
    return { startTick: this.scrollTick, endTick: this.scrollTick + widthPx / this.pxPerTick };
  }

  /** Zooms by `factor` keeping the tick under `anchorX` fixed on screen. */
  zoomAt(factor: number, anchorX: number): TimeAxis {
    const anchorTick = this.xToTick(anchorX);
    const nextPxPerTick = Math.min(MAX_PX_PER_TICK, Math.max(MIN_PX_PER_TICK, this.pxPerTick * factor));
    return new TimeAxis(nextPxPerTick, anchorTick - anchorX / nextPxPerTick);
  }

  scrollBy(deltaPx: number): TimeAxis {
    return new TimeAxis(this.pxPerTick, this.scrollTick + deltaPx / this.pxPerTick);
  }

  withScroll(scrollTick: number): TimeAxis {
    return new TimeAxis(this.pxPerTick, scrollTick);
  }

  /** Scrolls the minimum amount so `tick` is visible with `marginPx` padding. */
  reveal(tick: number, widthPx: number, marginPx = 48): TimeAxis {
    const x = this.tickToX(tick);
    if (x < marginPx) return this.withScroll(tick - marginPx / this.pxPerTick);
    if (x > widthPx - marginPx) return this.withScroll(tick - (widthPx - marginPx) / this.pxPerTick);
    return this;
  }

  equals(other: TimeAxis): boolean {
    return this.pxPerTick === other.pxPerTick && this.scrollTick === other.scrollTick;
  }
}
