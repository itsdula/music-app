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
import { startDragGesture } from '../../lib/drag-gesture';
import { useFrame } from '../../lib/use-frame';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { openClipInEditor, selectClips, selectTrack } from '../../state/ui-store';
import { BROWSER_DRAG_MIME, decodeBrowserItem } from '../browser/browser-items';
import {
  duplicateMoveCommands,
  moveClipsCommands,
  trimEndCommand,
  trimStartCommand,
} from './clip-gestures';
import { clipBoxes, clipsInRect, hitTestClip, layoutRows, rowAtY } from './geometry';
import { drawLanes } from './renderer';
import { useArrangementAxis } from './use-arrangement-axis';

type Marquee = { x0: number; y0: number; x1: number; y1: number } | null;

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
  const followPlayhead = useUiState((s) => s.followPlayhead);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const [marquee, setMarquee] = useState<Marquee>(null);
  const [peaksVersion, setPeaksVersion] = useState(0);
  const [dropHint, setDropHint] = useState(false);
  const surfaceRef = useRef<CanvasSurfaceHandle>(null);
  const overlayRef = useRef<CanvasSurfaceHandle>(null);
  const hostRef = useRef<HTMLDivElement>(null);

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
      peaksVersion,
    }),
    [project, rows, boxes, axis, selectedClipIds, selectedTrackId, marquee, peaksVersion, session],
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    hostRef.current?.focus({ preventScroll: true });
    const { x, y } = localPoint(e);
    const hit = hitTestClip(boxes, x, y);
    const row = rowAtY(rows, y);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) {
      if (row) uiStore.setState((st) => selectTrack(st, row.track.id));
      if (!additive) uiStore.setState((st) => selectClips(st, []));
      const startX = x;
      const startY = y;
      startDragGesture(e.nativeEvent, e.currentTarget, {
        threshold: 4,
        onDrag: (dx, dy) => {
          const rect = { x0: startX, y0: startY, x1: startX + dx, y1: startY + dy };
          setMarquee(rect);
          uiStore.setState((st) =>
            selectClips(st, clipsInRect(boxes, rect), additive ? 'add' : 'replace'),
          );
        },
        onEnd: () => setMarquee(null),
      });
      return;
    }
    const clipId = hit.box.clip.id;
    const alreadySelected = selectedClipIds.has(clipId);
    if (additive) uiStore.setState((st) => selectClips(st, [clipId], 'toggle'));
    else if (!alreadySelected)
      uiStore.setState((st) => selectClips(selectTrack(st, hit.box.clip.trackId), [clipId]));
    else uiStore.setState((st) => selectTrack(st, hit.box.clip.trackId));
    const selection =
      additive || alreadySelected ? [...uiStore.getState().selection.clipIds] : [clipId];
    const startProject = history.present;
    const duplicate = e.altKey && hit.region === 'body';
    let tx: Transaction | null = null;
    const newIds = new Map<ClipId, ClipId>();
    const label =
      hit.region === 'body' ? (duplicate ? 'Duplicate Clips' : 'Move Clips') : 'Trim Clip';
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 3,
      onDragStart: () => {
        tx = history.beginTransaction(label);
      },
      onDrag: (dx, dy) => {
        if (!tx) return;
        if (hit.region === 'body') {
          const input = {
            project: startProject,
            clipIds: selection,
            anchorClipId: clipId,
            rawDeltaTicks: dx / axis.pxPerTick,
            deltaRows: Math.round(dy / trackHeight),
            trackOrder: startProject.trackOrder,
            gridTicks,
          };
          tx.applyFromStart(
            duplicate
              ? duplicateMoveCommands(input, session.ids, newIds)
              : moveClipsCommands(input),
          );
        } else {
          const tick = axis.xToTick(x + dx);
          tx.applyFromStart(
            hit.region === 'start-edge'
              ? trimStartCommand(startProject, clipId, tick, gridTicks)
              : trimEndCommand(startProject, clipId, tick, gridTicks),
          );
        }
      },
      onEnd: ({ committed, dragged }) => {
        const active = tx as Transaction | null;
        if (active) {
          if (committed) active.commit();
          else active.cancel();
        }
        if (duplicate && committed && newIds.size > 0)
          uiStore.setState((st) => selectClips(st, [...newIds.values()]));
        if (!dragged && committed && !additive && alreadySelected)
          uiStore.setState((st) => selectClips(st, [clipId]));
      },
    });
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { x, y } = localPoint(e);
    const hit = hitTestClip(boxes, x, y);
    if (hit) {
      uiStore.setState((st) => openClipInEditor(st, hit.box.clip.id));
      return;
    }
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
      uiStore.setState((st) => openClipInEditor(st, selected[0]!));
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

  const onPointerMoveHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 0) return;
    const { x, y } = localPoint(e);
    const hit = hitTestClip(boxes, x, y);
    e.currentTarget.style.cursor = !hit ? 'default' : hit.region === 'body' ? 'grab' : 'ew-resize';
  };

  return (
    <div
      ref={hostRef}
      className={`relative min-h-0 min-w-0 flex-1 outline-none ${dropHint ? 'ring-2 ring-accent/60 ring-inset' : ''}`}
      tabIndex={0}
      role="application"
      aria-label="Arrangement: clips on tracks. Double-click a track to create a MIDI clip; drag clips to move, drag edges to trim. Keyboard: [ and ] select clips, arrows move them, Enter opens the editor."
      data-testid="arrangement-lanes"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMoveHover}
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
      <span className="sr-only" aria-live="polite" data-testid="arrangement-announcement">
        {announcement}
      </span>
      {tracks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-text-faint">
          Add a track from the browser or the + button to start.
        </div>
      )}
    </div>
  );
}
