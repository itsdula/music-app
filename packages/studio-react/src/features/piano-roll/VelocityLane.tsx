import { type MidiClip, type NoteId } from '@studio/domain';
import { useCallback, useMemo, useRef } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { startDragGesture } from '../../lib/drag-gesture';
import { useSession, useUiState } from '../../session/context';
import { selectNotes } from '../../state/ui-store';
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
  const draw = useCallback((ctx: CanvasRenderingContext2D, s: CanvasSize) => drawVelocityLane(ctx, s.width, s.height, vm), [vm]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = hostRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let nearest: { id: NoteId; distance: number } | null = null;
    for (const note of clip.notes) {
      const distance = Math.abs(time.tickToX(contentToTimeline(clip, note.startTick)) - x);
      if (distance < 6 && (!nearest || distance < nearest.distance)) nearest = { id: note.id, distance };
    }
    if (!nearest) return;
    const target = nearest.id;
    const ids = selected.has(target) ? new Set(selected) : new Set([target]);
    if (!selected.has(target)) session.uiStore.setState((s) => selectNotes(s, [target]));
    const tx = session.history.beginTransaction('Change Velocity');
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 1,
      onDrag: (_dx, dy) => {
        const delta = (-dy / (VELOCITY_LANE_HEIGHT - 8)) * 127;
        tx.applyFromStart([{ type: 'notes.update', clipId: clip.id, patches: scaleVelocities(clip, ids, delta) }]);
      },
      onEnd: ({ committed, dragged }) => (committed && dragged ? tx.commit() : tx.cancel()),
    });
  };

  return (
    <div ref={hostRef} className="relative shrink-0 cursor-ns-resize" style={{ height: VELOCITY_LANE_HEIGHT }} onPointerDown={onPointerDown} aria-label="Velocity lane: drag a bar up or down" role="presentation">
      <CanvasSurface draw={draw} version={vm} className="absolute inset-0" />
    </div>
  );
}
