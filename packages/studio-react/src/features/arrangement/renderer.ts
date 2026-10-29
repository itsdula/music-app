/**
 * Canvas renderer for arrangement lanes and clips. Pure drawing from a view model; audio
 * waveforms come from an injected peak reader (backed by cached peak pyramids).
 */
import {
  expandMidiClipNotes,
  type AssetId,
  type AudioClip,
  type ClipId,
  type LoopRegion,
  type MidiClip,
  type Project,
  type TimeSignature,
} from '@studio/domain';
import { colors } from '@studio/ui';
import { canvasFont, hline, roundRect, shade, vline, withAlpha } from '../../canvas/draw-utils';
import { computeGridLines } from '../../canvas/ruler';
import type { TimeAxis } from '../../canvas/time-axis';
import { CLIP_HEADER_HEIGHT, type ClipBox, type ClipHitRegion, type TrackRow } from './geometry';

/** Returns interleaved [min, max] pairs per column for a source frame range, or null if not ready. */
export type PeakReader = (
  assetId: AssetId,
  startFrame: number,
  endFrame: number,
  columns: number,
) => Float32Array | null;

export interface ArrangementViewModel {
  readonly project: Project;
  readonly rows: readonly TrackRow[];
  readonly boxes: readonly ClipBox[];
  readonly time: TimeAxis;
  readonly meter: TimeSignature;
  readonly selectedClipIds: ReadonlySet<ClipId>;
  readonly selectedTrackId: string | null;
  readonly peaks: PeakReader;
  readonly marquee?: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  /** Clip region under the pointer (or being dragged): drawn as an edge/handle highlight. */
  readonly hover?: { readonly clipId: ClipId; readonly region: ClipHitRegion } | null;
}

export function drawLanes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vm: ArrangementViewModel,
): void {
  ctx.fillStyle = colors.surface0;
  ctx.fillRect(0, 0, width, height);
  for (const row of vm.rows) {
    if (row.top > height || row.top + row.height < 0) continue;
    if (row.track.id === vm.selectedTrackId) {
      ctx.fillStyle = withAlpha(colors.accent, 0.05);
      ctx.fillRect(0, row.top, width, row.height);
    }
    ctx.strokeStyle = colors.line;
    hline(ctx, row.top + row.height, 0, width);
  }
  for (const line of computeGridLines(vm.time, width, vm.meter, 14)) {
    ctx.strokeStyle =
      line.level === 'bar'
        ? withAlpha(colors.lineStrong, 0.9)
        : line.level === 'beat'
          ? withAlpha(colors.line, 0.7)
          : withAlpha(colors.line, 0.35);
    vline(ctx, line.x, 0, height);
  }
  drawLoopShade(ctx, width, height, vm.time, vm.project.loop);
  for (const box of vm.boxes) drawClip(ctx, box, vm);
  if (vm.marquee) {
    const { x0, y0, x1, y1 } = vm.marquee;
    ctx.fillStyle = withAlpha(colors.accent, 0.1);
    ctx.strokeStyle = withAlpha(colors.accent, 0.8);
    ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    ctx.strokeRect(
      Math.min(x0, x1) + 0.5,
      Math.min(y0, y1) + 0.5,
      Math.abs(x1 - x0),
      Math.abs(y1 - y0),
    );
  }
}

function drawLoopShade(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: TimeAxis,
  loop: LoopRegion,
): void {
  if (!loop.enabled) return;
  const x0 = time.tickToX(loop.startTick);
  const x1 = time.tickToX(loop.endTick);
  if (x1 < 0 || x0 > width) return;
  ctx.fillStyle = withAlpha(colors.accent, 0.04);
  ctx.fillRect(x0, 0, x1 - x0, height);
}

function drawClip(ctx: CanvasRenderingContext2D, box: ClipBox, vm: ArrangementViewModel): void {
  const { clip } = box;
  const trackColor = clip.color ?? box.row.track.color;
  const selected = vm.selectedClipIds.has(clip.id);
  const muted = clip.muted || box.row.track.mixer.mute;
  ctx.save();
  ctx.globalAlpha = muted ? 0.45 : 1;
  roundRect(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 4);
  ctx.fillStyle = withAlpha(trackColor, selected ? 0.34 : 0.22);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = withAlpha(trackColor, selected ? 0.95 : 0.7);
  ctx.fillRect(box.x, box.y, box.w, CLIP_HEADER_HEIGHT);
  if (box.w > 28) {
    ctx.font = canvasFont(10, 600);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.surface0;
    ctx.fillText(
      clip.name,
      box.x + 6,
      box.y + CLIP_HEADER_HEIGHT / 2 + 0.5,
      Math.max(0, box.w - 12),
    );
  }
  const body = { x: box.x, y: box.y + CLIP_HEADER_HEIGHT, w: box.w, h: box.h - CLIP_HEADER_HEIGHT };
  if (clip.kind === 'midi') drawMidiPreview(ctx, clip, body, vm.time, trackColor);
  else drawWaveform(ctx, clip, body, vm, trackColor);
  ctx.restore();
  roundRect(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, 4);
  ctx.strokeStyle = selected ? colors.text : withAlpha(trackColor, 0.9);
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.stroke();
  const looping =
    clip.kind === 'midi' ? clip.loopLengthTicks !== undefined : clip.loopLengthFrames !== undefined;
  const hover = vm.hover && vm.hover.clipId === clip.id ? vm.hover.region : null;
  if (looping || hover) drawLoopHandle(ctx, box, hover === 'loop-end', looping);
  if (hover === 'start-edge' || hover === 'end-edge') drawEdgeHighlight(ctx, box, hover);
  ctx.restore();
}

/** Accent bar along the edge a trim drag would move. */
function drawEdgeHighlight(
  ctx: CanvasRenderingContext2D,
  box: ClipBox,
  region: 'start-edge' | 'end-edge',
): void {
  const w = Math.min(3, Math.max(1, box.w / 4));
  const x = region === 'start-edge' ? box.x + 1 : box.x + box.w - 1 - w;
  ctx.fillStyle = colors.text;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, box.y + 2, w, box.h - 4);
}

/**
 * Loop handle in the clip's top-right corner: a small circular-arrow glyph, shown while the
 * clip is hovered (to advertise the handle) and always on looping clips.
 */
function drawLoopHandle(
  ctx: CanvasRenderingContext2D,
  box: ClipBox,
  active: boolean,
  looping: boolean,
): void {
  if (box.w < 22) return;
  const size = Math.min(CLIP_HEADER_HEIGHT, box.h / 2);
  const cx = box.x + box.w - size / 2 - 2;
  const cy = box.y + size / 2;
  if (active) {
    ctx.fillStyle = withAlpha(colors.text, 0.9);
    roundRect(ctx, cx - size / 2, box.y + 1, size, size - 1, 3);
    ctx.fill();
  }
  ctx.strokeStyle = active
    ? colors.surface0
    : looping
      ? colors.surface0
      : withAlpha(colors.surface0, 0.6);
  ctx.lineWidth = 1.5;
  const r = Math.max(2, size / 2 - 3.5);
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.15, Math.PI * 1.75);
  ctx.stroke();
  // Arrow head at the arc end.
  const ax = cx + r * Math.cos(Math.PI * 1.75);
  const ay = cy + r * Math.sin(Math.PI * 1.75);
  ctx.beginPath();
  ctx.moveTo(ax + 2.5, ay - 0.5);
  ctx.lineTo(ax - 0.5, ay - 2.5);
  ctx.lineTo(ax - 0.5, ay + 1.5);
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.lineWidth = 1;
}

function drawMidiPreview(
  ctx: CanvasRenderingContext2D,
  clip: MidiClip,
  body: { x: number; y: number; w: number; h: number },
  time: TimeAxis,
  color: string,
): void {
  const notes = expandMidiClipNotes(clip);
  if (notes.length === 0) return;
  let lo = 127;
  let hi = 0;
  for (const n of notes) {
    lo = Math.min(lo, n.note.pitch);
    hi = Math.max(hi, n.note.pitch);
  }
  const span = Math.max(12, hi - lo + 1);
  const mid = (hi + lo) / 2;
  const low = mid - span / 2;
  const rowH = Math.max(1, (body.h - 4) / span);
  ctx.fillStyle = shade(color, 0.45);
  for (const n of notes) {
    const x = time.tickToX(n.startTick);
    const w = Math.max(1, time.span(n.endTick - n.startTick) - 0.5);
    const y = body.y + 2 + (body.h - 4) - (n.note.pitch - low + 1) * rowH;
    ctx.fillRect(x, y, w, Math.max(1, rowH - 0.5));
  }
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  clip: AudioClip,
  body: { x: number; y: number; w: number; h: number },
  vm: ArrangementViewModel,
  color: string,
): void {
  const asset = vm.project.assets[clip.assetId];
  if (!asset) return;
  const visibleX0 = Math.max(0, body.x);
  const visibleX1 = Math.min(
    ctx.canvas.width / (globalThis.devicePixelRatio || 1),
    body.x + body.w,
  );
  const columns = Math.floor(visibleX1 - visibleX0);
  if (columns <= 0) return;
  const framesPerPx = clip.lengthFrames / Math.max(1, body.w);
  const centerY = body.y + body.h / 2;
  const halfH = body.h / 2 - 2;
  const gain = Math.pow(10, clip.gainDb / 20);
  ctx.fillStyle = shade(color, 0.4);
  const loopFrames = clip.loopLengthFrames;
  // Draw in loop-sized segments so looped clips repeat the waveform.
  const segmentFrames = loopFrames && loopFrames > 0 ? loopFrames : clip.lengthFrames;
  for (let segStart = 0; segStart < clip.lengthFrames; segStart += segmentFrames) {
    const segEnd = Math.min(clip.lengthFrames, segStart + segmentFrames);
    const sx0 = body.x + segStart / framesPerPx;
    const sx1 = body.x + segEnd / framesPerPx;
    const x0 = Math.max(visibleX0, sx0);
    const x1 = Math.min(visibleX1, sx1);
    const cols = Math.floor(x1 - x0);
    if (cols <= 0) continue;
    const f0 = clip.sourceStartFrame + (x0 - sx0) * framesPerPx;
    const f1 = clip.sourceStartFrame + (x1 - sx0) * framesPerPx;
    const peaks = vm.peaks(clip.assetId, Math.floor(f0), Math.ceil(f1), cols);
    if (!peaks) {
      ctx.fillStyle = withAlpha(color, 0.25);
      ctx.fillRect(x0, centerY - 0.5, x1 - x0, 1);
      ctx.fillStyle = shade(color, 0.4);
      continue;
    }
    for (let i = 0; i < cols; i++) {
      const min = Math.max(-1, (peaks[i * 2] ?? 0) * gain);
      const max = Math.min(1, (peaks[i * 2 + 1] ?? 0) * gain);
      const y0 = centerY - max * halfH;
      const y1 = centerY - min * halfH;
      ctx.fillRect(x0 + i, y0, 1, Math.max(1, y1 - y0));
    }
  }
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: TimeAxis,
  meter: TimeSignature,
  loop: LoopRegion,
  loopBarHeight: number,
): void {
  ctx.fillStyle = colors.surface1;
  ctx.fillRect(0, 0, width, height);
  // Loop bar
  const lx0 = time.tickToX(loop.startTick);
  const lx1 = time.tickToX(loop.endTick);
  ctx.fillStyle = loop.enabled ? withAlpha(colors.accent, 0.55) : withAlpha(colors.textFaint, 0.35);
  roundRect(ctx, lx0, 1, Math.max(2, lx1 - lx0), loopBarHeight - 2, 2);
  ctx.fill();
  ctx.font = canvasFont(10, 500);
  ctx.textBaseline = 'top';
  for (const line of computeGridLines(time, width, meter, 8)) {
    if (line.level === 'bar') {
      ctx.strokeStyle = colors.textFaint;
      vline(ctx, line.x, loopBarHeight, height);
      ctx.fillStyle = colors.textMuted;
      ctx.fillText(String(line.bar), line.x + 4, loopBarHeight + 3);
    } else {
      ctx.strokeStyle = colors.line;
      vline(ctx, line.x, height - (line.level === 'beat' ? 7 : 4), height);
    }
  }
  ctx.strokeStyle = colors.line;
  hline(ctx, height - 0.5, 0, width);
}
