import { orderedTracks } from '@studio/domain';
import { useMemo } from 'react';
import { useProjectState, useUiState } from '../../session/context';
import { ArrangementLanes } from './ArrangementLanes';
import { ArrangementRuler } from './ArrangementRuler';
import { AddTrackMenu, GridControls } from './ArrangementToolbar';
import { RULER_HEIGHT, TRACK_HEADER_WIDTH } from './geometry';
import { TrackHeader } from './TrackHeader';

export function ArrangementView() {
  const project = useProjectState((s) => s.project);
  const trackHeight = useUiState((s) => s.arrangement.trackHeight);
  const scrollY = useUiState((s) => s.arrangement.scrollY);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const tracks = useMemo(() => orderedTracks(project), [project]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="arrangement">
      <div className="flex shrink-0 border-b border-line bg-surface-1" style={{ height: RULER_HEIGHT }}>
        <div className="flex shrink-0 items-center justify-between gap-1 border-r border-line px-2" style={{ width: TRACK_HEADER_WIDTH }}>
          <AddTrackMenu />
          <GridControls />
        </div>
        <ArrangementRuler />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative shrink-0 overflow-hidden border-r border-line bg-surface-1" style={{ width: TRACK_HEADER_WIDTH }} role="grid" aria-label="Tracks">
          <div style={{ transform: `translateY(${-scrollY}px)` }}>
            {tracks.map((track) => (
              <TrackHeader key={track.id} track={track} height={trackHeight} selected={track.id === selectedTrackId} />
            ))}
          </div>
        </div>
        <ArrangementLanes />
      </div>
    </div>
  );
}
