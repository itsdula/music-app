import {
  EmptyState,
  IconButton,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '@studio/ui';
import { ChevronDown, Piano, SlidersHorizontal } from 'lucide-react';
import type { AudioClip, Clip } from '@studio/domain';
import { NativeContextMenuGuard } from '../../components/context-menu';
import { useProjectState, useSession, useUiState } from '../../session/context';
import type { BottomPanel as BottomPanelId } from '../../state/ui-store';
import { AudioClipEditor } from '../audio-editor/AudioClipEditor';
import { ControllerPanel } from '../midi-controller/ControllerPanel';
import { TrackDevicePanel } from '../devices/TrackDevicePanel';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../piano-roll/PianoRoll';
import { VocalEditor } from '../vocal-editor/VocalEditor';
import { ExpandEditorButton } from './ExpandEditorButton';

const CLIP_TAB_HINT =
  'Select a MIDI region to edit its notes here. Double-click an empty spot on an instrument track to create one.';

function TrackContent() {
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const track = useProjectState((s) =>
    selectedTrackId ? s.project.tracks[selectedTrackId] : undefined,
  );
  const hasClip = useUiState((s) => s.selection.editorClipId !== null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!hasClip && <PianoRollHint />}
      {track ? (
        <TrackDevicePanel track={track} />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<SlidersHorizontal />}
            title="No track selected"
            description="Select a track to see its instrument and effects."
          />
        </div>
      )}
    </div>
  );
}

function ClipContent({ clip }: { clip: Clip | undefined }) {
  const clipTrack = useProjectState((s) => (clip ? s.project.tracks[clip.trackId] : undefined));
  if (clip?.kind === 'midi') return <PianoRoll clip={clip} />;
  if (clip?.kind === 'audio')
    return <AudioEditorSwitch clip={clip} vocalTrack={clipTrack?.kind === 'vocal'} />;
  return (
    <div className="flex flex-1 items-center justify-center">
      <EmptyState icon={<Piano />} title="No region selected" description={CLIP_TAB_HINT} />
    </div>
  );
}

/** Shown on the Track tab while no clip is open, so the piano roll is easy to find. */
function PianoRollHint() {
  return (
    <p
      className="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent/10 px-3 py-1.5 text-[11px] text-text-muted"
      data-testid="piano-roll-hint"
      role="note"
    >
      <Piano className="size-3.5 text-accent" aria-hidden />
      Select a MIDI clip to edit notes in the piano roll
      <span className="text-text-faint">(double-click an empty instrument lane to create one)</span>
    </p>
  );
}

function AudioEditorSwitch({ clip, vocalTrack }: { clip: AudioClip; vocalTrack: boolean }) {
  const session = useSession();
  const preference = useUiState((s) => s.audioEditorMode);
  const mode = preference === 'auto' ? (vocalTrack ? 'pitch' : 'audio') : preference;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <SegmentedControl
          label="Audio editor mode"
          size="sm"
          value={mode}
          onChange={(v) => session.uiStore.setState({ audioEditorMode: v })}
          options={[
            { value: 'audio', label: 'Clip' },
            { value: 'pitch', label: 'Pitch (vocal)' },
          ]}
        />
        <div className="flex-1" />
        <ExpandEditorButton />
      </div>
      {mode === 'pitch' ? <VocalEditor clip={clip} /> : <AudioClipEditor clip={clip} />}
    </div>
  );
}

export function BottomPanel() {
  const session = useSession();
  const panel = useUiState((s) => s.panels.bottomPanel);
  const editorClipId = useUiState((s) => s.selection.editorClipId);
  const view = useUiState((s) => s.view);
  const clip = useProjectState((s) => (editorClipId ? s.project.clips[editorClipId] : undefined));
  // The clip tab is only usable while a region is selected; fall back to the track tab.
  const active: BottomPanelId = panel === 'clip' && !clip ? 'track' : panel;
  const setPanel = (bottomPanel: BottomPanelId) =>
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel } }));
  const clipLabel = clip?.kind === 'audio' ? 'Audio Clip' : 'Piano Roll';
  return (
    <Tabs
      value={active}
      onValueChange={(v) => setPanel(v as BottomPanelId)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <TabsList aria-label="Bottom panel">
          <TabsTrigger value="track">Track</TabsTrigger>
          {clip ? (
            <TabsTrigger value="clip">{clipLabel}</TabsTrigger>
          ) : (
            // Disabled buttons swallow pointer events, so the tooltip hangs off a wrapper.
            <Tooltip content={CLIP_TAB_HINT} side="top">
              <span className="inline-flex" data-testid="clip-tab-disabled">
                <TabsTrigger value="clip" disabled className="pointer-events-none">
                  {clipLabel}
                </TabsTrigger>
              </span>
            </Tooltip>
          )}
          <TabsTrigger value="mixer">Mixer</TabsTrigger>
          <TabsTrigger value="controller">Controller</TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        {view === 'editor' && active !== 'clip' && <ExpandEditorButton />}
        {view !== 'editor' && (
          <IconButton
            label="Hide panel"
            shortcut="Mod+J"
            icon={<ChevronDown />}
            size="sm"
            variant="ghost"
            onClick={() =>
              session.uiStore.setState((s) => ({
                ...s,
                panels: { ...s.panels, bottomOpen: false },
              }))
            }
          />
        )}
      </div>
      <NativeContextMenuGuard />
      <TabsContent value="track" className="flex min-h-0 flex-1 flex-col">
        <TrackContent />
      </TabsContent>
      <TabsContent value="clip" className="flex min-h-0 flex-1 flex-col">
        <ClipContent clip={clip} />
      </TabsContent>
      <TabsContent value="mixer" className="flex min-h-0 flex-1 flex-col">
        <Mixer />
      </TabsContent>
      <TabsContent value="controller" className="flex min-h-0 flex-1 flex-col">
        <ControllerPanel />
      </TabsContent>
    </Tabs>
  );
}
