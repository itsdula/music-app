import {
  EFFECT_KINDS,
  EFFECT_LABELS,
  MASTER_GAIN_SPEC,
  TRACK_GAIN_SPEC,
  denormalizeParam,
  normalizeParam,
  orderedTracks,
  type Track,
  type TrackId,
} from '@studio/domain';
import { Fader, Knob, Meter, ToggleButton, type MeterHandle } from '@studio/ui';
import { Circle } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  RenameField,
  SEPARATOR,
  StudioContextMenu,
  type MenuEntryInput,
} from '../../components/context-menu';
import { formatDb, formatPan } from '../../lib/format';
import { useFrame } from '../../lib/use-frame';
import { useProjectState, useSession, useUiState } from '../../session/context';
import type { StudioSession } from '../../session/studio-session';
import { selectTrack } from '../../state/ui-store';
import { trackMenu } from '../arrangement/arrangement-menus';
import { EffectChain } from '../devices/EffectChain';

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
  const meterRef = useRef<MeterHandle>(null);
  const gainGesture = useGestureKey();
  const panGesture = useGestureKey();
  useFrame(() => {
    const meter = session.engine.readMeters().tracks[track.id];
    if (meter) meterRef.current?.setLevels(meter.peak, meter.clipped);
  });
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
        <Knob
          label={`${track.name} pan`}
          size="sm"
          min={-1}
          max={1}
          step={0.01}
          bipolar
          defaultValue={0}
          value={track.mixer.pan}
          formatValue={formatPan}
          onChange={(pan) => setMixer({ pan }, 'Pan', `pan:${track.id}:${panGesture.key()}`)}
          onChangeEnd={panGesture.end}
        />
        <div className="flex min-h-0 flex-1 items-stretch gap-1.5">
          <Fader
            label={`${track.name} volume`}
            value={normalizeParam(TRACK_GAIN_SPEC, track.mixer.gainDb)}
            defaultValue={normalizeParam(TRACK_GAIN_SPEC, 0)}
            unityValue={normalizeParam(TRACK_GAIN_SPEC, 0)}
            formatValue={(n) => `${formatDb(denormalizeParam(TRACK_GAIN_SPEC, n))} dB`}
            onChange={(n) =>
              setMixer(
                { gainDb: denormalizeParam(TRACK_GAIN_SPEC, n) },
                'Volume',
                `gain:${track.id}:${gainGesture.key()}`,
              )
            }
            onChangeEnd={gainGesture.end}
            className="h-full min-h-24"
            showValue
          />
          <Meter
            ref={meterRef}
            label={`${track.name} level`}
            orientation="vertical"
            channels={2}
            className="h-full min-h-24 w-3"
          />
        </div>
        <div className="flex gap-1">
          <ToggleButton
            size="sm"
            label="Mute"
            tone="warning"
            pressed={track.mixer.mute}
            onPressedChange={(mute) => setMixer({ mute }, mute ? 'Mute' : 'Unmute')}
          >
            M
          </ToggleButton>
          <ToggleButton
            size="sm"
            label="Solo"
            tone="accent"
            pressed={track.mixer.solo}
            onPressedChange={(solo) => setMixer({ solo }, solo ? 'Solo' : 'Unsolo')}
          >
            S
          </ToggleButton>
          <ToggleButton
            size="sm"
            label="Arm"
            tone="record"
            pressed={track.armed}
            icon={<Circle className={track.armed ? 'fill-current' : ''} />}
            onPressedChange={(armed) =>
              session.history.execute({ type: 'track.update', trackId: track.id, patch: { armed } })
            }
          />
        </div>
        <ul
          className="w-full space-y-0.5 text-[10px] text-text-muted"
          aria-label={`${track.name} effects`}
        >
          {track.effects.length === 0 ? (
            <li className="text-text-faint">No effects</li>
          ) : (
            track.effects.map((fx) => (
              <li key={fx.id} className={`truncate ${fx.bypass ? 'line-through opacity-60' : ''}`}>
                {EFFECT_LABELS[fx.kind]}
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
  const meterRef = useRef<MeterHandle>(null);
  const gesture = useGestureKey();
  useFrame(() => {
    const meters = session.engine.readMeters();
    meterRef.current?.setLevels(meters.master.peak, meters.master.clipped);
  });
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
        <div className="flex min-h-0 flex-1 items-stretch gap-1.5">
          <Fader
            label="Master volume"
            value={normalizeParam(MASTER_GAIN_SPEC, gainDb)}
            defaultValue={normalizeParam(MASTER_GAIN_SPEC, 0)}
            unityValue={normalizeParam(MASTER_GAIN_SPEC, 0)}
            formatValue={(n) => `${formatDb(denormalizeParam(MASTER_GAIN_SPEC, n))} dB`}
            onChange={(n) =>
              session.history.execute(
                { type: 'master.setGain', gainDb: denormalizeParam(MASTER_GAIN_SPEC, n) },
                { label: 'Master Volume', coalesceKey: `master:${gesture.key()}` },
              )
            }
            onChangeEnd={gesture.end}
            className="h-full min-h-24"
            showValue
          />
          <Meter
            ref={meterRef}
            label="Master level"
            orientation="vertical"
            channels={2}
            className="h-full min-h-24 w-4"
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
