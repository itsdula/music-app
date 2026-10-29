/**
 * Context-menu builders for the arrangement: regions (clips), empty lane space, track
 * headers / mixer strips and the ruler. Every action goes through the EditController or
 * `session.history`, so it is one undo entry.
 */
import {
  clipEndTick,
  gridDivisionTicks,
  snapTick,
  ticksPerBar,
  TRACK_COLORS,
  type Clip,
  type ClipId,
  type TrackId,
} from '@studio/domain';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Maximize2,
  Pencil,
  Plus,
  Scissors,
  SquareSplitHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react';
import { SEPARATOR, type MenuEntryInput } from '../../components/context-menu';
import { isClipLooping } from '../../lib/clip-commands';
import { playheadTick, revealClipInEditor } from '../../lib/editor-navigation';
import type { StudioSession } from '../../session/studio-session';
import { navigate, selectClips, selectTrack } from '../../state/ui-store';

function swatch(color: string) {
  return <span className="block size-3 rounded-full" style={{ backgroundColor: color }} />;
}

/** "Color" submenu over the track palette. */
export function colorSubmenu(
  id: string,
  current: string | undefined,
  apply: (color: string) => void,
): MenuEntryInput {
  return {
    kind: 'submenu',
    id,
    label: 'Color',
    items: TRACK_COLORS.map((color, i) => ({
      id: `${id}-${i}`,
      label: color === current ? `${color} (current)` : color,
      icon: swatch(color),
      onSelect: () => apply(color),
    })),
  };
}

/** Add-track actions (instrument, drums, audio, vocal). */
export function addTrackEntries(session: StudioSession): MenuEntryInput[] {
  const { edits } = session;
  return [
    {
      id: 'add-instrument-track',
      label: 'Add instrument track',
      onSelect: () => edits.addTrack('instrument'),
    },
    {
      id: 'add-drum-track',
      label: 'Add drum track',
      onSelect: () => edits.addTrack('instrument', { instrument: 'drums' }),
    },
    { id: 'add-audio-track', label: 'Add audio track', onSelect: () => edits.addTrack('audio') },
    { id: 'add-vocal-track', label: 'Add vocal track', onSelect: () => edits.addTrack('vocal') },
  ];
}

/** "Add track" submenu. */
export function addTrackSubmenu(session: StudioSession): MenuEntryInput {
  return { kind: 'submenu', id: 'add-track', label: 'Add track', items: addTrackEntries(session) };
}

export interface RegionMenuContext {
  /** Clips the menu acts on (the selection, after the right-click selected the target). */
  readonly clipIds: readonly ClipId[];
  /** The clip under the pointer. */
  readonly anchorClipId: ClipId;
  /** Timeline tick under the pointer (snapped). */
  readonly atTick: number;
  /** Starts inline renaming of the clip. */
  readonly onRename: (clipId: ClipId) => void;
}

export function regionMenu(session: StudioSession, ctx: RegionMenuContext): MenuEntryInput[] {
  const { edits, history, uiStore } = session;
  const project = history.present;
  const clips = ctx.clipIds.map((id) => project.clips[id]).filter((c): c is Clip => Boolean(c));
  const anchor = project.clips[ctx.anchorClipId];
  if (!anchor || clips.length === 0) return [];
  const ids = clips.map((c) => c.id);
  const multi = clips.length > 1;
  const playhead = playheadTick(session);
  const splittable = clips.some(
    (c) => playhead > c.startTick && playhead < clipEndTick(c, project),
  );
  const allLooping = clips.every(isClipLooping);
  const allMuted = clips.every((c) => c.muted);
  const midiWithNotes = clips.filter((c) => c.kind === 'midi' && c.notes.length > 0);
  const anyMidi = clips.some((c) => c.kind === 'midi');
  const gridTicks = gridDivisionTicks(uiStore.getState().grid, project.meter);
  const noun = multi ? `${clips.length} clips` : 'clip';
  return [
    multi && { kind: 'label', label: `${clips.length} clips selected` },
    {
      id: 'clip-open',
      label: anchor.kind === 'midi' ? 'Open in piano roll' : 'Open in editor',
      shortcut: 'Enter',
      onSelect: () => uiStore.setState((s) => revealClipInEditor(s, anchor.id)),
    },
    {
      id: 'clip-open-full',
      label: 'Open in full editor',
      icon: <Maximize2 />,
      onSelect: () => uiStore.setState((s) => navigate(revealClipInEditor(s, anchor.id), 'editor')),
    },
    SEPARATOR,
    {
      id: 'clip-cut',
      label: 'Cut',
      shortcut: 'Mod+X',
      icon: <Scissors />,
      onSelect: () => edits.cutClips(ids),
    },
    {
      id: 'clip-copy',
      label: 'Copy',
      shortcut: 'Mod+C',
      icon: <Copy />,
      onSelect: () => edits.copyClips(ids),
    },
    {
      id: 'clip-paste',
      label: 'Paste here',
      shortcut: 'Mod+V',
      icon: <ClipboardPaste />,
      disabled: !edits.hasClipboard,
      onSelect: () => edits.paste(ctx.atTick, anchor.trackId),
    },
    {
      id: 'clip-duplicate',
      label: 'Duplicate',
      shortcut: 'Mod+D',
      icon: <CopyPlus />,
      onSelect: () => edits.duplicateClips(ids),
    },
    {
      id: 'clip-delete',
      label: multi ? `Delete ${noun}` : 'Delete',
      shortcut: 'Del',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => edits.deleteClips(ids),
    },
    SEPARATOR,
    {
      id: 'clip-split',
      label: 'Split at playhead',
      shortcut: 'Mod+E',
      icon: <SquareSplitHorizontal />,
      disabled: !splittable,
      onSelect: () => edits.splitClipsAt(ids, playhead),
    },
    {
      id: 'clip-loop',
      label: multi ? 'Loop clips' : 'Loop clip',
      checked: allLooping,
      onSelect: () => edits.setClipsLooping(ids, !allLooping),
    },
    {
      id: 'clip-mute',
      label: multi ? 'Mute clips' : 'Mute clip',
      checked: allMuted,
      onSelect: () => edits.setClipsMuted(ids, !allMuted),
    },
    anyMidi && {
      id: 'clip-quantize',
      label: 'Quantize notes',
      shortcut: 'Q',
      icon: <Wand2 />,
      disabled: midiWithNotes.length === 0,
      onSelect: () => edits.quantizeClips(ids, gridTicks),
    },
    SEPARATOR,
    {
      id: 'clip-rename',
      label: 'Rename…',
      icon: <Pencil />,
      disabled: multi,
      onSelect: () => ctx.onRename(anchor.id),
    },
    colorSubmenu('clip-color', multi ? undefined : (anchor.color ?? undefined), (color) =>
      edits.setClipsColor(ids, color),
    ),
    SEPARATOR,
    {
      id: 'clip-select-track',
      label: 'Select all on track',
      onSelect: () => edits.selectAllOnTrack(anchor.trackId),
    },
    {
      id: 'clip-loop-selection',
      label: 'Set loop to selection',
      onSelect: () => edits.setLoopToClips(ids),
    },
  ];
}

export interface LaneMenuContext {
  readonly trackId: TrackId | null;
  /** Timeline tick under the pointer (snapped to the grid). */
  readonly atTick: number;
}

export function laneMenu(session: StudioSession, ctx: LaneMenuContext): MenuEntryInput[] {
  const { edits, history } = session;
  const project = history.present;
  const track = ctx.trackId ? project.tracks[ctx.trackId] : undefined;
  const bar = ticksPerBar(project.meter);
  const barStart = snapTick(ctx.atTick, gridDivisionTicks('bar', project.meter), 'floor');
  const hasClips = track ? Object.values(project.clips).some((c) => c.trackId === track.id) : false;
  return [
    track && {
      id: 'lane-paste',
      label: 'Paste here',
      shortcut: 'Mod+V',
      icon: <ClipboardPaste />,
      disabled: !edits.hasClipboard,
      onSelect: () => edits.paste(ctx.atTick, track.id),
    },
    track && {
      id: 'lane-new-clip',
      label:
        track.kind === 'instrument'
          ? 'New MIDI clip here'
          : 'New MIDI clip (instrument tracks only)',
      icon: <Plus />,
      disabled: track.kind !== 'instrument',
      onSelect: () => edits.createMidiClip(track.id, barStart, bar),
    },
    track && {
      id: 'lane-select-all',
      label: 'Select all on track',
      disabled: !hasClips,
      onSelect: () => edits.selectAllOnTrack(track.id),
    },
    SEPARATOR,
    addTrackSubmenu(session),
  ];
}

export interface TrackMenuOptions {
  /** Starts inline renaming (the header's rename field). */
  readonly onRename?: () => void;
  /** Extra entries placed after the mixer toggles (e.g. mixer-strip resets). */
  readonly extra?: readonly MenuEntryInput[];
}

export function trackMenu(
  session: StudioSession,
  trackId: TrackId,
  options: TrackMenuOptions = {},
): MenuEntryInput[] {
  const { edits, history } = session;
  const project = history.present;
  const track = project.tracks[trackId];
  if (!track) return [];
  const index = project.trackOrder.indexOf(trackId);
  const setMixer = (mixer: Partial<typeof track.mixer>, label: string) =>
    history.execute({ type: 'track.setMixer', trackId, mixer }, { label });
  return [
    options.onRename && {
      id: 'track-rename',
      label: 'Rename…',
      icon: <Pencil />,
      onSelect: options.onRename,
    },
    colorSubmenu('track-color', track.color, (color) => edits.setTrackColor(trackId, color)),
    SEPARATOR,
    {
      id: 'track-mute',
      label: 'Mute',
      checked: track.mixer.mute,
      onSelect: () => setMixer({ mute: !track.mixer.mute }, track.mixer.mute ? 'Unmute' : 'Mute'),
    },
    {
      id: 'track-solo',
      label: 'Solo',
      checked: track.mixer.solo,
      onSelect: () => setMixer({ solo: !track.mixer.solo }, track.mixer.solo ? 'Unsolo' : 'Solo'),
    },
    {
      id: 'track-arm',
      label: 'Arm for recording',
      checked: track.armed,
      onSelect: () =>
        history.execute(
          { type: 'track.update', trackId, patch: { armed: !track.armed } },
          { label: track.armed ? 'Disarm Track' : 'Arm Track' },
        ),
    },
    ...(options.extra ?? []),
    SEPARATOR,
    {
      id: 'track-move-up',
      label: 'Move up',
      icon: <ArrowUp />,
      disabled: index <= 0,
      onSelect: () => edits.moveTrack(trackId, -1),
    },
    {
      id: 'track-move-down',
      label: 'Move down',
      icon: <ArrowDown />,
      disabled: index < 0 || index >= project.trackOrder.length - 1,
      onSelect: () => edits.moveTrack(trackId, 1),
    },
    {
      id: 'track-duplicate',
      label: 'Duplicate track',
      icon: <CopyPlus />,
      onSelect: () => edits.duplicateTrack(trackId),
    },
    {
      id: 'track-select-clips',
      label: 'Select all clips on track',
      onSelect: () => edits.selectAllOnTrack(trackId),
    },
    {
      id: 'track-delete',
      label: 'Delete track',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => edits.deleteTrack(trackId),
    },
    SEPARATOR,
    {
      id: 'track-add-instrument',
      label: 'Add instrument track',
      onSelect: () => edits.addTrack('instrument'),
    },
    {
      id: 'track-add-audio',
      label: 'Add audio track',
      onSelect: () => edits.addTrack('audio'),
    },
    {
      kind: 'submenu',
      id: 'track-add-more',
      label: 'Add other track',
      items: [
        {
          id: 'track-add-drums',
          label: 'Drum track',
          onSelect: () => edits.addTrack('instrument', { instrument: 'drums' }),
        },
        { id: 'track-add-vocal', label: 'Vocal track', onSelect: () => edits.addTrack('vocal') },
      ],
    },
  ];
}

export function rulerMenu(session: StudioSession, atTick: number): MenuEntryInput[] {
  const { edits, history, uiStore, transport } = session;
  const project = history.present;
  const loop = project.loop;
  const selected = [...uiStore.getState().selection.clipIds].filter((id) => project.clips[id]);
  const barTicks = gridDivisionTicks('bar', project.meter);
  const barStart = snapTick(atTick, barTicks, 'floor');
  const setLoop = (startTick: number, endTick: number, label: string) =>
    history.execute(
      { type: 'project.setLoop', loop: { enabled: true, startTick, endTick } },
      { label },
    );
  return [
    {
      id: 'ruler-seek',
      label: 'Move playhead here',
      onSelect: () => void transport.seek(Math.max(0, atTick)),
    },
    SEPARATOR,
    {
      id: 'ruler-loop',
      label: 'Loop playback',
      shortcut: 'L',
      checked: loop.enabled,
      onSelect: () => edits.setLoopEnabled(!loop.enabled),
    },
    {
      id: 'ruler-loop-selection',
      label: 'Set loop from selection',
      disabled: selected.length === 0,
      onSelect: () => edits.setLoopToClips(selected),
    },
    {
      id: 'ruler-loop-bar',
      label: 'Loop this bar',
      onSelect: () => setLoop(barStart, barStart + barTicks, 'Loop Bar'),
    },
    {
      id: 'ruler-loop-start',
      label: 'Set loop start here',
      disabled: atTick >= loop.endTick,
      onSelect: () => setLoop(Math.max(0, atTick), loop.endTick, 'Set Loop Start'),
    },
    {
      id: 'ruler-loop-end',
      label: 'Set loop end here',
      disabled: atTick <= loop.startTick,
      onSelect: () => setLoop(loop.startTick, atTick, 'Set Loop End'),
    },
    {
      id: 'ruler-loop-clear',
      label: 'Clear loop',
      disabled: !loop.enabled,
      onSelect: () => edits.setLoopEnabled(false),
    },
  ];
}

/** Resolves which clips a right-click on `clipId` acts on, updating the selection. */
export function selectionForContextClick(session: StudioSession, clip: Clip): ClipId[] {
  const { uiStore } = session;
  const selected = uiStore.getState().selection.clipIds;
  if (!selected.has(clip.id))
    uiStore.setState((s) => selectClips(selectTrack(s, clip.trackId), [clip.id]));
  else uiStore.setState((s) => selectTrack(s, clip.trackId));
  return [...uiStore.getState().selection.clipIds].filter(
    (id) => session.history.present.clips[id],
  );
}
