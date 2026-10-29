import type { Transaction } from '@studio/commands';
import { gridDivisionTicks, type MidiClip, type MidiNote, type NoteId } from '@studio/domain';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CanvasSurface,
  type CanvasSize,
  type CanvasSurfaceHandle,
} from '../../canvas/canvas-surface';
import { drawPlayhead } from '../../canvas/draw-utils';
import { StudioContextMenu, type MenuResolution } from '../../components/context-menu';
import { startDragGesture } from '../../lib/drag-gesture';
import { resolveCursor, type CursorTarget } from '../../lib/pointer-cursor';
import { useFrame } from '../../lib/use-frame';
import { useAltKey } from '../../lib/use-modifier-keys';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { selectNotes } from '../../state/ui-store';
import { auditionNote } from './audition';
import {
  clampPitch,
  clampTopPitch,
  editableContentRange,
  timelineToContent,
  visibleRowCount,
  yToPitch,
} from './geometry';
import { hitTestNote, notesInRect, type NoteHit, type NoteHitRegion } from './hit-test';
import { gridMenu, noteMenu, noteSelectionForContextClick } from './note-menus';
import { moveNotes, nudgeNotes, resizeNoteEnds, resizeNoteStarts } from './note-edits';
import { drawNoteGrid } from './renderer';
import { usePianoRollAxes } from './use-piano-roll-view';

type Hover = { readonly noteId: NoteId; readonly region: NoteHitRegion } | null;

const CURSOR_TARGET: Record<NoteHitRegion, CursorTarget> = {
  body: 'body',
  'start-edge': 'start-edge',
  'end-edge': 'end-edge',
};

export function PianoRollGrid({ clip, color }: { clip: MidiClip; color: string }) {
  const session = useSession();
  const { history, uiStore, engine } = session;
  const meter = useProjectState((s) => s.project.meter);
  const selected = useUiState((s) => s.selection.noteIds);
  const grid = useUiState((s) => s.grid);
  const snap = useUiState((s) => s.snap);
  const tool = useUiState((s) => s.tool);
  const { time, pitch } = usePianoRollAxes();
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [hover, setHover] = useState<Hover>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const lastLength = useRef<number | null>(null);
  const overlayRef = useRef<CanvasSurfaceHandle>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, inside: false, dragging: false });
  const gridTicks = snap ? gridDivisionTicks(grid, meter) : 0;
  const stepTicks = gridDivisionTicks(grid, meter);

  const vm = useMemo(
    () => ({
      clip,
      color,
      meter,
      time,
      pitch,
      selected,
      marquee,
      hover,
      scaleHighlight: new Set<number>(),
    }),
    [clip, color, meter, time, pitch, selected, marquee, hover],
  );
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => drawNoteGrid(ctx, s.width, s.height, vm),
    [vm],
  );

  useFrame(() => {
    const handle = overlayRef.current;
    const canvas = handle?.canvas;
    const s = handle?.getSize();
    if (!canvas || !s || s.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const position = engine.getTransportPosition();
    const tick =
      position.state === 'stopped' ? session.engineStore.getState().cursorTick : position.ticks;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    drawPlayhead(ctx, time.tickToX(tick), s.height, position.recording);
  });

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const setCursor = (cursor: string) => {
    if (hostRef.current) hostRef.current.style.cursor = cursor;
  };

  /** Snapped content tick of a grid x position, or null outside the editable range. */
  const contentTickAt = (x: number): number | null => {
    const contentTick = timelineToContent(clip, time.xToTick(x));
    const start = Math.max(
      0,
      gridTicks > 0 ? Math.floor(contentTick / gridTicks) * gridTicks : Math.round(contentTick),
    );
    const range = editableContentRange(clip);
    return start < range.start || start >= range.end ? null : start;
  };

  const createNoteAt = (x: number, y: number) => {
    const start = contentTickAt(x);
    if (start === null) return null;
    const range = editableContentRange(clip);
    const p = clampPitch(yToPitch(y, pitch));
    const duration = Math.max(1, Math.min(lastLength.current ?? stepTicks, range.end - start));
    const [created] = session.edits.addNotes(clip.id, [
      { startTick: start, durationTicks: duration, pitch: p, velocity: 100 },
    ]);
    if (created) {
      uiStore.setState((s) => selectNotes(s, [created.id]));
      auditionNote(engine, clip.trackId, p);
    }
    return created ?? null;
  };

  const hoverCursor = (hit: NoteHit | null, x: number, alt: boolean) =>
    hit
      ? resolveCursor({ target: CURSOR_TARGET[hit.region], tool, modifiers: { alt } })
      : resolveCursor({
          target: 'empty',
          tool,
          modifiers: { alt },
          // Drawing outside the clip's editable window is not possible.
          allowed: tool !== 'draw' || contentTickAt(x) !== null,
        });

  const refreshHover = (x: number, y: number, alt: boolean) => {
    const hit = hitTestNote(clip, time, pitch, x, y);
    const next: Hover = hit ? { noteId: hit.note.id, region: hit.region } : null;
    setHover((prev) =>
      prev?.noteId === next?.noteId && prev?.region === next?.region ? prev : next,
    );
    setCursor(hoverCursor(hit, x, alt));
  };

  useAltKey((alt) => {
    const p = pointer.current;
    if (p.inside && !p.dragging) refreshHover(p.x, p.y, alt);
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    hostRef.current?.focus({ preventScroll: true });
    const { x, y } = point(e);
    const hit = hitTestNote(clip, time, pitch, x, y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) {
      if (tool === 'draw') {
        // Draw = add a note and drag its length: one transaction, one undo entry.
        const start = contentTickAt(x);
        if (start === null) return;
        const range = editableContentRange(clip);
        const p = clampPitch(yToPitch(y, pitch));
        const note = {
          id: session.ids.create('note'),
          startTick: start,
          durationTicks: Math.max(1, Math.min(lastLength.current ?? stepTicks, range.end - start)),
          pitch: p,
          velocity: 100,
        };
        const add = { type: 'notes.add' as const, clipId: clip.id, notes: [note] };
        const tx = history.beginTransaction('Draw Note');
        if (!tx.apply(add).ok) {
          tx.cancel();
          return;
        }
        uiStore.setState((s) => selectNotes(s, [note.id]));
        auditionNote(engine, clip.trackId, p);
        pointer.current.dragging = true;
        setCursor(resolveCursor({ target: 'end-edge', tool, modifiers: { alt: false } }));
        startDragGesture(e.nativeEvent, e.currentTarget, {
          threshold: 2,
          onDrag: (dx) => {
            const withNote = { ...clip, notes: [...clip.notes, note] };
            const patches = resizeNoteEnds(
              withNote,
              new Set([note.id]),
              note.id,
              dx / time.pxPerTick,
              { gridTicks },
            );
            tx.applyFromStart([
              add,
              ...(patches.length > 0
                ? [{ type: 'notes.update' as const, clipId: clip.id, patches }]
                : []),
            ]);
          },
          onEnd: ({ committed, dragged, event }) => {
            pointer.current.dragging = false;
            if (!committed) {
              tx.cancel();
            } else {
              tx.commit();
              if (dragged) {
                const after = history.present.clips[clip.id];
                const drawn =
                  after?.kind === 'midi' ? after.notes.find((n) => n.id === note.id) : undefined;
                if (drawn) lastLength.current = drawn.durationTicks;
              }
            }
            if (event && hostRef.current) {
              const at = point(event);
              refreshHover(at.x, at.y, event.altKey);
            }
          },
        });
        return;
      }
      if (!additive) uiStore.setState((s) => selectNotes(s, []));
      const sx = x;
      const sy = y;
      startDragGesture(e.nativeEvent, e.currentTarget, {
        threshold: 3,
        onDragStart: () => {
          pointer.current.dragging = true;
          setCursor(
            resolveCursor({ target: 'empty', tool, modifiers: { alt: false }, dragging: true }),
          );
        },
        onDrag: (dx, dy) => {
          const rect = { x0: sx, y0: sy, x1: sx + dx, y1: sy + dy };
          setMarquee(rect);
          uiStore.setState((s) =>
            selectNotes(s, notesInRect(clip, time, pitch, rect), additive ? 'add' : 'replace'),
          );
        },
        onEnd: () => {
          pointer.current.dragging = false;
          setMarquee(null);
          setCursor(hoverCursor(null, sx, false));
        },
      });
      return;
    }
    const noteId = hit.note.id;
    const wasSelected = selected.has(noteId);
    if (additive) uiStore.setState((s) => selectNotes(s, [noteId], 'toggle'));
    else if (!wasSelected) uiStore.setState((s) => selectNotes(s, [noteId]));
    const ids = new Set<NoteId>(
      additive || wasSelected ? uiStore.getState().selection.noteIds : [noteId],
    );
    if (hit.region === 'body')
      auditionNote(engine, clip.trackId, hit.note.pitch, hit.note.velocity);
    const startClip = clip;
    // Alt/Option-drag on a body duplicates: copies follow the pointer, originals stay put.
    const duplicate = e.altKey && hit.region === 'body';
    const copyIds = new Map<NoteId, NoteId>();
    const target = CURSOR_TARGET[hit.region];
    let tx: Transaction | null = null;
    let lastPitchDelta = 0;
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 3,
      onDragStart: () => {
        pointer.current.dragging = true;
        tx = history.beginTransaction(
          hit.region === 'body'
            ? duplicate
              ? 'Duplicate Notes'
              : ids.size > 1
                ? 'Move Notes'
                : 'Move Note'
            : 'Resize Notes',
        );
        setCursor(resolveCursor({ target, tool, modifiers: { alt: duplicate }, dragging: true }));
      },
      onDrag: (dx, dy) => {
        if (!tx) return;
        const dt = dx / time.pxPerTick;
        let patches;
        if (hit.region === 'body') {
          const dp = -Math.round(dy / pitch.rowHeight);
          patches = moveNotes(startClip, ids, noteId, dt, dp, { gridTicks });
          if (dp !== lastPitchDelta) {
            lastPitchDelta = dp;
            auditionNote(
              engine,
              clip.trackId,
              clampPitch(hit.note.pitch + dp),
              hit.note.velocity,
              160,
            );
          }
          if (duplicate) {
            const byId = new Map(startClip.notes.map((n) => [n.id, n]));
            const copies: MidiNote[] = [];
            for (const patch of patches) {
              const original = byId.get(patch.id);
              if (!original) continue;
              let id = copyIds.get(patch.id);
              if (!id) {
                id = session.ids.create('note');
                copyIds.set(patch.id, id);
              }
              copies.push({ ...original, ...patch, id });
            }
            tx.applyFromStart(
              copies.length > 0 ? [{ type: 'notes.add', clipId: clip.id, notes: copies }] : [],
            );
            return;
          }
        } else if (hit.region === 'end-edge') {
          patches = resizeNoteEnds(startClip, ids, noteId, dt, { gridTicks });
        } else {
          patches = resizeNoteStarts(startClip, ids, noteId, dt, { gridTicks });
        }
        tx.applyFromStart(
          patches.length > 0 ? [{ type: 'notes.update', clipId: clip.id, patches }] : [],
        );
      },
      onEnd: ({ committed, event }) => {
        pointer.current.dragging = false;
        const active = tx as Transaction | null;
        if (active) {
          if (committed) {
            active.commit();
            if (duplicate && copyIds.size > 0)
              uiStore.setState((s) => selectNotes(s, [...copyIds.values()]));
            if (hit.region !== 'body') {
              const after = history.present.clips[clip.id];
              const note =
                after?.kind === 'midi' ? after.notes.find((n) => n.id === noteId) : undefined;
              if (note) lastLength.current = note.durationTicks;
            }
          } else active.cancel();
        }
        if (event && hostRef.current) {
          const at = point(event);
          refreshHover(at.x, at.y, event.altKey);
        }
      },
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool === 'draw') return;
    const { x, y } = point(e);
    const hit = hitTestNote(clip, time, pitch, x, y);
    if (hit) {
      session.edits.deleteNotes(clip.id, [hit.note.id]);
      return;
    }
    createNoteAt(x, y);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const ids = uiStore.getState().selection.noteIds;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    let handled = true;
    if ((e.key === 'Delete' || e.key === 'Backspace') && ids.size > 0) {
      session.edits.deleteNotes(clip.id, ids);
    } else if (e.key.startsWith('Arrow') && ids.size > 0) {
      const dt = e.key === 'ArrowLeft' ? -stepTicks : e.key === 'ArrowRight' ? stepTicks : 0;
      const dp =
        e.key === 'ArrowUp'
          ? e.shiftKey
            ? 12
            : 1
          : e.key === 'ArrowDown'
            ? e.shiftKey
              ? -12
              : -1
            : 0;
      const patches = nudgeNotes(clip, ids, dt, dp);
      if (patches.length > 0)
        history.execute(
          { type: 'notes.update', clipId: clip.id, patches },
          { label: 'Nudge Notes', coalesceKey: `nudge:${clip.id}` },
        );
    } else if (mod && key === 'a') {
      uiStore.setState((s) =>
        selectNotes(
          s,
          clip.notes.map((n) => n.id),
        ),
      );
    } else if (!mod && key === 'q') {
      const target = ids.size > 0 ? [...ids] : clip.notes.map((n) => n.id);
      if (target.length > 0) session.edits.quantizeNotes(clip.id, target, stepTicks);
    } else if (mod && key === 'd' && ids.size > 0) {
      session.edits.duplicateNotes(clip.id, ids);
    } else if (mod && key === 'c' && ids.size > 0) {
      session.edits.copyNotes(clip.id, ids);
    } else if (mod && key === 'x' && ids.size > 0) {
      session.edits.cutNotes(clip.id, ids);
    } else if (mod && key === 'v' && session.edits.hasNoteClipboard) {
      // Paste at the playhead when it is inside the clip, else at the clip's content start.
      const cursor = timelineToContent(clip, session.engineStore.getState().cursorTick);
      const range = editableContentRange(clip);
      const at = cursor >= range.start && cursor < range.end ? cursor : range.start;
      session.edits.pasteNotes(
        clip.id,
        gridTicks > 0 ? Math.floor(at / gridTicks) * gridTicks : at,
      );
    } else if (e.key === 'Escape') {
      uiStore.setState((s) => selectNotes(s, []));
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const ui = uiStore.getState();
    if (e.ctrlKey || e.metaKey) {
      const { x } = point(e);
      const next = time.zoomAt(Math.exp(-e.deltaY * 0.002), x);
      uiStore.setState({
        pianoRoll: { ...ui.pianoRoll, pxPerTick: next.pxPerTick, scrollTick: next.scrollTick },
      });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      uiStore.setState({
        pianoRoll: { ...ui.pianoRoll, scrollTick: time.scrollBy(delta).scrollTick },
      });
    } else {
      const topPitch = clampTopPitch(
        ui.pianoRoll.topPitch - e.deltaY / ui.pianoRoll.rowHeight,
        size.height,
        ui.pianoRoll.rowHeight,
      );
      uiStore.setState({ pianoRoll: { ...ui.pianoRoll, topPitch } });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = point(e);
    pointer.current = { ...pointer.current, x, y, inside: true };
    if (e.buttons !== 0) return;
    refreshHover(x, y, e.altKey);
  };

  const onPointerLeave = () => {
    pointer.current.inside = false;
    if (!pointer.current.dragging) setHover(null);
  };

  /** Right-click: a note (acting on the note selection when it is selected) or the grid. */
  const resolveMenu = (e: React.MouseEvent<HTMLElement>): MenuResolution => {
    const { x, y } = point(e);
    const inside = x >= 0 && y >= 0 && x <= size.width && y <= size.height;
    const hit = inside ? hitTestNote(clip, time, pitch, x, y) : null;
    const atContentTick = inside ? contentTickAt(x) : null;
    if (hit) {
      return {
        target: 'note',
        entries: noteMenu(session, clip, {
          noteIds: noteSelectionForContextClick(session, clip, hit.note.id),
          anchorId: hit.note.id,
          atContentTick: atContentTick ?? hit.note.startTick,
        }),
      };
    }
    // Context-menu key on a selection: the note menu for the selected notes.
    const selectedIds = clip.notes.filter((n) => selected.has(n.id)).map((n) => n.id);
    if (!inside && selectedIds.length > 0)
      return {
        target: 'note',
        entries: noteMenu(session, clip, {
          noteIds: selectedIds,
          anchorId: selectedIds[0]!,
          atContentTick: editableContentRange(clip).start,
        }),
      };
    return {
      target: 'grid',
      entries: gridMenu(session, clip, {
        atContentTick,
        addNote: atContentTick !== null ? () => void createNoteAt(x, y) : null,
      }),
    };
  };

  return (
    <StudioContextMenu target="grid" resolve={resolveMenu}>
      <div
        ref={hostRef}
        className="relative min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
        tabIndex={0}
        role="application"
        aria-label={`Piano roll for ${clip.name}. Double-click to add or delete notes, drag to move (Alt to copy), drag note edges to resize, arrows to nudge, Q to quantize. Right-click for more actions.`}
        data-testid="piano-roll-grid"
        data-row-height={pitch.rowHeight}
        data-visible-rows={visibleRowCount(size.height, pitch.rowHeight)}
        data-hover-region={hover?.region ?? ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      >
        <CanvasSurface draw={draw} version={vm} onResize={setSize} className="absolute inset-0" />
        <CanvasSurface
          ref={overlayRef}
          draw={() => undefined}
          className="pointer-events-none absolute inset-0"
        />
        <span className="sr-only" aria-live="polite">
          {clip.notes.length} notes, {selected.size} selected
        </span>
      </div>
    </StudioContextMenu>
  );
}
