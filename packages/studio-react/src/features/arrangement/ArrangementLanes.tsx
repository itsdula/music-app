import type { Transaction } from '@studio/commands';
import {
  clipEndTick,
  formatBarsBeats,
  gridDivisionTicks,
  orderedTracks,
  snapTick,
  ticksPerBar,
  type ClipId,
  type TrackId,
} from '@studio/domain';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CanvasSurface,
  type CanvasSize,
  type CanvasSurfaceHandle,
} from '../../canvas/canvas-surface';
import { drawPlayhead } from '../../canvas/draw-utils';
import { RenameField, StudioContextMenu, type MenuResolution } from '../../components/context-menu';
import { startDragGesture } from '../../lib/drag-gesture';
import { revealClipInEditor, showClipOnSelect } from '../../lib/editor-navigation';
import { resolveCursor, type CursorTarget } from '../../lib/pointer-cursor';
import { useFrame } from '../../lib/use-frame';
import { useAltKey } from '../../lib/use-modifier-keys';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { selectClips, selectTrack } from '../../state/ui-store';
import { BROWSER_DRAG_MIME, decodeBrowserItem } from '../browser/browser-items';
import { laneMenu, regionMenu, selectionForContextClick } from './arrangement-menus';
import {
  duplicateMoveCommands,
  loopExtendCommands,
  moveClipsCommands,
  trackAccepts,
  trimEndCommand,
  trimStartCommand,
} from './clip-gestures';
import {
  clipBoxes,
  clipsInRect,
  hitTestClip,
  layoutRows,
  rowAtY,
  type ClipHit,
  type ClipHitRegion,
} from './geometry';
import { drawLanes } from './renderer';
import { useArrangementAxis } from './use-arrangement-axis';

type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;
type Hover = { readonly clipId: ClipId; readonly region: ClipHitRegion } | null;

const CURSOR_TARGET: Record<ClipHitRegion, CursorTarget> = {
  body: 'body',
  'start-edge': 'start-edge',
  'end-edge': 'end-edge',
  'loop-end': 'loop-handle',
};

export function ArrangementLanes() {
  const session = useSession();
  const { history, uiStore, edits } = session;
  const project = useProjectState((s) => s.project);
  const axis = useArrangementAxis();
  const trackHeight = useUiState((s) => s.arrangement.trackHeight);
  const scrollY = useUiState((s) => s.arrangement.scrollY);
  const selectedClipIds = useUiState((s) => s.selection.clipIds);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const grid = useUiState((s) => s.grid);
  const snap = useUiState((s) => s.snap);
  const tool = useUiState((s) => s.tool);
  const followPlayhead = useUiState((s) => s.followPlayhead);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [renaming, setRenaming] = useState<ClipId | null>(null);
  const [peaksVersion, setPeaksVersion] = useState(0);
  const [dropHint, setDropHint] = useState(false);
  const surfaceRef = useRef<CanvasSurfaceHandle>(null);
  const overlayRef = useRef<CanvasSurfaceHandle>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  /** Last hover position (for refreshing the cursor when Alt changes) and gesture flag. */
  const pointer = useRef<{ x: number; y: number; inside: boolean; dragging: boolean }>({
    x: 0,
    y: 0,
    inside: false,
    dragging: false,
  });

  useEffect(() => session.assets.subscribe(() => setPeaksVersion((v) => v + 1)), [session]);

  const tracks = useMemo(() => orderedTracks(project), [project]);
  const rows = useMemo(
    () => layoutRows(tracks, trackHeight, scrollY),
    [tracks, trackHeight, scrollY],
  );
  const boxes = useMemo(
    () => clipBoxes(project, rows, axis, size.width, size.height),
    [project, rows, axis, size.width, size.height],
  );
  const gridTicks = snap ? gridDivisionTicks(grid, project.meter) : 0;

  const viewModel = useMemo(
    () => ({
      project,
      rows,
      boxes,
      time: axis,
      meter: project.meter,
      selectedClipIds,
      selectedTrackId,
      peaks: (
        assetId: Parameters<typeof session.assets.readPeaks>[0],
        a: number,
        b: number,
        c: number,
      ) => session.assets.readPeaks(assetId, a, b, c),
      marquee,
      hover,
      peaksVersion,
    }),
    [
      project,
      rows,
      boxes,
      axis,
      selectedClipIds,
      selectedTrackId,
      marquee,
      hover,
      peaksVersion,
      session,
    ],
  );

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => drawLanes(ctx, s.width, s.height, viewModel),
    [viewModel],
  );

  // Playhead overlay + follow-scroll, outside React.
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
    const ui = uiStore.getState();
    if (followPlayhead && position.state === 'playing') {
      const x = axis.tickToX(tick);
      if (x > s.width - 40 || x < 0) {
        uiStore.setState({
          arrangement: {
            ...ui.arrangement,
            scrollTick: Math.max(0, tick - (s.width * 0.1) / axis.pxPerTick),
          },
        });
      }
    }
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.width, s.height);
    drawPlayhead(ctx, axis.tickToX(tick), s.height, position.recording);
  });

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const setCursor = (cursor: string) => {
    if (hostRef.current) hostRef.current.style.cursor = cursor;
  };

  /** Hover cursor for a point: what a press would do there. */
  const hoverCursor = (hit: ClipHit | null, y: number, alt: boolean) => {
    if (hit) return resolveCursor({ target: CURSOR_TARGET[hit.region], tool, modifiers: { alt } });
    const row = rowAtY(rows, y);
    return resolveCursor({
      target: 'empty',
      tool,
      modifiers: { alt },
      // The draw tool creates MIDI clips: impossible on audio/vocal lanes or below the tracks.
      allowed: tool !== 'draw' || row?.track.kind === 'instrument',
    });
  };

  const refreshHover = (x: number, y: number, alt: boolean) => {
    const hit = hitTestClip(boxes, x, y);
    const next: Hover = hit ? { clipId: hit.box.clip.id, region: hit.region } : null;
    setHover((prev) =>
      prev?.clipId === next?.clipId && prev?.region === next?.region ? prev : next,
    );
    setCursor(hoverCursor(hit, y, alt));
  };

  useAltKey((alt) => {
    const p = pointer.current;
    if (p.inside && !p.dragging) refreshHover(p.x, p.y, alt);
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    hostRef.current?.focus({ preventScroll: true });
    const { x, y } = localPoint(e);
    const hit = hitTestClip(boxes, x, y);
    const row = rowAtY(rows, y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) {
      if (row) uiStore.setState((st) => selectTrack(st, row.track.id));
      if (tool === 'draw') {
        // Draw tool: click an instrument lane to create a one-bar MIDI clip there.
        if (row?.track.kind === 'instrument') {
          const raw = axis.xToTick(x);
          const start = gridTicks > 0 ? snapTick(raw, gridTicks, 'floor') : Math.round(raw);
          edits.createMidiClip(row.track.id, Math.max(0, start));
        }
        return;
      }
      if (!additive) uiStore.setState((st) => selectClips(st, []));
      const startX = x;
      const startY = y;
      startDragGesture(e.nativeEvent, e.currentTarget, {
        threshold: 4,
        onDragStart: () => {
          pointer.current.dragging = true;
          setCursor(
            resolveCursor({ target: 'empty', tool, modifiers: { alt: false }, dragging: true }),
          );
        },
        onDrag: (dx, dy) => {
          const rect = { x0: startX, y0: startY, x1: startX + dx, y1: startY + dy };
          setMarquee(rect);
          uiStore.setState((st) =>
            selectClips(st, clipsInRect(boxes, rect), additive ? 'add' : 'replace'),
          );
        },
        onEnd: () => {
          pointer.current.dragging = false;
          setMarquee(null);
          setCursor(hoverCursor(null, y, false));
        },
      });
      return;
    }
    const clipId = hit.box.clip.id;
    const alreadySelected = selectedClipIds.has(clipId);
    if (additive) uiStore.setState((st) => selectClips(st, [clipId], 'toggle'));
    else if (!alreadySelected)
      uiStore.setState((st) => selectClips(selectTrack(st, hit.box.clip.trackId), [clipId]));
    else uiStore.setState((st) => selectTrack(st, hit.box.clip.trackId));
    // A plain click on a clip also shows it in the editor (piano roll for MIDI clips).
    if (!additive) uiStore.setState((st) => showClipOnSelect(st, clipId));
    const selection =
      additive || alreadySelected ? [...uiStore.getState().selection.clipIds] : [clipId];
    const startProject = history.present;
    const duplicate = e.altKey && hit.region === 'body';
    let tx: Transaction | null = null;
    const newIds = new Map<ClipId, ClipId>();
    const label =
      hit.region === 'body'
        ? duplicate
          ? 'Duplicate Clips'
          : 'Move Clips'
        : hit.region === 'loop-end'
          ? 'Loop Clip'
          : 'Trim Clip';
    const target = CURSOR_TARGET[hit.region];
    const startRow = startProject.trackOrder.indexOf(hit.box.clip.trackId);
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 3,
      onDragStart: () => {
        pointer.current.dragging = true;
        tx = history.beginTransaction(label);
        setCursor(resolveCursor({ target, tool, modifiers: { alt: duplicate }, dragging: true }));
      },
      onDrag: (dx, dy) => {
        if (!tx) return;
        if (hit.region === 'body') {
          const deltaRows = Math.round(dy / trackHeight);
          const input = {
            project: startProject,
            clipIds: selection,
            anchorClipId: clipId,
            rawDeltaTicks: dx / axis.pxPerTick,
            deltaRows,
            trackOrder: startProject.trackOrder,
            gridTicks,
          };
          tx.applyFromStart(
            duplicate
              ? duplicateMoveCommands(input, session.ids, newIds)
              : moveClipsCommands(input),
          );
          // Over a lane that cannot take the clip (MIDI ↔ audio): show it is not possible.
          const order = startProject.trackOrder;
          const targetId = order[Math.min(order.length - 1, Math.max(0, startRow + deltaRows))];
          const targetTrack = targetId ? startProject.tracks[targetId] : undefined;
          const allowed = !targetTrack || trackAccepts(targetTrack, hit.box.clip);
          setCursor(
            resolveCursor({ target, tool, modifiers: { alt: duplicate }, dragging: true, allowed }),
          );
        } else {
          const tick = axis.xToTick(x + dx);
          tx.applyFromStart(
            hit.region === 'start-edge'
              ? trimStartCommand(startProject, clipId, tick, gridTicks)
              : hit.region === 'loop-end'
                ? loopExtendCommands(startProject, clipId, tick, gridTicks)
                : trimEndCommand(startProject, clipId, tick, gridTicks),
          );
        }
      },
      onEnd: ({ committed, dragged, event }) => {
        pointer.current.dragging = false;
        const active = tx as Transaction | null;
        if (active) {
          if (committed) active.commit();
          else active.cancel();
        }
        if (duplicate && committed && newIds.size > 0)
          uiStore.setState((st) => selectClips(st, [...newIds.values()]));
        if (!dragged && committed && !additive && alreadySelected)
          uiStore.setState((st) => selectClips(st, [clipId]));
        if (event && hostRef.current) {
          const p = localPoint(event);
          refreshHover(p.x, p.y, event.altKey);
        }
      },
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = localPoint(e);
    const hit = hitTestClip(boxes, x, y);
    if (hit) {
      uiStore.setState((st) => revealClipInEditor(st, hit.box.clip.id));
      return;
    }
    if (tool === 'draw') return; // the press already created a clip
    const row = rowAtY(rows, y);
    if (row?.track.kind === 'instrument') {
      const start = snapTick(axis.xToTick(x), gridDivisionTicks('bar', project.meter), 'floor');
      edits.createMidiClip(row.track.id, start);
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const ui = uiStore.getState();
    if (e.ctrlKey || e.metaKey) {
      const { x } = localPoint(e);
      const next = axis.zoomAt(Math.exp(-e.deltaY * 0.002), x);
      uiStore.setState({
        arrangement: { ...ui.arrangement, pxPerTick: next.pxPerTick, scrollTick: next.scrollTick },
      });
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      uiStore.setState({
        arrangement: { ...ui.arrangement, scrollTick: axis.scrollBy(delta).scrollTick },
      });
    } else {
      const maxScroll = Math.max(0, tracks.length * trackHeight - size.height + 40);
      uiStore.setState({
        arrangement: {
          ...ui.arrangement,
          scrollY: Math.min(maxScroll, Math.max(0, ui.arrangement.scrollY + e.deltaY)),
        },
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const selected = [...selectedClipIds].filter((id) => project.clips[id]);
    const step = e.shiftKey ? ticksPerBar(project.meter) : gridDivisionTicks(grid, project.meter);
    let handled = true;
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey) {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (selected.length > 0) {
        const commands = moveClipsCommands({
          project,
          clipIds: selected,
          anchorClipId: selected[0]!,
          rawDeltaTicks: dir * step,
          deltaRows: 0,
          trackOrder: project.trackOrder,
          gridTicks: 0,
        });
        if (commands.length > 0)
          history.executeBatch(commands, { label: 'Nudge Clips', coalesceKey: 'nudge-clips' });
      } else {
        const cursor = session.engineStore.getState().cursorTick;
        void session.transport.seek(Math.max(0, snapTick(cursor + dir * step, step)));
      }
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selected.length > 0) {
      const commands = moveClipsCommands({
        project,
        clipIds: selected,
        anchorClipId: selected[0]!,
        rawDeltaTicks: 0,
        deltaRows: e.key === 'ArrowUp' ? -1 : 1,
        trackOrder: project.trackOrder,
        gridTicks: 0,
      });
      if (commands.length > 0) history.executeBatch(commands, { label: 'Move Clips' });
    } else if (e.key === '[' || e.key === ']') {
      const trackId = uiStore.getState().selection.trackId ?? project.trackOrder[0];
      const onTrack = Object.values(project.clips)
        .filter((c) => c.trackId === trackId)
        .sort((a, b) => a.startTick - b.startTick);
      if (onTrack.length === 0) return;
      const current = onTrack.findIndex((c) => selectedClipIds.has(c.id));
      const nextIndex =
        current < 0
          ? 0
          : Math.min(onTrack.length - 1, Math.max(0, current + (e.key === ']' ? 1 : -1)));
      const next = onTrack[nextIndex]!;
      uiStore.setState((st) => selectClips(st, [next.id]));
    } else if (e.key === 'Enter' && selected.length > 0) {
      uiStore.setState((st) => revealClipInEditor(st, selected[0]!));
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const announcement = (() => {
    const ids = [...selectedClipIds].filter((id) => project.clips[id]);
    if (ids.length === 0) return 'No clips selected';
    if (ids.length > 1) return `${ids.length} clips selected`;
    const clip = project.clips[ids[0]!]!;
    const track = project.tracks[clip.trackId];
    return `${clip.name} on ${track?.name ?? 'track'}, ${formatBarsBeats(clip.startTick, project.meter)} to ${formatBarsBeats(Math.round(clipEndTick(clip, project)), project.meter)}`;
  })();

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(BROWSER_DRAG_MIME) || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropHint(true);
    }
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDropHint(false);
    const { x, y } = localPoint(e);
    const row = rowAtY(rows, y);
    const tick = Math.max(
      0,
      gridTicks > 0 ? snapTick(axis.xToTick(x), gridTicks) : Math.round(axis.xToTick(x)),
    );
    const report = (error: unknown) =>
      session.engineStore.setState({
        lastError: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    if (e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      void (async () => {
        const picked = await Promise.all(
          files.map(async (f) => ({
            name: f.name,
            mimeType: f.type,
            bytes: new Uint8Array(await f.arrayBuffer()),
          })),
        );
        const trackId: TrackId | undefined =
          row && row.track.kind !== 'instrument' ? row.track.id : undefined;
        await edits.importAudio(picked, { ...(trackId ? { trackId } : {}), atTick: tick });
      })().catch(report);
      return;
    }
    const item = decodeBrowserItem(e.dataTransfer.getData(BROWSER_DRAG_MIME));
    if (!item) return;
    if (item.kind === 'instrument') {
      edits.addTrack('instrument', {
        instrument: item.instrument,
        ...(item.presetId ? { presetId: item.presetId } : {}),
      });
    } else if (item.kind === 'effect') {
      edits.addEffect(row?.track.id ?? 'master', item.effect);
    } else {
      edits.placeAsset(
        item.assetId,
        row && row.track.kind !== 'instrument' ? row.track.id : null,
        tick,
      );
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = localPoint(e);
    pointer.current = { ...pointer.current, x, y, inside: true };
    if (e.buttons !== 0) return;
    refreshHover(x, y, e.altKey);
  };

  const onPointerLeave = () => {
    pointer.current.inside = false;
    if (!pointer.current.dragging) setHover(null);
  };

  /** Right-click: a clip (acting on the whole selection when it is selected) or the lane. */
  const resolveMenu = (e: React.MouseEvent<HTMLElement>): MenuResolution => {
    const rect = hostRef.current!.getBoundingClientRect();
    const fromKeyboard =
      (e.clientX === 0 && e.clientY === 0) ||
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;
    const { x, y } = localPoint(e);
    const cursor = session.engineStore.getState().cursorTick;
    if (fromKeyboard) {
      // Context-menu key: act on the current selection, else the selected track's lane.
      const first = [...uiStore.getState().selection.clipIds].find((id) => project.clips[id]);
      const clip = first ? project.clips[first] : undefined;
      if (clip)
        return {
          target: 'region',
          entries: regionMenu(session, {
            clipIds: selectionForContextClick(session, clip),
            anchorClipId: clip.id,
            atTick: cursor,
            onRename: setRenaming,
          }),
        };
      return {
        target: 'lane',
        entries: laneMenu(session, {
          trackId: uiStore.getState().selection.trackId,
          atTick: cursor,
        }),
      };
    }
    const raw = Math.max(0, axis.xToTick(x));
    const atTick = gridTicks > 0 ? snapTick(raw, gridTicks, 'floor') : Math.round(raw);
    const hit = hitTestClip(boxes, x, y);
    if (hit) {
      const clipIds = selectionForContextClick(session, hit.box.clip);
      return {
        target: 'region',
        entries: regionMenu(session, {
          clipIds,
          anchorClipId: hit.box.clip.id,
          atTick,
          onRename: setRenaming,
        }),
      };
    }
    const row = rowAtY(rows, y);
    if (row) uiStore.setState((st) => selectTrack(st, row.track.id));
    return {
      target: 'lane',
      entries: laneMenu(session, { trackId: row?.track.id ?? null, atTick }),
    };
  };

  const renameBox = renaming ? boxes.find((b) => b.clip.id === renaming) : undefined;

  return (
    <StudioContextMenu target="lane" resolve={resolveMenu}>
      <div
        ref={hostRef}
        className={`relative min-h-0 min-w-0 flex-1 outline-none ${dropHint ? 'ring-2 ring-accent/60 ring-inset' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="Arrangement: clips on tracks. Click a clip to edit it below, double-click a track to create a MIDI clip; drag clips to move, drag edges to trim, drag the top-right corner to loop. Right-click for more actions. Keyboard: [ and ] select clips, arrows move them, Enter opens the editor."
        data-testid="arrangement-lanes"
        data-hover-region={hover?.region ?? ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(false)}
        onDrop={onDrop}
      >
        <CanvasSurface
          ref={surfaceRef}
          draw={draw}
          version={viewModel}
          onResize={setSize}
          className="absolute inset-0"
        />
        <CanvasSurface
          ref={overlayRef}
          draw={() => undefined}
          className="pointer-events-none absolute inset-0"
        />
        {renaming && renameBox && (
          <RenameField
            key={renaming}
            className="absolute z-10 rounded border border-accent bg-surface-0 px-1 text-[11px] text-text outline-none"
            style={{
              left: Math.max(0, renameBox.x),
              top: renameBox.y,
              width: Math.max(120, Math.min(renameBox.w, 260)),
              height: 18,
            }}
            defaultValue={renameBox.clip.name}
            label="Clip name"
            testId="clip-rename-input"
            onCommit={(name) => edits.renameClip(renaming, name)}
            onDone={() => {
              setRenaming(null);
              hostRef.current?.focus({ preventScroll: true });
            }}
          />
        )}
        <span className="sr-only" aria-live="polite" data-testid="arrangement-announcement">
          {announcement}
        </span>
        {tracks.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-text-faint">
            Add a track from the browser or the + button to start.
          </div>
        )}
      </div>
    </StudioContextMenu>
  );
}
