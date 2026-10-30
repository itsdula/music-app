import { type MidiClip, type NoteId } from '@studio/domain';
import { useCallback, useMemo, useRef } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { startDragGesture } from '../../lib/drag-gesture';
import { useSession, useUiState } from '../../session/context';
import { selectNotes } from '../../state/ui-store';
import { StudioContextMenu } from '../../components/context-menu';
import { velocityMenu } from './note-menus';
import { contentToTimeline, VELOCITY_LANE_HEIGHT } from './geometry';
import { scaleVelocities } from './note-edits';
import { drawVelocityLane } from './renderer';
import { usePianoRollAxes } from './use-piano-roll-view';

export function VelocityLane({ clip, color }: { clip: MidiClip; color: string }) {
  const session = useSession();
  const selected = useUiState((s) => s.selection.noteIds);
  const { time } = usePianoRollAxes();
  const hostRef = useRef<HTMLDivElement>(null);
  const vm = useMemo(() => ({ clip, time, selected, color }), [clip, time, selected, color]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => drawVelocityLane(ctx, s.width, s.height, vm),
    [vm],
  );

  /** Note whose velocity bar is nearest to `x` (within 6 px). */
  const nearestNote = (x: number): NoteId | null => {
    let nearest: { id: NoteId; distance: number } | null = null;
    for (const note of clip.notes) {
      const distance = Math.abs(time.tickToX(contentToTimeline(clip, note.startTick)) - x);
      if (distance < 6 && (!nearest || distance < nearest.distance))
        nearest = { id: note.id, distance };
    }
    return nearest?.id ?? null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = hostRef.current!.getBoundingClientRect();
    const target = nearestNote(e.clientX - rect.left);
    if (!target) return;
    const ids = selected.has(target) ? new Set(selected) : new Set([target]);
    if (!selected.has(target)) session.uiStore.setState((s) => selectNotes(s, [target]));
    const tx = session.history.beginTransaction('Change Velocity');
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 1,
      onDrag: (_dx, dy) => {
        const delta = (-dy / (VELOCITY_LANE_HEIGHT - 8)) * 127;
        tx.applyFromStart([
          { type: 'notes.update', clipId: clip.id, patches: scaleVelocities(clip, ids, delta) },
        ]);
      },
      onEnd: ({ committed, dragged }) => (committed && dragged ? tx.commit() : tx.cancel()),
    });
  };

  return (
    <StudioContextMenu
      target="velocity"
      resolve={(e) => {
        // Right-click on a bar that is not selected selects it first.
        const rect = hostRef.current!.getBoundingClientRect();
        const target = nearestNote(e.clientX - rect.left);
        if (target && !selected.has(target))
          session.uiStore.setState((s) => selectNotes(s, [target]));
        return velocityMenu(session, clip);
      }}
    >
      <div
        ref={hostRef}
        className="relative shrink-0 cursor-ns-resize"
        style={{ height: VELOCITY_LANE_HEIGHT }}
        onPointerDown={onPointerDown}
        aria-label="Velocity lane: drag a bar up or down"
        role="presentation"
        data-testid="velocity-lane"
      >
        <CanvasSurface draw={draw} version={vm} className="absolute inset-0" />
      </div>
    </StudioContextMenu>
  );
}
