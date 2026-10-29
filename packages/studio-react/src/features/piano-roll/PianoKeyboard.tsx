import { midiToNoteName, type MidiClip } from '@studio/domain';
import { useCallback, useMemo, useRef, useState } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { StudioContextMenu } from '../../components/context-menu';
import { useSession } from '../../session/context';
import { selectNotes } from '../../state/ui-store';
import { auditionNote } from './audition';
import { clampPitch, yToPitch, type PitchAxis } from './geometry';
import { drawKeyboard } from './renderer';

/** Clickable piano keyboard; pressing a key auditions it on the clip's instrument. */
export function PianoKeyboard({ clip, pitch }: { clip: MidiClip; pitch: PitchAxis }) {
  const session = useSession();
  const trackId = clip.trackId;
  const [active, setActive] = useState<ReadonlySet<number>>(new Set());
  const held = useRef<number | null>(null);
  const vm = useMemo(() => ({ pitch, active }), [pitch, active]);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) =>
      drawKeyboard(ctx, s.width, s.height, vm.pitch, vm.active),
    [vm],
  );

  const release = () => {
    if (held.current !== null) session.engine.live.noteOff(trackId, held.current);
    held.current = null;
    setActive(new Set());
  };

  const resolveMenu = (e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = clampPitch(yToPitch(e.clientY - rect.top, pitch));
    const name = midiToNoteName(p);
    const atPitch = clip.notes.filter((n) => n.pitch === p).map((n) => n.id);
    return [
      {
        id: 'key-audition',
        label: `Play ${name}`,
        onSelect: () =>
          void session.transport.ensureAudio().then(() => auditionNote(session.engine, trackId, p)),
      },
      {
        id: 'key-select-pitch',
        label: `Select all ${name} notes (${atPitch.length})`,
        disabled: atPitch.length === 0,
        onSelect: () => session.uiStore.setState((s) => selectNotes(s, atPitch)),
      },
    ];
  };

  return (
    <StudioContextMenu target="piano-key" resolve={resolveMenu}>
      <div
        className="relative min-h-0 flex-1 cursor-pointer border-r border-line"
        aria-label="Piano keyboard (click to audition)"
        role="presentation"
        data-testid="piano-keyboard"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          // Read the position now: `currentTarget` is gone once the promise settles.
          const rect = e.currentTarget.getBoundingClientRect();
          const p = clampPitch(yToPitch(e.clientY - rect.top, pitch));
          void session.transport.ensureAudio().then(() => {
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
    </StudioContextMenu>
  );
}
