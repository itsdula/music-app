/**
 * Canvas renderer for the piano-roll note grid (excluding the keyboard and velocity lane,
 * which have their own small renderers below). Pure drawing from a view model.
 */
import type { MidiClip, NoteId, TimeSignature } from '@studio/domain';
import { colors } from '@studio/ui';
import { canvasFont, hline, roundRect, shade, vline, withAlpha } from '../../canvas/draw-utils';
import { computeGridLines } from '../../canvas/ruler';
import type { TimeAxis } from '../../canvas/time-axis';
import {
  contentToTimeline,
  editableContentRange,
  isBlackKey,
  noteRect,
  pitchToY,
  yToPitch,
  type PitchAxis,
} from './geometry';

export interface PianoRollViewModel {
  readonly clip: MidiClip;
  readonly color: string;
  readonly meter: TimeSignature;
  readonly time: TimeAxis;
  readonly pitch: PitchAxis;
  readonly selected: ReadonlySet<NoteId>;
  /** Optional marquee rectangle in canvas px. */
  readonly marquee?: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } | null;
  /** In-scale pitch classes to highlight (empty = none). */
  readonly scaleHighlight?: ReadonlySet<number>;
}

export function drawNoteGrid(ctx: CanvasRenderingContext2D, width: number, height: number, vm: PianoRollViewModel): void {
  const { clip, time, pitch } = vm;
  ctx.fillStyle = colors.surface1;
  ctx.fillRect(0, 0, width, height);

  // Rows
  const top = yToPitch(0, pitch);
  const bottom = yToPitch(height, pitch);
  for (let p = top; p >= bottom; p--) {
    const y = pitchToY(p, pitch);
    const pc = ((p % 12) + 12) % 12;
    if (isBlackKey(p)) {
      ctx.fillStyle = colors.surface0;
      ctx.fillRect(0, y, width, pitch.rowHeight);
    }
    if (vm.scaleHighlight && vm.scaleHighlight.size > 0 && vm.scaleHighlight.has(pc)) {
      ctx.fillStyle = withAlpha(colors.accent, 0.05);
      ctx.fillRect(0, y, width, pitch.rowHeight);
    }
    ctx.strokeStyle = pc === 0 ? colors.lineStrong : withAlpha(colors.line, 0.6);
    hline(ctx, y + pitch.rowHeight, 0, width);
  }

  // Vertical grid
  for (const line of computeGridLines(time, width, vm.meter, 12)) {
    ctx.strokeStyle =
      line.level === 'bar' ? colors.lineStrong : line.level === 'beat' ? colors.line : withAlpha(colors.line, 0.45);
    vline(ctx, line.x, 0, height);
  }

  // Dim outside the editable content window
  const range = editableContentRange(clip);
  const x0 = time.tickToX(contentToTimeline(clip, range.start));
  const x1 = time.tickToX(contentToTimeline(clip, range.end));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  if (x0 > 0) ctx.fillRect(0, 0, Math.min(width, x0), height);
  if (x1 < width) ctx.fillRect(Math.max(0, x1), 0, width - Math.max(0, x1), height);
  ctx.strokeStyle = withAlpha(vm.color, 0.8);
  vline(ctx, x0, 0, height);
  vline(ctx, x1, 0, height);

  // Notes
  ctx.font = canvasFont(10, 600);
  ctx.textBaseline = 'middle';
  for (const note of clip.notes) {
    const r = noteRect(note, clip, time, pitch);
    if (r.x > width || r.x + r.w < 0 || r.y > height || r.y + r.h < 0) continue;
    const selected = vm.selected.has(note.id);
    const velocityT = note.velocity / 127;
    ctx.fillStyle = selected ? shade(vm.color, 0.35) : shade(vm.color, -0.35 + velocityT * 0.35);
    roundRect(ctx, r.x + 0.5, r.y + 1, Math.max(1, r.w - 1), r.h - 2, 3);
    ctx.fill();
    ctx.strokeStyle = selected ? colors.text : withAlpha('#000000', 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (vm.marquee) {
    const { x0: mx0, y0: my0, x1: mx1, y1: my1 } = vm.marquee;
    ctx.fillStyle = withAlpha(colors.accent, 0.12);
    ctx.strokeStyle = withAlpha(colors.accent, 0.8);
    ctx.fillRect(Math.min(mx0, mx1), Math.min(my0, my1), Math.abs(mx1 - mx0), Math.abs(my1 - my0));
    ctx.strokeRect(Math.min(mx0, mx1) + 0.5, Math.min(my0, my1) + 0.5, Math.abs(mx1 - mx0), Math.abs(my1 - my0));
  }
}

export function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pitch: PitchAxis,
  activePitches: ReadonlySet<number>,
): void {
  ctx.fillStyle = colors.surface2;
  ctx.fillRect(0, 0, width, height);
  const top = yToPitch(0, pitch);
  const bottom = yToPitch(height, pitch);
  ctx.font = canvasFont(9, 600);
  ctx.textBaseline = 'middle';
  for (let p = top; p >= bottom; p--) {
    const y = pitchToY(p, pitch);
    const black = isBlackKey(p);
    const active = activePitches.has(p);
    ctx.fillStyle = active ? colors.accent : black ? '#1b1e25' : '#d9dbe0';
    const keyWidth = black ? width * 0.62 : width;
    ctx.fillRect(0, y, keyWidth, pitch.rowHeight);
    ctx.strokeStyle = black ? '#0d0f13' : '#a9adb6';
    hline(ctx, y + pitch.rowHeight, 0, keyWidth);
    if (p % 12 === 0 && pitch.rowHeight >= 9) {
      ctx.fillStyle = active ? colors.surface0 : '#4a4f5a';
      ctx.fillText(`C${Math.floor(p / 12) - 1}`, width - 24, y + pitch.rowHeight / 2);
    }
  }
}

export function drawVelocityLane(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vm: Pick<PianoRollViewModel, 'clip' | 'time' | 'selected' | 'color'>,
): void {
  ctx.fillStyle = colors.surface0;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = colors.line;
  hline(ctx, 0, 0, width);
  for (const note of vm.clip.notes) {
    const x = vm.time.tickToX(contentToTimeline(vm.clip, note.startTick));
    if (x < -4 || x > width + 4) continue;
    const h = (note.velocity / 127) * (height - 8);
    const selected = vm.selected.has(note.id);
    ctx.fillStyle = selected ? colors.text : shade(vm.color, -0.1);
    ctx.fillRect(Math.round(x), height - h, 3, h);
    ctx.beginPath();
    ctx.arc(Math.round(x) + 1.5, height - h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
