import type { TrackId } from '@studio/domain';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { useSession } from '../../session/context';
import { clampPitch, yToPitch, type PitchAxis } from './geometry';
import { drawKeyboard } from './renderer';

/** Clickable piano keyboard; pressing a key auditions it on the clip's instrument. */
export function PianoKeyboard({ trackId, pitch }: { trackId: TrackId; pitch: PitchAxis }) {
  const session = useSession();
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  const held = useRef<number | null>(null);
  const vm = useMemo(() => ({ pitch, active }), [pitch, active]);
  const draw = useCallback((ctx: CanvasRenderingContext2D, s: CanvasSize) => drawKeyboard(ctx, s.width, s.height, vm.pitch, vm.active), [vm]);

  const release = () => {
    if (held.current !== null) session.engine.live.noteOff(trackId, held.current);
    held.current = null;
    setActive(new Set());
  };

  return (
    <div
      className="relative min-h-0 flex-1 cursor-pointer border-r border-line"
      aria-label="Piano keyboard (click to audition)"
      role="presentation"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        void session.transport.ensureAudio().then(() => {
          const rect = e.currentTarget.getBoundingClientRect();
          const p = clampPitch(yToPitch(e.clientY - rect.top, pitch));
          held.current = p;
          setActive(new Set([p]));
          session.engine.live.noteOn(trackId, p, 100);
        });
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <CanvasSurface draw={draw} version={vm} className="absolute inset-0" />
    </div>
  );
}
