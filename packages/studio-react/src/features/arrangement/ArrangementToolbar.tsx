import { GRID_DIVISIONS, type GridDivision } from '@studio/domain';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Select,
  ToggleButton,
} from '@studio/ui';
import { AudioLines, Drum, Magnet, Mic, Piano, Plus } from 'lucide-react';
import { useSession, useUiState } from '../../session/context';

const GRID_LABELS: Record<GridDivision, string> = {
  bar: 'Bar',
  beat: 'Beat',
  '1/1': '1/1',
  '1/2': '1/2',
  '1/4': '1/4',
  '1/8': '1/8',
  '1/16': '1/16',
  '1/32': '1/32',
  '1/64': '1/64',
  '1/2T': '1/2 T',
  '1/4T': '1/4 T',
  '1/8T': '1/8 T',
  '1/16T': '1/16 T',
  '1/32T': '1/32 T',
};

export function GridControls() {
  const session = useSession();
  const grid = useUiState((s) => s.grid);
  const snap = useUiState((s) => s.snap);
  return (
    <div className="flex items-center gap-1">
      <ToggleButton
        size="sm"
        label="Snap to grid"
        tone="accent"
        pressed={snap}
        icon={<Magnet />}
        onPressedChange={(v) => session.uiStore.setState({ snap: v })}
      />
      <Select
        label="Grid"
        size="sm"
        value={grid}
        onValueChange={(v: string) => session.uiStore.setState({ grid: v as GridDivision })}
        options={GRID_DIVISIONS.map((g) => ({ value: g, label: GRID_LABELS[g] }))}
      />
    </div>
  );
}

export function AddTrackMenu() {
  const session = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Add track"
          icon={<Plus />}
          size="sm"
          variant="ghost"
          data-testid="add-track"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem
          icon={<Piano />}
          onSelect={() => session.edits.addTrack('instrument')}
          data-testid="add-instrument-track"
        >
          Instrument track
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Drum />}
          onSelect={() => session.edits.addTrack('instrument', { instrument: 'drums' })}
        >
          Drum track
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<AudioLines />}
          onSelect={() => session.edits.addTrack('audio')}
          data-testid="add-audio-track"
        >
          Audio track
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Mic />}
          onSelect={() => session.edits.addTrack('vocal')}
          data-testid="add-vocal-track"
        >
          Vocal track
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
