import { gridDivisionTicks, ticksPerBar, type MidiClip } from '@studio/domain';
import { IconButton, SegmentedControl, ToggleButton } from '@studio/ui';
import {
  ChevronDown,
  ChevronRight,
  Expand,
  MousePointer2,
  Pencil,
  Repeat,
  Wand2,
} from 'lucide-react';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { CanvasSurface, type CanvasSize } from '../../canvas/canvas-surface';
import { computeGridLines } from '../../canvas/ruler';
import { canvasFont, vline } from '../../canvas/draw-utils';
import { useProjectState, useSession, useUiState } from '../../session/context';
import { GridControls } from '../arrangement/ArrangementToolbar';
import { usePersistentToggle } from '../../lib/use-persistent-toggle';
import { ExpandEditorButton } from '../bottom-panel/ExpandEditorButton';
import {
  contentToTimeline,
  editableContentRange,
  fitPitchAxis,
  KEYBOARD_WIDTH,
  RULER_HEIGHT,
} from './geometry';
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
  const view = useUiState((s) => s.view);
  const { pitch } = usePianoRollAxes();
  const fittedFor = useRef<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const gridAreaRef = useRef<HTMLDivElement>(null);
  const color = clip.color ?? track?.color ?? colors.accent;
  // The velocity lane starts collapsed in the bottom panel (room for notes) and open in the
  // full-height editor; the choice is remembered per place.
  const [velocityOpen, setVelocityOpen] = usePersistentToggle(
    `pianoRoll.velocityLane.${view === 'editor' ? 'editor' : 'panel'}`,
    view === 'editor',
  );

  /** Fits the note range vertically (at least two octaves; C4 for empty clips). */
  const fitPitch = useCallback(() => {
    const height = (gridAreaRef.current?.clientHeight ?? 240) - RULER_HEIGHT;
    const axis = fitPitchAxis(
      clip.notes.map((n) => n.pitch),
      height,
    );
    session.uiStore.setState((s) => ({ pianoRoll: { ...s.pianoRoll, ...axis } }));
  }, [clip.notes, session]);

  const fit = useCallback(() => {
    const width = Math.max(200, (hostRef.current?.clientWidth ?? 800) - KEYBOARD_WIDTH);
    const range = editableContentRange(clip);
    const span = Math.max(range.end - range.start, ticksPerBar(meter));
    const pxPerTick = (width * 0.94) / span;
    session.uiStore.setState((s) => ({
      pianoRoll: {
        ...s.pianoRoll,
        pxPerTick,
        scrollTick: Math.max(0, contentToTimeline(clip, range.start) - (width * 0.03) / pxPerTick),
      },
    }));
    fitPitch();
  }, [clip, meter, session, fitPitch]);

  // Fit when a clip opens; refit vertically when the available height changes (full editor,
  // velocity lane toggled).
  useLayoutEffect(() => {
    if (fittedFor.current === clip.id) return;
    fittedFor.current = clip.id;
    fit();
  }, [clip.id, fit]);
  const layoutKey = `${view}:${velocityOpen}`;
  const lastLayout = useRef(layoutKey);
  useLayoutEffect(() => {
    if (lastLayout.current === layoutKey) return;
    lastLayout.current = layoutKey;
    fitPitch();
  }, [layoutKey, fitPitch]);

  const looping = clip.loopLengthTicks !== undefined;

  return (
    <div ref={hostRef} className="flex min-h-0 flex-1 flex-col" data-testid="piano-roll">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="size-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
        <span className="max-w-48 truncate text-[12px] font-semibold">{clip.name}</span>
        <span className="truncate text-[11px] text-text-faint">{track?.name}</span>
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
            session.edits.quantizeNotes(clip.id, ids, gridDivisionTicks(grid, meter));
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
              {
                type: 'clip.updateMidi',
                clipId: clip.id,
                patch: { loopLengthTicks: on ? Math.max(1, clip.lengthTicks) : null },
              },
              { label: on ? 'Loop Clip' : 'Unloop Clip' },
            )
          }
        />
        <IconButton
          label="Zoom to clip"
          icon={<Expand />}
          size="sm"
          variant="ghost"
          onClick={fit}
        />
        <ExpandEditorButton />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col" style={{ width: KEYBOARD_WIDTH }}>
          <div
            className="shrink-0 border-r border-b border-line bg-surface-1"
            style={{ height: RULER_HEIGHT }}
          />
          <PianoKeyboard clip={clip} pitch={pitch} />
        </div>
        <div ref={gridAreaRef} className="flex min-w-0 flex-1 flex-col">
          <PianoRollRuler clip={clip} />
          <PianoRollGrid clip={clip} color={color} />
        </div>
      </div>
      <div className="flex shrink-0 border-t border-line" data-testid="velocity-lane-area">
        <div
          className="flex shrink-0 items-start border-r border-line bg-surface-1"
          style={{ width: KEYBOARD_WIDTH }}
        >
          <button
            type="button"
            className="flex w-full items-center gap-0.5 px-1 py-0.5 text-left text-[10px] text-text-faint hover:text-text"
            aria-expanded={velocityOpen}
            aria-controls="piano-roll-velocity-lane"
            onClick={() => setVelocityOpen(!velocityOpen)}
            data-testid="velocity-lane-toggle"
            title={velocityOpen ? 'Hide velocity lane' : 'Show velocity lane'}
          >
            {velocityOpen ? (
              <ChevronDown className="size-3" aria-hidden />
            ) : (
              <ChevronRight className="size-3" aria-hidden />
            )}
            Velocity
          </button>
        </div>
        <div className="min-w-0 flex-1" id="piano-roll-velocity-lane">
          {velocityOpen ? (
            <VelocityLane clip={clip} color={color} />
          ) : (
            <div className="h-5" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
