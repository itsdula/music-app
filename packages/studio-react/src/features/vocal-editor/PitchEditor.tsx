/**
 * The pitch editor surface: ruler, piano keyboard and the note/curve canvas. Drawing is
 * done on canvas from memoised view models; the playhead runs on the shared render loop.
 */
import type { Transaction } from '@studio/commands';
import type { AudioClip, VocalEditDoc, VocalNoteEdit, VocalNoteId } from '@studio/domain';
import { IconButton, colors } from '@studio/ui';
import { computeTargetPitchCurve, pitchTrackMidi, type VocalAnalysis } from '@studio/vocal-dsp';
import { Expand } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasSurface,
  type CanvasSize,
  type CanvasSurfaceHandle,
} from '../../canvas/canvas-surface';
import { canvasFont, drawPlayhead, vline, withAlpha } from '../../canvas/draw-utils';
import { computeGridLines } from '../../canvas/ruler';
import type { TimeAxis } from '../../canvas/time-axis';
import { StudioContextMenu } from '../../components/context-menu';
import { startDragGesture } from '../../lib/drag-gesture';
import { useFrame } from '../../lib/use-frame';
import { useProjectState, useSession, useUiState } from '../../session/context';
import type { StudioSession } from '../../session/studio-session';
import { clampTopPitch } from '../piano-roll/geometry';
import { drawKeyboard } from '../piano-roll/renderer';
import type { VocalActions } from './actions';
import {
  VOCAL_KEYBOARD_WIDTH,
  VOCAL_RULER_HEIGHT,
  clipSourceWindow,
  fitVocalViewport,
  hitTestVocalNote,
  sourceSecondsToTick,
  tickToSourceSeconds,
  vocalNoteRect,
  vocalNotesInRect,
  type ClipTimeMapping,
} from './geometry';
import {
  displayTargetMidi,
  hasManualTarget,
  noteEditOf,
  pitchRange,
  snapModeFor,
  snapTargetMidi,
} from './model';
import { drawVocalEditor, type VocalCanvasViewModel, type VocalNoteView } from './renderer';
import { handleVocalKey } from './keys';
import { useNativeKeyDown, useVocalAxes } from './use-vocal';
import { vocalMenu } from './vocal-menus';
import { scalePitchClasses } from '@studio/domain';

export interface PitchEditorProps {
  readonly clip: AudioClip;
  readonly doc: VocalEditDoc;
  readonly analysis: VocalAnalysis;
  readonly map: ClipTimeMapping;
  readonly actions: VocalActions;
  readonly editing: boolean;
  readonly selected: ReadonlySet<VocalNoteId>;
  readonly describedBy: string;
  /**
   * Returns true the first time it is called for a clip (fit-to-clip on open). Owned by
   * the parent so toggling the notes list does not reset the zoom.
   */
  readonly claimAutoFit: (clipId: string) => boolean;
}

function fitToClip(
  session: StudioSession,
  map: ClipTimeMapping,
  doc: VocalEditDoc,
  widthPx: number,
  heightPx: number,
): void {
  const span = clipSourceWindow(map);
  const range = pitchRange(doc.segments);
  const ui = session.uiStore.getState();
  const fit = fitVocalViewport({
    startTick: sourceSecondsToTick(span.start, map),
    endTick: sourceSecondsToTick(span.end, map),
    widthPx,
    heightPx,
    rowHeight: ui.vocal.rowHeight,
    minMidi: range.min,
    maxMidi: range.max,
  });
  session.uiStore.setState({ vocal: { ...ui.vocal, ...fit } });
}

/** Playhead position in source seconds (cursor when stopped). */
export function playheadSourceSeconds(session: StudioSession, map: ClipTimeMapping): number {
  const position = session.engine.getTransportPosition();
  const tick =
    position.state === 'stopped' ? session.engineStore.getState().cursorTick : position.ticks;
  return tickToSourceSeconds(tick, map);
}

function VocalRuler({ time, map }: { time: TimeAxis; map: ClipTimeMapping }) {
  const session = useSession();
  const meter = useProjectState((s) => s.project.meter);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => {
      ctx.fillStyle = colors.surface1;
      ctx.fillRect(0, 0, s.width, s.height);
      const span = clipSourceWindow(map);
      const x0 = time.tickToX(sourceSecondsToTick(span.start, map));
      const x1 = time.tickToX(sourceSecondsToTick(span.end, map));
      ctx.fillStyle = withAlpha(colors.accent, 0.25);
      ctx.fillRect(x0, s.height - 4, x1 - x0, 4);
      ctx.font = canvasFont(10, 500);
      ctx.textBaseline = 'top';
      for (const line of computeGridLines(time, s.width, meter, 10)) {
        if (line.level === 'bar') {
          ctx.strokeStyle = colors.textFaint;
          vline(ctx, line.x, 0, s.height);
          ctx.fillStyle = colors.textMuted;
          ctx.fillText(String(line.bar), line.x + 4, 5);
        } else if (line.level === 'beat') {
          ctx.strokeStyle = colors.line;
          vline(ctx, line.x, s.height - 6, s.height);
        }
      }
    },
    [map, meter, time],
  );
  return (
    <div
      className="relative shrink-0 cursor-pointer border-b border-line"
      style={{ height: VOCAL_RULER_HEIGHT }}
      role="presentation"
      data-testid="vocal-ruler"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        void session.transport.seek(Math.max(0, Math.round(time.xToTick(e.clientX - rect.left))));
      }}
    >
      <CanvasSurface draw={draw} version={draw} className="absolute inset-0" />
    </div>
  );
}

function VocalKeyboard({ active }: { active: ReadonlySet<number> }) {
  const { pitch } = useVocalAxes();
  const vm = useMemo(() => ({ pitch, active }), [pitch, active]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) =>
      drawKeyboard(ctx, s.width, s.height, vm.pitch, vm.active),
    [vm],
  );
  return (
    <div className="relative min-h-0 flex-1 border-r border-line" aria-hidden>
      <CanvasSurface draw={draw} version={vm} className="absolute inset-0" />
    </div>
  );
}

export function PitchEditor({
  clip,
  doc,
  analysis,
  map,
  actions,
  editing,
  selected,
  describedBy,
  claimAutoFit,
}: PitchEditorProps) {
  const session = useSession();
  const { history, uiStore } = session;
  const meter = useProjectState((s) => s.project.meter);
  const followPlayhead = useUiState((s) => s.followPlayhead);
  const { time, pitch } = useVocalAxes();
  const [hovered, setHovered] = useState<VocalNoteId | null>(null);
  const [marquee, setMarquee] = useState<VocalCanvasViewModel['marquee']>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<CanvasSurfaceHandle>(null);
  const pointerSeconds = useRef<number | null>(null);

  // Curves are recomputed only when the analysis or the edit document changes.
  const detected = useMemo(() => pitchTrackMidi(analysis.pitchTrack), [analysis]);
  // Show the correction even while A/B plays the original (drawn faded).
  const target = useMemo(
    () =>
      computeTargetPitchCurve(
        analysis.pitchTrack,
        doc.segments,
        doc.enabled ? doc : { ...doc, enabled: true },
      ),
    [analysis, doc],
  );

  const notes = useMemo<VocalNoteView[]>(
    () =>
      doc.segments.map((segment) => {
        const edit = noteEditOf(doc, segment.id);
        const displayMidi = displayTargetMidi(segment, doc);
        return {
          segment,
          displayMidi,
          moved: hasManualTarget(edit) && !edit.bypass,
          bypassed: edit.bypass,
          rect: vocalNoteRect(segment, displayMidi, time, pitch, map),
        };
      }),
    [doc, time, pitch, map],
  );
  const rects = useMemo(() => notes.map((n) => n.rect), [notes]);
  const key = doc.correction.key;
  const scalePcs = useMemo(
    () => (key ? (scalePitchClasses(key) as ReadonlySet<number>) : new Set<number>()),
    [key],
  );
  const activeKeys = useMemo(
    () =>
      new Set(
        notes.filter((n) => selected.has(n.segment.id)).map((n) => Math.round(n.displayMidi)),
      ),
    [notes, selected],
  );

  const vm = useMemo<VocalCanvasViewModel>(
    () => ({
      time,
      pitch,
      meter,
      map,
      notes,
      selected,
      hovered,
      marquee,
      track: analysis.pitchTrack,
      detected,
      target,
      nonPitched: analysis.nonPitched,
      scalePitchClasses: scalePcs,
      tonic: key?.tonic ?? null,
      correctionAudible: doc.enabled,
    }),
    [
      time,
      pitch,
      meter,
      map,
      notes,
      selected,
      hovered,
      marquee,
      analysis,
      detected,
      target,
      scalePcs,
      key,
      doc.enabled,
    ],
  );
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => drawVocalEditor(ctx, s.width, s.height, vm),
    [vm],
  );

  const fit = useCallback(() => {
    const width = Math.max(200, (rootRef.current?.clientWidth ?? 800) - VOCAL_KEYBOARD_WIDTH);
    const height = Math.max(120, (rootRef.current?.clientHeight ?? 260) - VOCAL_RULER_HEIGHT);
    fitToClip(session, map, doc, width, height);
  }, [session, map, doc]);

  useEffect(() => {
    if (claimAutoFit(clip.id)) fit();
  }, [clip.id, fit, claimAutoFit]);

  useFrame(() => {
    const handle = overlayRef.current;
    const canvas = handle?.canvas;
    const s = handle?.getSize();
    if (!canvas || !s || s.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const position = session.engine.getTransportPosition();
    const tick =
      position.state === 'stopped' ? session.engineStore.getState().cursorTick : position.ticks;
    if (followPlayhead && position.state === 'playing') {
      const next = time.reveal(tick, s.width);
      if (!next.equals(time))
        uiStore.setState((st) => ({ vocal: { ...st.vocal, scrollTick: next.scrollTick } }));
    }
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    drawPlayhead(ctx, time.tickToX(tick), s.height, position.recording);
  });

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    hostRef.current?.focus({ preventScroll: true });
    const { x, y } = point(e);
    const hit = hitTestVocalNote(rects, x, y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) {
      const base = additive ? new Set(selected) : new Set<VocalNoteId>();
      if (!additive) actions.clearSelection();
      startDragGesture(e.nativeEvent, e.currentTarget, {
        threshold: 3,
        onDrag: (dx, dy) => {
          const rect = { x0: x, y0: y, x1: x + dx, y1: y + dy };
          setMarquee(rect);
          const inside = vocalNotesInRect(rects, rect);
          actions.select([...new Set([...base, ...inside])]);
        },
        onEnd: () => setMarquee(null),
      });
      return;
    }
    const noteId = hit.id;
    const wasSelected = selected.has(noteId);
    if (additive) actions.select([noteId], 'toggle');
    else if (!wasSelected) actions.select([noteId]);
    if (additive) return;
    if (!editing) {
      // A plain click on a note of a multi-selection selects just that note.
      if (wasSelected && selected.size > 1) actions.select([noteId]);
      return;
    }
    const ids = wasSelected ? new Set(selected) : new Set([noteId]);
    const startDoc = doc;
    const assetId = clip.assetId;
    let tx: Transaction | null = null;
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 3,
      onDragStart: () => {
        tx = history.beginTransaction(ids.size > 1 ? 'Move Vocal Notes' : 'Move Vocal Note');
      },
      onDrag: (_dx, dy, event) => {
        if (!tx) return;
        const delta = -dy / pitch.rowHeight;
        const mode = snapModeFor(startDoc.correction.key, event.altKey);
        const edits: Record<VocalNoteId, Partial<VocalNoteEdit>> = {};
        for (const segment of startDoc.segments) {
          if (!ids.has(segment.id)) continue;
          const base = displayTargetMidi(segment, startDoc);
          edits[segment.id] = {
            targetMidi: snapTargetMidi(base + delta, startDoc.correction.key, mode),
          };
        }
        tx.applyFromStart([{ type: 'vocal.setNoteEdits', assetId, edits }]);
      },
      onEnd: ({ committed, dragged }) => {
        const active = tx as Transaction | null;
        if (!dragged && committed && wasSelected && ids.size > 1) actions.select([noteId]);
        if (!active) return;
        if (committed) active.commit();
        else active.cancel();
      },
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = point(e);
    const hit = hitTestVocalNote(rects, x, y);
    if (hit) actions.clearTargets([hit.id]);
  };

  useNativeKeyDown(hostRef, (e) =>
    handleVocalKey(e, actions, () => [playheadSourceSeconds(session, map), pointerSeconds.current]),
  );

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const ui = uiStore.getState();
    if (e.ctrlKey || e.metaKey) {
      const { x } = point(e);
      const next = time.zoomAt(Math.exp(-e.deltaY * 0.002), x);
      uiStore.setState({
        vocal: { ...ui.vocal, pxPerTick: next.pxPerTick, scrollTick: next.scrollTick },
      });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      uiStore.setState({ vocal: { ...ui.vocal, scrollTick: time.scrollBy(delta).scrollTick } });
    } else {
      const topPitch = clampTopPitch(
        ui.vocal.topPitch - e.deltaY / ui.vocal.rowHeight,
        size.height,
        ui.vocal.rowHeight,
      );
      uiStore.setState({ vocal: { ...ui.vocal, topPitch } });
    }
  };

  const onHover = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = point(e);
    pointerSeconds.current = tickToSourceSeconds(time.xToTick(x), map);
    if (e.buttons !== 0) return;
    const hit = hitTestVocalNote(rects, x, y);
    const id = hit?.id ?? null;
    if (id !== hovered) setHovered(id);
    e.currentTarget.style.cursor = hit ? (editing ? 'ns-resize' : 'pointer') : 'default';
  };

  return (
    <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1" data-testid="vocal-pitch-editor">
      <div className="flex shrink-0 flex-col" style={{ width: VOCAL_KEYBOARD_WIDTH }}>
        <div
          className="flex shrink-0 items-center justify-center border-r border-b border-line bg-surface-1"
          style={{ height: VOCAL_RULER_HEIGHT }}
        >
          <IconButton
            label="Zoom to clip"
            icon={<Expand />}
            size="sm"
            variant="ghost"
            onClick={fit}
          />
        </div>
        <VocalKeyboard active={activeKeys} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <VocalRuler time={time} map={map} />
        <StudioContextMenu
          target="vocal-note"
          resolve={(e) => {
            const { x, y } = point(e);
            const hit = hitTestVocalNote(rects, x, y);
            return {
              target: hit ? 'vocal-note' : 'vocal-grid',
              entries: vocalMenu(actions, {
                noteId: hit?.id ?? null,
                pointerSeconds: tickToSourceSeconds(time.xToTick(x), map),
              }),
            };
          }}
        >
          <div
            ref={hostRef}
            className="relative min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            tabIndex={0}
            role="application"
            aria-roledescription="pitch editor"
            aria-label={`Pitch editor for ${clip.name}. Click a note to select it, arrow up or down to move by a semitone (Shift for 10 cents), Delete to reset, S to split, M to merge, Escape to deselect.`}
            aria-describedby={describedBy}
            data-testid="vocal-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onHover}
            onPointerLeave={() => setHovered(null)}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
          >
            <CanvasSurface
              draw={draw}
              version={vm}
              onResize={setSize}
              className="absolute inset-0"
            />
            <CanvasSurface
              ref={overlayRef}
              draw={() => undefined}
              className="pointer-events-none absolute inset-0"
            />
          </div>
        </StudioContextMenu>
      </div>
    </div>
  );
}
