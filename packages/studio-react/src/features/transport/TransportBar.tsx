import { clampBpm, isValidTimeSignature, type TimeSignatureDenominator } from '@studio/domain';
import { IconButton, NumberField, ToggleButton, Toolbar, ToolbarGroup, ToolbarSeparator } from '@studio/ui';
import { Circle, Download, Metronome, Pause, Play, Redo2, Repeat, SkipBack, Square, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { formatBpm, parseBpm } from '../../lib/format';
import { useEngineState, useProjectState, useSession } from '../../session/context';
import { ExportDialog } from '../export/ExportDialog';
import { ProjectMenu } from '../project/ProjectMenu';
import { ShortcutsDialog } from '../shortcuts/ShortcutsDialog';
import { MasterMeter } from './MasterMeter';
import { PositionDisplay } from './PositionDisplay';
import { SaveIndicator } from './SaveIndicator';

const DENOMINATORS: readonly TimeSignatureDenominator[] = [2, 4, 8, 16];

export function TransportBar() {
  const session = useSession();
  const { transport } = session;
  const playState = useEngineState((s) => s.playState);
  const recordingPhase = useEngineState((s) => s.recording.phase);
  const bpm = useProjectState((s) => s.project.bpm);
  const meter = useProjectState((s) => s.project.meter);
  const loopEnabled = useProjectState((s) => s.project.loop.enabled);
  const metronomeOn = useProjectState((s) => s.project.metronome.enabled);
  const canUndo = useProjectState((s) => s.canUndo);
  const canRedo = useProjectState((s) => s.canRedo);
  const undoLabel = useProjectState((s) => s.undoLabel);
  const redoLabel = useProjectState((s) => s.redoLabel);
  const [exportOpen, setExportOpen] = useState(false);
  const playing = playState === 'playing';
  const recording = recordingPhase === 'recording';

  const setMeter = (numerator: number, denominator: TimeSignatureDenominator) => {
    const next = { numerator, denominator };
    if (isValidTimeSignature(next)) session.history.execute({ type: 'project.setMeter', meter: next }, { label: 'Set Time Signature' });
  };

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-1 px-2" data-testid="transport-bar">
      <ProjectMenu />
      <SaveIndicator />
      <div className="flex-1" />
      <Toolbar aria-label="Transport" className="gap-1">
        <ToolbarGroup>
          <IconButton label="Return to start" shortcut="Home" icon={<SkipBack />} variant="ghost" onClick={() => void transport.rewind()} />
          <IconButton
            label={playing ? 'Pause' : 'Play'}
            shortcut="Space"
            icon={playing ? <Pause /> : <Play />}
            variant={playing ? 'primary' : 'secondary'}
            data-testid="transport-play"
            onClick={() => void (playing ? transport.pause() : transport.play())}
          />
          <IconButton label="Stop" icon={<Square />} variant="ghost" data-testid="transport-stop" onClick={() => void transport.stop()} />
          <ToggleButton
            label="Record"
            shortcut="R"
            tone="record"
            pressed={recording}
            icon={<Circle className={recording ? 'fill-current' : ''} />}
            data-testid="transport-record"
            onPressedChange={() => void transport.record()}
          />
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup>
          <ToggleButton label="Loop" shortcut="L" tone="accent" pressed={loopEnabled} icon={<Repeat />} data-testid="transport-loop" onPressedChange={() => transport.toggleLoop()} />
          <ToggleButton label="Metronome" shortcut="M" tone="accent" pressed={metronomeOn} icon={<Metronome />} onPressedChange={() => transport.toggleMetronome()} />
        </ToolbarGroup>
      </Toolbar>
      <PositionDisplay />
      <div className="flex items-center gap-1.5">
        <NumberField
          label="Tempo (BPM)"
          value={bpm}
          min={20}
          max={400}
          step={1}
          fineStep={0.01}
          largeStep={10}
          format={formatBpm}
          parse={parseBpm}
          onChange={(v) => transport.setTempo(clampBpm(v))}
          suffix={<span className="text-[10px] text-text-faint">BPM</span>}
          className="w-[86px]"
        />
        <NumberField
          label="Beats per bar"
          value={meter.numerator}
          min={1}
          max={32}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={(v) => setMeter(Math.round(v), meter.denominator)}
          className="w-[40px]"
        />
        <span className="text-text-faint">/</span>
        <NumberField
          label="Beat unit"
          value={meter.denominator}
          min={2}
          max={16}
          step={1}
          format={(v) => String(Math.round(v))}
          parse={(t) => {
            const n = Number.parseInt(t, 10);
            return DENOMINATORS.includes(n as TimeSignatureDenominator) ? n : null;
          }}
          onChange={(v) => {
            const nearest = DENOMINATORS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
            setMeter(meter.numerator, nearest);
          }}
          className="w-[40px]"
        />
      </div>
      <div className="flex-1" />
      <ToolbarGroup>
        <IconButton label={undoLabel ? `Undo ${undoLabel}` : 'Undo'} shortcut="Mod+Z" icon={<Undo2 />} variant="ghost" disabled={!canUndo} onClick={() => session.history.undo()} />
        <IconButton label={redoLabel ? `Redo ${redoLabel}` : 'Redo'} shortcut="Mod+Shift+Z" icon={<Redo2 />} variant="ghost" disabled={!canRedo} onClick={() => session.history.redo()} />
      </ToolbarGroup>
      <MasterMeter />
      <ShortcutsDialog />
      <IconButton label="Export audio" icon={<Download />} variant="secondary" data-testid="open-export" onClick={() => setExportOpen(true)} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
    </header>
  );
}
