import { gridDivisionTicks, ticksPerBar, type MidiClip } from '@studio/domain';
import { IconButton, SegmentedControl, ToggleButton } from '@studio/ui';
import { Expand, MousePointer2, Pencil, Repeat, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { computeGridLines } from '../../canvas/ruler';
import { canvasFont, vline } from '../../canvas/draw-utils';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { GridControls } from '../arrangement/ArrangementToolbar';
import { contentToTimeline, editableContentRange, KEYBOARD_WIDTH, RULER_HEIGHT } from './geometry';
import { PianoKeyboard } from './PianoKeyboard';
import { PianoRollGrid } from './PianoRollGrid';
import { usePianoRollAxes } from './use-piano-roll-view';
import { VelocityLane } from './VelocityLane';
import { colors } from '@studio/ui';

function PianoRollRuler({ clip }: { clip: MidiClip }) {
  const meter = useProjectState((s) => s.project.meter);
  const { time } = usePianoRollAxes();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, s: CanvasSize) => {
      ctx.fillStyle = colors.surface1;
      ctx.fillRect(0, 0, s.width, s.height);
      const range = editableContentRange(clip);
      const x0 = time.tickToX(contentToTimeline(clip, range.start));
      const x1 = time.tickToX(contentToTimeline(clip, range.end));
      ctx.fillStyle = 'rgba(139,124,246,0.25)';
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
    [clip, meter, time],
  );
  return (
    <div className="relative shrink-0 border-b border-line" style={{ height: RULER_HEIGHT }}>
      <CanvasSurface draw={draw} version={draw} className="absolute inset-0" />
    </div>
  );
}

export function PianoRoll({ clip }: { clip: MidiClip }) {
  const session = useSession();
  const track = useProjectState((s) => s.project.tracks[clip.trackId]);
  const meter = useProjectState((s) => s.project.meter);
  const tool = useUiState((s) => s.tool);
  const grid = useUiState((s) => s.grid);
  const { pitch } = usePianoRollAxes();
  const fittedFor = useRef<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const color = clip.color ?? track?.color ?? colors.accent;

  const fit = useCallback(() => {
    const width = Math.max(200, (hostRef.current?.clientWidth ?? 800) - KEYBOARD_WIDTH);
    const range = editableContentRange(clip);
    const span = Math.max(range.end - range.start, ticksPerBar(meter));
    const pxPerTick = (width * 0.94) / span;
    const pitches = clip.notes.map((n) => n.pitch);
    const center = pitches.length > 0 ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 60;
    const visibleRows = ((hostRef.current?.clientHeight ?? 300) - RULER_HEIGHT - 64) / session.uiStore.getState().pianoRoll.rowHeight;
    session.uiStore.setState((s) => ({
      pianoRoll: {
        ...s.pianoRoll,
        pxPerTick,
        scrollTick: Math.max(0, contentToTimeline(clip, range.start) - (width * 0.03) / pxPerTick),
        topPitch: Math.min(127, Math.round(center + visibleRows / 2)),
      },
    }));
  }, [clip, meter, session]);

  useEffect(() => {
    if (fittedFor.current === clip.id) return;
    fittedFor.current = clip.id;
    fit();
  }, [clip.id, fit]);

  const looping = clip.loopLengthTicks !== undefined;

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col" data-testid="piano-roll">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
        <span className="max-w-48 truncate text-[12px] font-semibold">{clip.name}</span>
        <span className="text-[11px] text-text-faint">{track?.name}</span>
        <div className="flex-1" />
        <SegmentedControl
          label="Edit tool"
          size="sm"
          value={tool}
          onChange={(v) => session.uiStore.setState({ tool: v })}
          options={[
            { value: 'select', label: '', icon: <MousePointer2 />, ariaLabel: 'Select tool' },
            { value: 'draw', label: '', icon: <Pencil />, ariaLabel: 'Draw tool' },
          ]}
        />
        <GridControls />
        <IconButton
          label="Quantize (Q)"
          icon={<Wand2 />}
          size="sm"
          variant="ghost"
          disabled={clip.notes.length === 0}
          onClick={() => {
            const selected = session.uiStore.getState().selection.noteIds;
            const ids = selected.size > 0 ? [...selected] : clip.notes.map((n) => n.id);
            session.history.execute(
              { type: 'notes.quantize', clipId: clip.id, noteIds: ids, options: { gridTicks: gridDivisionTicks(grid, meter), strength: 1 } },
              { label: 'Quantize' },
            );
          }}
        />
        <ToggleButton
          size="sm"
          label="Loop clip content"
          tone="accent"
          pressed={looping}
          icon={<Repeat />}
          onPressedChange={(on) =>
            session.history.execute(
              { type: 'clip.updateMidi', clipId: clip.id, patch: { loopLengthTicks: on ? Math.max(1, clip.lengthTicks) : null } },
              { label: on ? 'Loop Clip' : 'Unloop Clip' },
            )
          }
        />
        <IconButton label="Zoom to clip" icon={<Expand />} size="sm" variant="ghost" onClick={fit} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col" style={{ width: KEYBOARD_WIDTH }}>
          <div className="shrink-0 border-r border-b border-line bg-surface-1" style={{ height: RULER_HEIGHT }} />
          <PianoKeyboard trackId={clip.trackId} pitch={pitch} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <PianoRollRuler clip={clip} />
          <PianoRollGrid clip={clip} color={color} />
        </div>
      </div>
      <div className="flex shrink-0 border-t border-line">
        <div className="shrink-0 border-r border-line bg-surface-1 px-2 pt-1 text-[10px] text-text-faint" style={{ width: KEYBOARD_WIDTH }}>
          Velocity
        </div>
        <div className="min-w-0 flex-1">
          <VelocityLane clip={clip} color={color} />
        </div>
      </div>
    </div>
  );
}
