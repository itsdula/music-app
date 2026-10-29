import { useRef } from 'react';
import { formatPosition } from '../../lib/format';
import { useFrame } from '../../lib/use-frame';
import { useSession } from '../../session/context';

/**
 * Bars.beats.sixteenths + clock readout. Updated from the render loop by writing
 * textContent directly — no React renders at frame rate.
 */
export function PositionDisplay() {
  const session = useSession();
  const barsRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const last = useRef('');

  useFrame(() => {
    const { project } = session.projectStore.getState();
    const position = session.engine.getTransportPosition();
    const ticks =
      position.state === 'stopped' ? session.engineStore.getState().cursorTick : position.ticks;
    const { bars, time } = formatPosition(ticks, project.bpm, project.meter);
    const key = `${bars}|${time}`;
    if (key === last.current) return;
    last.current = key;
    if (barsRef.current) barsRef.current.textContent = bars;
    if (timeRef.current) timeRef.current.textContent = time;
  });

  return (
    <div
      className="flex h-7 min-w-[132px] items-center gap-2 rounded-md border border-line bg-surface-0 px-2.5 font-mono tabular-nums"
      role="timer"
      aria-label="Playhead position"
      data-testid="position-display"
    >
      <span ref={barsRef} className="text-[13px] text-text" data-testid="position-bars">
        1.1.1
      </span>
      <span ref={timeRef} className="text-[11px] text-text-muted" data-testid="position-time">
        0:00.000
      </span>
    </div>
  );
}
