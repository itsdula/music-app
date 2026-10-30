import { type Track } from '@studio/domain';
import { StereoMeter } from '@studio/audio-ui';
import { AudioLines, Drum, GripVertical, Mic, Piano } from 'lucide-react';
import { RenameField, StudioContextMenu } from '../../components/context-menu';
import { useState } from 'react';
import { startDragGesture } from '../../lib/drag-gesture';
import { useEngineMeterSource } from '../../lib/engine-meter-source';
import { useSession } from '../../session/context';
import { selectTrack } from '../../state/ui-store';
import { TrackChannelButtons } from '../mixer/TrackChannelButtons';
import { trackMenu } from './arrangement-menus';

function TrackIcon({ track }: { track: Track }) {
  if (track.kind === 'vocal') return <Mic aria-hidden />;
  if (track.kind === 'audio') return <AudioLines aria-hidden />;
  return track.instrument?.kind === 'drums' ? <Drum aria-hidden /> : <Piano aria-hidden />;
}

export function TrackHeader({
  track,
  height,
  selected,
}: {
  track: Track;
  height: number;
  selected: boolean;
}) {
  const session = useSession();
  const { history, uiStore } = session;
  const [renaming, setRenaming] = useState(false);
  const meterSource = useEngineMeterSource(track.id);

  const onGripDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const startIndex = history.present.trackOrder.indexOf(track.id);
    const tx = history.beginTransaction('Reorder Track');
    startDragGesture(e.nativeEvent, e.currentTarget, {
      threshold: 3,
      onDrag: (_dx, dy) => {
        const count = history.present.trackOrder.length;
        const toIndex = Math.min(count - 1, Math.max(0, startIndex + Math.round(dy / height)));
        tx.applyFromStart(
          toIndex === startIndex ? [] : [{ type: 'track.move', trackId: track.id, toIndex }],
        );
      },
      onEnd: ({ committed }) => (committed ? tx.commit() : tx.cancel()),
    });
  };

  return (
    <StudioContextMenu
      target="track"
      resolve={() => {
        uiStore.setState((s) => selectTrack(s, track.id));
        return trackMenu(session, track.id, { onRename: () => setRenaming(true) });
      }}
    >
      <div
        className={`group relative flex shrink-0 items-stretch border-b border-line ${selected ? 'bg-surface-3' : 'bg-surface-1 hover:bg-surface-2'}`}
        style={{ height }}
        onPointerDown={() => uiStore.setState((s) => selectTrack(s, track.id))}
        data-testid="track-header"
        data-track-id={track.id}
        role="listitem"
        aria-label={`${track.name} track`}
        aria-current={selected ? 'true' : undefined}
      >
        <span className="w-1 shrink-0" style={{ backgroundColor: track.color }} aria-hidden />
        <button
          type="button"
          className="flex w-4 shrink-0 cursor-grab items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Reorder ${track.name}`}
          onPointerDown={onGripDown}
          onKeyDown={(e) => {
            const index = history.present.trackOrder.indexOf(track.id);
            if (e.key === 'ArrowUp' && index > 0)
              history.execute({ type: 'track.move', trackId: track.id, toIndex: index - 1 });
            if (e.key === 'ArrowDown')
              history.execute({ type: 'track.move', trackId: track.id, toIndex: index + 1 });
          }}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-1 pr-2">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted [&_svg]:size-3.5">
              <TrackIcon track={track} />
            </span>
            {renaming ? (
              <RenameField
                className="h-5 min-w-0 flex-1 rounded border border-accent bg-surface-0 px-1 text-[12px] outline-none"
                defaultValue={track.name}
                label="Track name"
                testId="track-rename-input"
                onCommit={(name) => session.edits.renameTrack(track.id, name)}
                onDone={() => setRenaming(false)}
              />
            ) : (
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-text"
                onDoubleClick={() => setRenaming(true)}
                title={track.name}
              >
                {track.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <TrackChannelButtons track={track} />
            <StereoMeter
              label={`${track.name} level`}
              source={meterSource}
              orientation="horizontal"
              size="default"
              showClip={false}
              className="ml-1 min-w-0 flex-1"
            />
          </div>
        </div>
      </div>
    </StudioContextMenu>
  );
}
