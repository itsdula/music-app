/**
 * Arrangement layout: tracks are stacked rows; clips are positioned with the shared
 * TimeAxis. Clip extents for audio clips derive from tempo (see domain `clipEndTick`).
 */
import {
  clipEndTick,
  type Clip,
  type ClipId,
  type Project,
  type Track,
  type TrackId,
} from '@studio/domain';
import type { TimeAxis } from '../../canvas/time-axis';
import { classifyEdge, type EdgeSide, type EdgeZoneSpec } from '../../lib/edge-zones';

export const RULER_HEIGHT = 28;
export const LOOP_BAR_HEIGHT = 10;
export const TRACK_HEADER_WIDTH = 216;
export const CLIP_EDGE_HIT_PX = 7;
export const CLIP_HEADER_HEIGHT = 14;

export interface TrackRow {
  readonly track: Track;
  readonly index: number;
  readonly top: number;
  readonly height: number;
}

export interface ClipBox {
  readonly clip: Clip;
  readonly row: TrackRow;
  readonly startTick: number;
  readonly endTick: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function layoutRows(
  tracks: readonly Track[],
  trackHeight: number,
  scrollY: number,
): TrackRow[] {
  return tracks.map((track, index) => ({
    track,
    index,
    top: index * trackHeight - scrollY,
    height: trackHeight,
  }));
}

export function rowAtY(rows: readonly TrackRow[], y: number): TrackRow | null {
  for (const row of rows) if (y >= row.top && y < row.top + row.height) return row;
  return null;
}

export function clipBoxes(
  project: Project,
  rows: readonly TrackRow[],
  time: TimeAxis,
  viewWidth: number,
  viewHeight: number,
): ClipBox[] {
  const rowByTrack = new Map<TrackId, TrackRow>(rows.map((r) => [r.track.id, r]));
  const { startTick, endTick } = time.visibleRange(viewWidth);
  const boxes: ClipBox[] = [];
  for (const clip of Object.values(project.clips)) {
    const row = rowByTrack.get(clip.trackId);
    if (!row || row.top > viewHeight || row.top + row.height < 0) continue;
    const end = clipEndTick(clip, project);
    if (end < startTick || clip.startTick > endTick) continue;
    const x = time.tickToX(clip.startTick);
    boxes.push({
      clip,
      row,
      startTick: clip.startTick,
      endTick: end,
      x,
      y: row.top + 2,
      w: Math.max(3, time.span(end - clip.startTick)),
      h: row.height - 4,
    });
  }
  boxes.sort((a, b) => a.startTick - b.startTick || (a.clip.id < b.clip.id ? -1 : 1));
  return boxes;
}

/**
 * Regions of a clip box. `loop-end` is the top-right corner (the header part of the right
 * edge): dragging it extends the clip by looping its content.
 */
export type ClipHitRegion = 'body' | 'start-edge' | 'end-edge' | 'loop-end';

export interface ClipHit {
  readonly box: ClipBox;
  readonly region: ClipHitRegion;
}

/** Clip edge zones: up to 7 px inside, at least 4 px, plus 4 px of slop outside. */
export const CLIP_EDGE_ZONES: EdgeZoneSpec = { max: CLIP_EDGE_HIT_PX, min: 4, outer: 4 };

function endRegion(box: ClipBox, y: number): ClipHitRegion {
  return y < box.y + Math.min(CLIP_HEADER_HEIGHT, box.h / 2) ? 'loop-end' : 'end-edge';
}

function regionFor(box: ClipBox, side: EdgeSide, y: number): ClipHitRegion {
  return side === 'end' ? endRegion(box, y) : side === 'start' ? 'start-edge' : 'body';
}

export function hitTestClip(boxes: readonly ClipBox[], x: number, y: number): ClipHit | null {
  // Inside a clip first (top-most wins), then the slop just outside an edge.
  for (const includeOuter of [false, true]) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const box = boxes[i]!;
      if (y < box.y || y >= box.y + box.h) continue;
      const side = classifyEdge(x, box.x, box.w, CLIP_EDGE_ZONES, includeOuter);
      if (side) return { box, region: regionFor(box, side, y) };
    }
  }
  return null;
}

export function clipsInRect(
  boxes: readonly ClipBox[],
  rect: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
): ClipId[] {
  const left = Math.min(rect.x0, rect.x1);
  const right = Math.max(rect.x0, rect.x1);
  const top = Math.min(rect.y0, rect.y1);
  const bottom = Math.max(rect.y0, rect.y1);
  return boxes
    .filter((b) => b.x < right && b.x + b.w > left && b.y < bottom && b.y + b.h > top)
    .map((b) => b.clip.id);
}
