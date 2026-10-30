import { gridDivisionTicks } from '@studio/domain';
import { colors } from '@studio/ui';
import { useCallback, useRef } from 'react';
import { CanvasSurface, type CanvasSurfaceHandle } from '../../canvas/canvas-surface';
import { drawPlayhead } from '../../canvas/draw-utils';
import { startDragGesture } from '../../lib/drag-gesture';
import { useFrame } from '../../lib/use-frame';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { StudioContextMenu } from '../../components/context-menu';
import { rulerMenu } from './arrangement-menus';
import { loopCommand } from './clip-gestures';
import { LOOP_BAR_HEIGHT, RULER_HEIGHT } from './geometry';
import { drawRuler } from './renderer';
import { useArrangementAxis } from './use-arrangement-axis';

export function ArrangementRuler() {
  const session = useSession();
  const axis = useArrangementAxis();
  const meter = useProjectState((s) => s.project.meter);
  const loop = useProjectState((s) => s.project.loop);
  const grid = useUiState((s) => s.grid);
  const snap = useUiState((s) => s.snap);
  const overlayRef = useRef<CanvasSurfaceHandle>(null);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: { width: number; height: number }) =>
      drawRuler(ctx, size.width, size.height, axis, meter, loop, LOOP_BAR_HEIGHT),
    [axis, meter, loop],
  );

  useFrame(() => {
    const canvas = overlayRef.current?.canvas;
    const size = overlayRef.current?.getSize();
    if (!canvas || !size || size.width === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const position = session.engine.getTransportPosition();
    const tick =
      position.state === 'stopped' ? session.engineStore.getState().cursorTick : position.ticks;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    const x = axis.tickToX(tick);
    if (x < -2 || x > size.width + 2) return;
    ctx.fillStyle = position.recording ? colors.record : colors.text;
    ctx.beginPath();
    ctx.moveTo(x - 5, LOOP_BAR_HEIGHT);
    ctx.lineTo(x + 5, LOOP_BAR_HEIGHT);
    ctx.lineTo(x, LOOP_BAR_HEIGHT + 7);
    ctx.closePath();
    ctx.fill();
    drawPlayhead(ctx, x, size.height, position.recording);
  });

  const gridTicks = snap ? gridDivisionTicks(grid, meter) : 0;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tick = axis.xToTick(x);
    if (y <= LOOP_BAR_HEIGHT + 2) {
      // Loop bar: drag edges/body or draw a new loop.
      const x0 = axis.tickToX(loop.startTick);
      const x1 = axis.tickToX(loop.endTick);
      const mode =
        Math.abs(x - x0) < 6
          ? 'start'
          : Math.abs(x - x1) < 6
            ? 'end'
            : x > x0 && x < x1
              ? 'move'
              : 'draw';
      const tx = session.history.beginTransaction('Set Loop');
      startDragGesture(e.nativeEvent, e.currentTarget, {
        threshold: 2,
        onDrag: (dx) => {
          const dt = dx / axis.pxPerTick;
          let a = loop.startTick;
          let b = loop.endTick;
          if (mode === 'start') a = loop.startTick + dt;
          else if (mode === 'end') b = loop.endTick + dt;
          else if (mode === 'move') {
            const shift = gridTicks > 0 ? Math.round(dt / gridTicks) * gridTicks : Math.round(dt);
            const clamped = Math.max(-loop.startTick, shift);
            a = loop.startTick + clamped;
            b = loop.endTick + clamped;
            tx.applyFromStart([
              { type: 'project.setLoop', loop: { enabled: true, startTick: a, endTick: b } },
            ]);
            return;
          } else {
            a = tick;
            b = tick + dt;
          }
          tx.applyFromStart(loopCommand(a, b, gridTicks));
        },
        onEnd: ({ committed, dragged }) => {
          if (committed && dragged) tx.commit();
          else if (committed && !dragged && mode !== 'draw') {
            tx.cancel();
            session.transport.toggleLoop();
          } else tx.cancel();
        },
      });
      return;
    }
    const target = gridTicks > 0 ? Math.round(tick / gridTicks) * gridTicks : Math.round(tick);
    void session.transport.seek(target);
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 1,
      onDrag: (dx) => {
        const t = axis.xToTick(x + dx);
        void session.transport.seek(gridTicks > 0 ? Math.round(t / gridTicks) * gridTicks : t);
      },
      onEnd: () => undefined,
    });
  };

  /** Loop strip: resize cursor on its edges, grab on its body, crosshair to draw a new loop. */
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let cursor = 'text';
    if (y <= LOOP_BAR_HEIGHT + 2) {
      const x0 = axis.tickToX(loop.startTick);
      const x1 = axis.tickToX(loop.endTick);
      cursor =
        Math.abs(x - x0) < 6 || Math.abs(x - x1) < 6
          ? 'ew-resize'
          : x > x0 && x < x1
            ? 'grab'
            : 'crosshair';
    }
    e.currentTarget.style.cursor = cursor;
  };

  const resolveMenu = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = Math.max(0, axis.xToTick(e.clientX - rect.left));
    return rulerMenu(
      session,
      gridTicks > 0 ? Math.round(raw / gridTicks) * gridTicks : Math.round(raw),
    );
  };

  return (
    <StudioContextMenu target="ruler" resolve={resolveMenu}>
      <div
        className="relative min-w-0 flex-1 cursor-text"
        style={{ height: RULER_HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        data-testid="arrangement-ruler"
        // Pointer-only surface: keyboard users move the playhead and loop with the transport.
        role="group"
        aria-label="Timeline ruler: click to move the playhead, drag the top strip to set the loop"
      >
        <CanvasSurface draw={draw} className="absolute inset-0" />
        <CanvasSurface
          ref={overlayRef}
          draw={() => undefined}
          className="pointer-events-none absolute inset-0"
        />
      </div>
    </StudioContextMenu>
  );
}
