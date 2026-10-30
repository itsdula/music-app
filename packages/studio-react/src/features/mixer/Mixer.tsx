import { PanKnob, StereoMeter, VolumeFader } from '@studio/audio-ui';
import {
  EFFECT_KINDS,
  EFFECT_LABELS,
  MASTER_GAIN_SPEC,
  TRACK_GAIN_SPEC,
  orderedTracks,
  type Track,
  type TrackId,
} from '@studio/domain';
import { useMemo, useRef, useState } from 'react';
import {
  RenameField,
  SEPARATOR,
  StudioContextMenu,
  type MenuEntryInput,
} from '../../components/context-menu';
import { useEngineMeterSource } from '../../lib/engine-meter-source';
import { formatDb } from '../../lib/format';
import { paramTaper } from '../../lib/param-taper';
import { useProjectState, useSession, useUiState } from '../../session/context';
import type { StudioSession } from '../../session/studio-session';
import { selectTrack } from '../../state/ui-store';
import { trackMenu } from '../arrangement/arrangement-menus';
import { EffectChain } from '../devices/EffectChain';
import { StripChannelButtons } from './TrackChannelButtons';

const TRACK_GAIN_TAPER = paramTaper(TRACK_GAIN_SPEC);
const MASTER_GAIN_TAPER = paramTaper(MASTER_GAIN_SPEC);
const formatGain = (db: number) => `${formatDb(db)} dB`;

function useGestureKey() {
  const counter = useRef(0);
  return { key: () => counter.current, end: () => (counter.current += 1) };
}

/** "Add effect" submenu for a track or the master bus. */
function addEffectSubmenu(session: StudioSession, target: TrackId | 'master'): MenuEntryInput {
  return {
    kind: 'submenu',
    id: 'add-effect',
    label: 'Add effect',
    items: EFFECT_KINDS.map((kind) => ({
      id: `add-effect-${kind}`,
      label: EFFECT_LABELS[kind],
      onSelect: () => session.edits.addEffect(target, kind),
    })),
  };
}

function ChannelStrip({ track, selected }: { track: Track; selected: boolean }) {
  const session = useSession();
  const [renaming, setRenaming] = useState(false);
  const meterSource = useEngineMeterSource(track.id);
  const gainGesture = useGestureKey();
  const panGesture = useGestureKey();
  const setMixer = (mixer: Partial<Track['mixer']>, label: string, coalesceKey?: string) =>
    session.history.execute(
      { type: 'track.setMixer', trackId: track.id, mixer },
      { label, ...(coalesceKey ? { coalesceKey } : {}) },
    );

  const resolveMenu = () => {
    session.uiStore.setState((s) => selectTrack(s, track.id));
    return trackMenu(session, track.id, {
      onRename: () => setRenaming(true),
      extra: [
        SEPARATOR,
        {
          id: 'strip-reset-volume',
          label: 'Reset volume (0 dB)',
          disabled: track.mixer.gainDb === 0,
          onSelect: () => setMixer({ gainDb: 0 }, 'Reset Volume'),
        },
        {
          id: 'strip-reset-pan',
          label: 'Reset pan (center)',
          disabled: track.mixer.pan === 0,
          onSelect: () => setMixer({ pan: 0 }, 'Reset Pan'),
        },
        addEffectSubmenu(session, track.id),
      ],
    });
  };

  return (
    <StudioContextMenu target="channel-strip" resolve={resolveMenu}>
      <div
        className={`flex w-24 shrink-0 flex-col items-center gap-2 rounded-lg border p-2 ${selected ? 'border-accent/50 bg-surface-3' : 'border-line bg-surface-2'}`}
        onPointerDown={() => session.uiStore.setState((s) => selectTrack(s, track.id))}
        data-testid="channel-strip"
        data-track-id={track.id}
      >
        <div className="flex w-full items-center gap-1.5">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: track.color }}
            aria-hidden
          />
          {renaming ? (
            <RenameField
              className="h-5 min-w-0 flex-1 rounded border border-accent bg-surface-0 px-1 text-[11px] outline-none"
              defaultValue={track.name}
              label="Track name"
              onCommit={(name) => session.edits.renameTrack(track.id, name)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <span className="truncate text-[11px] font-semibold" title={track.name}>
              {track.name}
            </span>
          )}
        </div>
        <PanKnob
          label={`${track.name} pan`}
          hideLabel
          showValue={false}
          size="sm"
          value={track.mixer.pan}
          onChange={(pan) => setMixer({ pan }, 'Pan', `pan:${track.id}:${panGesture.key()}`)}
          onCommit={panGesture.end}
        />
        <div className="flex min-h-20 flex-1 items-stretch gap-1.5">
          <VolumeFader
            label={`${track.name} volume`}
            value={track.mixer.gainDb}
            min={TRACK_GAIN_SPEC.min}
            max={TRACK_GAIN_SPEC.max}
            taper={TRACK_GAIN_TAPER}
            format={formatGain}
            onChange={(gainDb) =>
              setMixer({ gainDb }, 'Volume', `gain:${track.id}:${gainGesture.key()}`)
            }
            onCommit={gainGesture.end}
            className="h-full"
          />
          <StereoMeter label={`${track.name} level`} source={meterSource} className="h-full" />
        </div>
        <div className="flex gap-1">
          <StripChannelButtons track={track} />
        </div>
        {/* One line, so every strip has the same height; the full chain is in the Track tab. */}
        <ul
          className="flex w-full min-w-0 gap-1 overflow-hidden text-[10px] leading-3.5 whitespace-nowrap text-text-muted"
          aria-label={`${track.name} effects`}
          title={track.effects.map((fx) => EFFECT_LABELS[fx.kind]).join(', ') || undefined}
        >
          {track.effects.length === 0 ? (
            <li className="text-text-faint">No effects</li>
          ) : (
            track.effects.map((fx, i) => (
              <li
                key={fx.id}
                className={`${i === track.effects.length - 1 ? 'truncate' : 'shrink-0'} ${fx.bypass ? 'line-through opacity-60' : ''}`}
              >
                {EFFECT_LABELS[fx.kind]}
                {i < track.effects.length - 1 ? ',' : ''}
              </li>
            ))
          )}
        </ul>
      </div>
    </StudioContextMenu>
  );
}

function MasterStrip() {
  const session = useSession();
  const gainDb = useProjectState((s) => s.project.master.gainDb);
  const meterSource = useEngineMeterSource('master');
  const gesture = useGestureKey();
  const resolveMenu = () => [
    {
      id: 'master-reset-volume',
      label: 'Reset master volume (0 dB)',
      disabled: gainDb === 0,
      onSelect: () =>
        session.history.execute(
          { type: 'master.setGain', gainDb: 0 },
          { label: 'Reset Master Volume' },
        ),
    },
    addEffectSubmenu(session, 'master'),
  ];
  return (
    <StudioContextMenu target="master-strip" resolve={resolveMenu}>
      <div
        className="flex w-28 shrink-0 flex-col items-center gap-2 rounded-lg border border-line bg-surface-2 p-2"
        data-testid="master-strip"
      >
        <span className="text-[11px] font-semibold">Master</span>
        <div className="flex min-h-20 flex-1 items-stretch gap-1.5">
          <VolumeFader
            label="Master volume"
            value={gainDb}
            min={MASTER_GAIN_SPEC.min}
            max={MASTER_GAIN_SPEC.max}
            taper={MASTER_GAIN_TAPER}
            format={formatGain}
            onChange={(next) =>
              session.history.execute(
                { type: 'master.setGain', gainDb: next },
                { label: 'Master Volume', coalesceKey: `master:${gesture.key()}` },
              )
            }
            onCommit={gesture.end}
            className="h-full"
          />
          <StereoMeter
            label="Master level"
            source={meterSource}
            size="default"
            className="h-full"
          />
        </div>
      </div>
    </StudioContextMenu>
  );
}

export function Mixer() {
  const project = useProjectState((s) => s.project);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const tracks = useMemo(() => orderedTracks(project), [project]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="mixer">
      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
        {tracks.map((track) => (
          <ChannelStrip key={track.id} track={track} selected={track.id === selectedTrackId} />
        ))}
        <div className="flex-1" />
        <MasterStrip />
      </div>
      <details className="border-t border-line px-2 py-1">
        <summary className="cursor-pointer text-[11px] text-text-muted">
          Master effects ({project.master.effects.length})
        </summary>
        <div className="overflow-x-auto py-2">
          <EffectChain target="master" effects={project.master.effects} />
        </div>
      </details>
    </div>
  );
}
