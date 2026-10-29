import {
  EmptyState,
  IconButton,
  SegmentedControl,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@studio/ui';
import { ChevronDown, Piano } from 'lucide-react';
import type { AudioClip } from '@studio/domain';
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

function EditorContent() {
  const editorClipId = useUiState((s) => s.selection.editorClipId);
  const selectedTrackId = useUiState((s) => s.selection.trackId);
  const clip = useProjectState((s) => (editorClipId ? s.project.clips[editorClipId] : undefined));
  const clipTrack = useProjectState((s) => (clip ? s.project.tracks[clip.trackId] : undefined));
  const selectedTrack = useProjectState((s) =>
    selectedTrackId ? s.project.tracks[selectedTrackId] : undefined,
  );

  if (clip?.kind === 'midi') return <PianoRoll clip={clip} />;
  if (clip?.kind === 'audio')
    return <AudioEditorSwitch clip={clip} vocalTrack={clipTrack?.kind === 'vocal'} />;
  if (selectedTrack)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PianoRollHint />
        <TrackDevicePanel track={selectedTrack} />
      </div>
    );
  return (
    <div className="flex flex-1 flex-col">
      <PianoRollHint />
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={<Piano />}
          title="Nothing to edit"
          description="Click a clip to edit its notes or audio here, or select a track to see its instrument and effects."
        />
      </div>
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
  const setPanel = (bottomPanel: BottomPanelId) =>
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel } }));
  return (
    <Tabs
      value={panel}
      onValueChange={(v) => setPanel(v as BottomPanelId)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2">
        <TabsList aria-label="Bottom panel">
          <TabsTrigger value="editor">{editorClipId ? 'Clip' : 'Track'}</TabsTrigger>
          <TabsTrigger value="mixer">Mixer</TabsTrigger>
          <TabsTrigger value="controller">Controller</TabsTrigger>
        </TabsList>
        <div className="flex-1" />
        {editorClipId && panel === 'editor' && (
          <button
            type="button"
            className="text-[11px] text-text-muted hover:text-text"
            onClick={() =>
              session.uiStore.setState((s) => ({
                ...s,
                selection: { ...s.selection, editorClipId: null },
              }))
            }
          >
            Show track devices
          </button>
        )}
        {view === 'editor' && !(panel === 'editor' && editorClipId) && <ExpandEditorButton />}
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
      <TabsContent value="editor" className="flex min-h-0 flex-1 flex-col">
        <EditorContent />
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
