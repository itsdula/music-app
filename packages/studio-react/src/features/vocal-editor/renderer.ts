/**
 * Canvas renderer for the vocal pitch editor. Pure drawing from a view model; all
 * geometry comes from ./geometry so hit-testing and drawing agree exactly.
 */
import {
  midiToNoteName,
  secondsToTicks,
  type TimeSignature,
  type VocalNoteId,
  type VocalNoteSegment,
} from '@studio/domain';
import type { NonPitchedKind, NonPitchedRegion } from '@studio/vocal-dsp';
import { colors } from '@studio/ui';
import { canvasFont, hline, roundRect, vline, withAlpha } from '../../canvas/draw-utils';
import { computeGridLines } from '../../canvas/ruler';
import type { TimeAxis } from '../../canvas/time-axis';
import { isBlackKey, pitchToY, yToPitch, type PitchAxis } from '../piano-roll/geometry';
import {
  LOW_CONFIDENCE,
  NON_PITCHED_BAND_HEIGHT,
  clipSourceWindow,
  midiToY,
  sourceSecondsToTick,
  tickToSourceSeconds,
  type ClipTimeMapping,
  type VocalNoteRect,
} from './geometry';
import { formatCents, centsFromNearest } from './model';

export const VOCAL_NOTE_COLOR = '#7FB8F0';
export const TARGET_LINE_COLOR = colors.accentStrong;

export const NON_PITCHED_COLORS: Readonly<Record<NonPitchedKind, string>> = {
  breath: '#5FA8D3',
  sibilant: '#F2C14E',
  unvoiced: '#9298A5',
  silence: '#30343E',
};

export const NON_PITCHED_LABELS: Readonly<Record<NonPitchedKind, string>> = {
  breath: 'Breath',
  sibilant: 'Sibilant',
  unvoiced: 'Unvoiced',
  silence: 'Silence',
};

export interface PitchCurveTrack {
  readonly firstFrameSeconds: number;
  readonly hopSeconds: number;
  readonly frameCount: number;
}

export interface VocalNoteView {
  readonly segment: VocalNoteSegment;
  readonly rect: VocalNoteRect;
  readonly displayMidi: number;
  /** True when the note has a manual target (draw a ghost at the detected pitch). */
  readonly moved: boolean;
  readonly bypassed: boolean;
}

export interface VocalCanvasViewModel {
  readonly time: TimeAxis;
  readonly pitch: PitchAxis;
  readonly meter: TimeSignature;
  readonly map: ClipTimeMapping;
  readonly notes: readonly VocalNoteView[];
  readonly selected: ReadonlySet<VocalNoteId>;
  readonly hovered: VocalNoteId | null;
  readonly marquee: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  } | null;
  readonly track: PitchCurveTrack;
  /** Detected pitch per frame (fractional MIDI, NaN unvoiced). */
  readonly detected: ArrayLike<number>;
  /** Corrected target per frame (fractional MIDI, NaN where unprocessed). */
  readonly target: ArrayLike<number>;
  readonly nonPitched: readonly NonPitchedRegion[];
  /** In-scale pitch classes of the correction key (empty = chromatic, no guides). */
  readonly scalePitchClasses: ReadonlySet<number>;
  readonly tonic: number | null;
  /** False while A/B plays the original: the corrected line is drawn faded. */
  readonly correctionAudible: boolean;
}

export function drawVocalEditor(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vm: VocalCanvasViewModel,
): void {
  const { time, pitch } = vm;
  ctx.fillStyle = colors.surface1;
  ctx.fillRect(0, 0, width, height);

  // Rows with scale guides.
  const top = yToPitch(0, pitch);
  const bottom = yToPitch(height, pitch);
  const guides = vm.scalePitchClasses.size > 0 && vm.scalePitchClasses.size < 12;
  for (let p = top; p >= bottom; p--) {
    const y = pitchToY(p, pitch);
    const pc = ((p % 12) + 12) % 12;
    if (guides) {
      if (vm.scalePitchClasses.has(pc)) {
        ctx.fillStyle = withAlpha(colors.accent, pc === vm.tonic ? 0.12 : 0.06);
        ctx.fillRect(0, y, width, pitch.rowHeight);
      } else {
        ctx.fillStyle = colors.surface0;
        ctx.fillRect(0, y, width, pitch.rowHeight);
      }
    } else if (isBlackKey(p)) {
      ctx.fillStyle = colors.surface0;
      ctx.fillRect(0, y, width, pitch.rowHeight);
    }
    ctx.strokeStyle = pc === 0 ? colors.lineStrong : withAlpha(colors.line, 0.5);
    hline(ctx, y + pitch.rowHeight, 0, width);
  }

  // Bar / beat grid.
  for (const line of computeGridLines(time, width, vm.meter, 14)) {
    ctx.strokeStyle =
      line.level === 'bar'
        ? colors.lineStrong
        : line.level === 'beat'
          ? colors.line
          : withAlpha(colors.line, 0.4);
    vline(ctx, line.x, 0, height);
  }

  // Dim outside the clip's source window.
  const span = clipSourceWindow(vm.map);
  const wx0 = time.tickToX(sourceSecondsToTick(span.start, vm.map));
  const wx1 = time.tickToX(sourceSecondsToTick(span.end, vm.map));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  if (wx0 > 0) ctx.fillRect(0, 0, Math.min(width, wx0), height);
  if (wx1 < width) ctx.fillRect(Math.max(0, wx1), 0, width - Math.max(0, wx1), height);

  drawNonPitchedBands(ctx, width, height, vm);

  // Ghosts at the detected pitch for moved notes.
  for (const note of vm.notes) {
    if (!note.moved || note.rect.x > width || note.rect.x + note.rect.w < 0) continue;
    const y = midiToY(note.segment.detectedMidi, pitch) - note.rect.h / 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = withAlpha(VOCAL_NOTE_COLOR, 0.45);
    ctx.lineWidth = 1;
    roundRect(ctx, note.rect.x + 0.5, y + 0.5, Math.max(1, note.rect.w - 1), note.rect.h - 1, 4);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Note blobs.
  for (const note of vm.notes) {
    const r = note.rect;
    if (r.x > width || r.x + r.w < 0 || r.y > height || r.y + r.h < 0) continue;
    const selected = vm.selected.has(r.id);
    const hovered = vm.hovered === r.id;
    const lowConfidence = note.segment.confidence < LOW_CONFIDENCE;
    const base = note.bypassed ? colors.textFaint : VOCAL_NOTE_COLOR;
    const alpha = note.bypassed
      ? 0.25
      : lowConfidence
        ? 0.3
        : selected
          ? 0.75
          : hovered
            ? 0.6
            : 0.45;
    ctx.fillStyle = withAlpha(base, alpha);
    roundRect(ctx, r.x + 0.5, r.y, Math.max(1, r.w - 1), r.h, Math.min(6, r.h / 2));
    ctx.fill();
    if (note.bypassed) drawHatch(ctx, r);
    if (lowConfidence) ctx.setLineDash([3, 2]);
    ctx.strokeStyle = selected ? colors.text : withAlpha(base, 0.9);
    ctx.lineWidth = selected ? 1.5 : 1;
    roundRect(ctx, r.x + 0.5, r.y, Math.max(1, r.w - 1), r.h, Math.min(6, r.h / 2));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }

  // Corrected target line, then the (thinner) sung contour on top so both stay visible
  // where they coincide.
  drawCurve(
    ctx,
    width,
    vm,
    vm.target,
    withAlpha(TARGET_LINE_COLOR, vm.correctionAudible ? 0.95 : 0.35),
    2,
  );
  drawCurve(ctx, width, vm, vm.detected, withAlpha(colors.text, 0.6), 1);

  // Labels on selected (when few) and hovered notes.
  ctx.font = canvasFont(10, 600);
  ctx.textBaseline = 'middle';
  for (const note of vm.notes) {
    const id = note.rect.id;
    const show = vm.hovered === id || (vm.selected.has(id) && vm.selected.size <= 4);
    if (show) drawNoteLabel(ctx, note);
  }

  if (vm.marquee) {
    const { x0, y0, x1, y1 } = vm.marquee;
    ctx.fillStyle = withAlpha(colors.accent, 0.12);
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

function drawHatch(ctx: CanvasRenderingContext2D, r: VocalNoteRect): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.strokeStyle = withAlpha(colors.textMuted, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = r.x - r.h; x < r.x + r.w; x += 5) {
    ctx.moveTo(x, r.y + r.h);
    ctx.lineTo(x + r.h, r.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawNoteLabel(ctx: CanvasRenderingContext2D, note: VocalNoteView): void {
  const detected = note.segment.detectedMidi;
  let text = `${midiToNoteName(detected)} ${formatCents(centsFromNearest(detected))}`;
  if (note.moved || Math.abs(note.displayMidi - detected) >= 0.01) {
    const cents = centsFromNearest(note.displayMidi);
    text += ` → ${midiToNoteName(note.displayMidi)}${cents === 0 ? '' : ` ${formatCents(cents)}`}`;
  }
  if (note.bypassed) text += ' (bypassed)';
  const w = ctx.measureText(text).width + 8;
  const x = Math.max(2, note.rect.x);
  const y = note.rect.y - 9;
  ctx.fillStyle = withAlpha(colors.surface0, 0.9);
  roundRect(ctx, x, y - 7, w, 14, 3);
  ctx.fill();
  ctx.fillStyle = colors.text;
  ctx.fillText(text, x + 4, y);
}

function drawNonPitchedBands(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  vm: VocalCanvasViewModel,
): void {
  const y = height - NON_PITCHED_BAND_HEIGHT;
  for (const region of vm.nonPitched) {
    if (region.kind === 'silence') continue; // silence is the absence of anything: leave it empty
    const x0 = vm.time.tickToX(sourceSecondsToTick(region.startSeconds, vm.map));
    const x1 = vm.time.tickToX(sourceSecondsToTick(region.endSeconds, vm.map));
    if (x1 < 0 || x0 > width) continue;
    ctx.fillStyle = withAlpha(NON_PITCHED_COLORS[region.kind], 0.05);
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), y);
    ctx.fillStyle = withAlpha(NON_PITCHED_COLORS[region.kind], 0.8);
    ctx.fillRect(x0, y, Math.max(1, x1 - x0), NON_PITCHED_BAND_HEIGHT);
  }
}

/** Polyline through finite values of a per-frame curve; NaN frames break the line. */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  width: number,
  vm: VocalCanvasViewModel,
  values: ArrayLike<number>,
  color: string,
  lineWidth: number,
): void {
  const { track, time, pitch, map } = vm;
  if (track.frameCount === 0 || values.length === 0) return;
  const startS = tickToSourceSeconds(time.xToTick(0), map);
  const endS = tickToSourceSeconds(time.xToTick(width), map);
  const first = Math.max(0, Math.floor((startS - track.firstFrameSeconds) / track.hopSeconds) - 1);
  const last = Math.min(
    values.length - 1,
    Math.ceil((endS - track.firstFrameSeconds) / track.hopSeconds) + 1,
  );
  const pxPerFrame = time.span(secondsToTicks(track.hopSeconds, map.bpm));
  const stride = Math.max(1, Math.floor(0.75 / Math.max(1e-9, pxPerFrame)));
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  let drawing = false;
  for (let i = first; i <= last; i += stride) {
    const m = values[i]!;
    if (!Number.isFinite(m)) {
      drawing = false;
      continue;
    }
    const x = time.tickToX(
      sourceSecondsToTick(track.firstFrameSeconds + i * track.hopSeconds, map),
    );
    const y = midiToY(m, pitch);
    if (drawing) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    drawing = true;
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}
