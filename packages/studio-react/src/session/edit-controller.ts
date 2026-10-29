/**
 * High-level editing operations that combine selection, ID generation and commands.
 * Every operation is one undo entry (executeBatch or a single command).
 */
import type { RecordedTake } from '@studio/audio-contracts';
import type { Command, CommandHistory } from '@studio/commands';
import {
  clipEndTick,
  createAudioClip,
  createEffectSlot,
  createInstrumentConfig,
  createMidiClip,
  createTrack,
  orderedTracks,
  PPQ,
  ticksPerBar,
  type AssetRef,
  type Clip,
  type ClipId,
  type EffectKind,
  type EffectId,
  type IdFactory,
  type InstrumentKind,
  type MappingId,
  type MidiNote,
  type Project,
  type TrackId,
  type TrackKind,
} from '@studio/domain';
import type { PickedFile } from '@studio/platform-contracts';
import type { UiStore } from '../state/ui-store';
import { openClipInEditor, selectClips, selectTrack } from '../state/ui-store';
import type { AssetLibrary } from './asset-library';

export interface RecordedMidiTake {
  readonly trackId: TrackId;
  readonly startTick: number;
  readonly endTick: number;
  readonly notes: ReadonlyArray<{ pitch: number; velocity: number; startTick: number; durationTicks: number }>;
}

interface ClipboardContent {
  readonly clips: readonly Clip[];
  /** Earliest start among copied clips (positions are pasted relative to it). */
  readonly originTick: number;
}

const KIND_NAMES: Record<TrackKind, string> = { instrument: 'Instrument', audio: 'Audio', vocal: 'Vocal' };

export class EditController {
  private clipboard: ClipboardContent | null = null;

  constructor(
    private readonly history: CommandHistory,
    private readonly ui: UiStore,
    private readonly ids: IdFactory,
    private readonly assets: AssetLibrary,
  ) {}

  private get project(): Project {
    return this.history.present;
  }

  newMappingId(): MappingId {
    return this.ids.create('mapping');
  }

  private nextTrackName(kind: TrackKind, instrument?: InstrumentKind): string {
    const base = instrument === 'drums' ? 'Drums' : KIND_NAMES[kind];
    const names = new Set(Object.values(this.project.tracks).map((t) => t.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
  }

  addTrack(kind: TrackKind, options: { instrument?: InstrumentKind; presetId?: string; name?: string } = {}): TrackId {
    const id = this.ids.create('track');
    const index = this.project.trackOrder.length;
    const selectedId = this.ui.getState().selection.trackId;
    const insertAt = selectedId ? this.project.trackOrder.indexOf(selectedId) + 1 : index;
    const instrument =
      kind === 'instrument'
        ? createInstrumentConfig(options.instrument ?? 'synth', options.presetId ?? (options.instrument === 'drums' ? undefined : 'synth.keys'))
        : undefined;
    const track = createTrack({
      id,
      kind,
      index,
      name: options.name ?? this.nextTrackName(kind, options.instrument),
      ...(instrument ? { instrument } : {}),
    });
    const result = this.history.execute(
      { type: 'track.add', track, index: insertAt > 0 ? insertAt : index },
      { label: `Add ${KIND_NAMES[kind]} Track` },
    );
    if (result.ok) this.ui.setState((s) => selectTrack(s, id));
    return id;
  }

  removeTrack(trackId: TrackId): void {
    this.history.execute({ type: 'track.remove', trackId });
  }

  /** Creates an empty MIDI clip (default one bar) and opens it in the piano roll. */
  createMidiClip(trackId: TrackId, startTick: number, lengthTicks?: number): ClipId | null {
    const track = this.project.tracks[trackId];
    if (!track || track.kind !== 'instrument') return null;
    const id = this.ids.create('clip');
    const clip = createMidiClip({
      id,
      trackId,
      startTick: Math.max(0, Math.round(startTick)),
      lengthTicks: lengthTicks ?? ticksPerBar(this.project.meter),
      name: track.name,
    });
    const result = this.history.execute({ type: 'clip.add', clips: [clip] }, { label: 'Create MIDI Clip' });
    if (!result.ok) return null;
    this.ui.setState((s) => openClipInEditor(selectClips(selectTrack(s, trackId), [id]), id));
    return id;
  }

  addNotes(clipId: ClipId, notes: ReadonlyArray<Omit<MidiNote, 'id'>>): MidiNote[] {
    const created = notes.map((n) => ({ ...n, id: this.ids.create('note') }));
    this.history.execute({ type: 'notes.add', clipId, notes: created }, { label: created.length === 1 ? 'Add Note' : `Add ${created.length} Notes` });
    return created;
  }

  deleteClips(clipIds: readonly ClipId[]): void {
    const existing = clipIds.filter((id) => this.project.clips[id]);
    if (existing.length === 0) return;
    this.history.execute({ type: 'clip.remove', clipIds: existing });
    this.ui.setState((s) => selectClips(s, []));
  }

  /** Duplicates clips right after the selection's end, preserving relative positions. */
  duplicateClips(clipIds: readonly ClipId[]): ClipId[] {
    const clips = clipIds.map((id) => this.project.clips[id]).filter((c): c is Clip => Boolean(c));
    if (clips.length === 0) return [];
    const start = Math.min(...clips.map((c) => c.startTick));
    const end = Math.max(...clips.map((c) => Math.ceil(clipEndTick(c, this.project))));
    const offset = end - start;
    const copies = clips.map((c) => ({ ...c, id: this.ids.create('clip'), startTick: c.startTick + offset }));
    const result = this.history.execute({ type: 'clip.add', clips: copies }, { label: 'Duplicate' });
    if (!result.ok) return [];
    const ids = copies.map((c) => c.id);
    this.ui.setState((s) => selectClips(s, ids));
    return ids;
  }

  /** Splits every given clip that spans `tick` (one undo entry). */
  splitClipsAt(clipIds: readonly ClipId[], tick: number): void {
    const commands: Command[] = [];
    for (const id of clipIds) {
      const clip = this.project.clips[id];
      if (!clip) continue;
      if (tick > clip.startTick && tick < clipEndTick(clip, this.project)) {
        commands.push({ type: 'clip.split', clipId: id, atTick: Math.round(tick), newClipId: this.ids.create('clip') });
      }
    }
    if (commands.length > 0) this.history.executeBatch(commands, { label: 'Split' });
  }

  copyClips(clipIds: readonly ClipId[]): void {
    const clips = clipIds.map((id) => this.project.clips[id]).filter((c): c is Clip => Boolean(c));
    if (clips.length === 0) return;
    this.clipboard = { clips, originTick: Math.min(...clips.map((c) => c.startTick)) };
  }

  cutClips(clipIds: readonly ClipId[]): void {
    this.copyClips(clipIds);
    this.deleteClips(clipIds);
  }

  get hasClipboard(): boolean {
    return this.clipboard !== null;
  }

  /** Pastes at `atTick`; clips keep their tracks when compatible, else go to `fallbackTrackId`. */
  paste(atTick: number, fallbackTrackId: TrackId | null): ClipId[] {
    const content = this.clipboard;
    if (!content) return [];
    const project = this.project;
    const pasted: Clip[] = [];
    for (const clip of content.clips) {
      let trackId = clip.trackId;
      const fits = (id: TrackId) => {
        const t = project.tracks[id];
        return Boolean(t && (clip.kind === 'midi' ? t.kind === 'instrument' : t.kind !== 'instrument'));
      };
      if (!fits(trackId)) {
        if (fallbackTrackId && fits(fallbackTrackId)) trackId = fallbackTrackId;
        else continue;
      }
      if (clip.kind === 'audio' && !project.assets[clip.assetId]) continue;
      pasted.push({ ...clip, id: this.ids.create('clip'), trackId, startTick: Math.max(0, Math.round(atTick + clip.startTick - content.originTick)) });
    }
    if (pasted.length === 0) return [];
    const result = this.history.execute({ type: 'clip.add', clips: pasted }, { label: 'Paste' });
    if (!result.ok) return [];
    const ids = pasted.map((c) => c.id);
    this.ui.setState((s) => selectClips(s, ids));
    return ids;
  }

  /** Imports audio files onto a track (creating an audio track if needed). One undo entry. */
  async importAudio(files: readonly PickedFile[], options: { trackId?: TrackId; atTick?: number } = {}): Promise<ClipId[]> {
    const imported = [];
    for (const file of files) imported.push(await this.assets.importFile(file));
    if (imported.length === 0) return [];
    const commands: Command[] = [];
    let trackId = options.trackId;
    const target = trackId ? this.project.tracks[trackId] : undefined;
    if (!target || target.kind === 'instrument') {
      trackId = this.ids.create('track');
      commands.push({
        type: 'track.add',
        track: createTrack({ id: trackId, kind: 'audio', index: this.project.trackOrder.length, name: imported[0]!.asset.name }),
      });
    }
    let cursor = Math.max(0, Math.round(options.atTick ?? 0));
    const clipIds: ClipId[] = [];
    const registered = new Set<string>();
    for (const { asset, reused } of imported) {
      if (!reused && !registered.has(asset.id)) {
        commands.push({ type: 'asset.register', asset });
        registered.add(asset.id);
      }
      const id = this.ids.create('clip');
      clipIds.push(id);
      commands.push({
        type: 'clip.add',
        clips: [createAudioClip({ id, trackId: trackId!, assetId: asset.id, startTick: cursor, lengthFrames: asset.frames, name: asset.name })],
      });
      cursor += Math.ceil((asset.frames / asset.sampleRate) * (this.project.bpm / 60) * PPQ);
    }
    const result = this.history.executeBatch(commands, { label: files.length === 1 ? 'Import Audio' : `Import ${files.length} Files` });
    if (!result.ok) throw result.error;
    this.ui.setState((s) => selectClips(selectTrack(s, trackId!), clipIds));
    return clipIds;
  }

  /** Places an already-registered asset as a clip (on `trackId`, or a new audio track). */
  placeAsset(assetId: AssetRef['id'], trackId: TrackId | null, atTick: number): ClipId | null {
    const asset = this.project.assets[assetId];
    if (!asset) return null;
    const commands: Command[] = [];
    let target = trackId && this.project.tracks[trackId]?.kind !== 'instrument' ? trackId : null;
    if (!target) {
      target = this.ids.create('track');
      commands.push({
        type: 'track.add',
        track: createTrack({ id: target, kind: 'audio', index: this.project.trackOrder.length, name: asset.name }),
      });
    }
    const id = this.ids.create('clip');
    commands.push({
      type: 'clip.add',
      clips: [createAudioClip({ id, trackId: target, assetId, startTick: Math.max(0, Math.round(atTick)), lengthFrames: asset.frames, name: asset.name })],
    });
    const result = this.history.executeBatch(commands, { label: 'Place Audio' });
    if (!result.ok) return null;
    const placedTrack = target;
    this.ui.setState((s) => selectClips(selectTrack(s, placedTrack), [id]));
    return id;
  }

  /** Commits recorded audio takes as assets + clips (one undo entry). */
  async commitAudioTakes(takes: readonly RecordedTake[]): Promise<void> {
    const commands: Command[] = [];
    for (const take of takes) {
      const track = this.project.tracks[take.trackId];
      if (!track) continue;
      const asset: AssetRef = await this.assets.addPcm(take.pcm, `${track.name} take`, 'recording');
      commands.push({ type: 'asset.register', asset });
      commands.push({
        type: 'clip.add',
        clips: [
          createAudioClip({
            id: this.ids.create('clip'),
            trackId: take.trackId,
            assetId: asset.id,
            startTick: Math.max(0, Math.round(take.startTick)),
            lengthFrames: asset.frames,
            name: `${track.name} take`,
          }),
        ],
      });
    }
    if (commands.length > 0) this.history.executeBatch(commands, { label: 'Record Audio' });
  }

  /** Commits a MIDI recording as a new clip. */
  commitMidiTake(take: RecordedMidiTake): ClipId | null {
    if (take.notes.length === 0) return null;
    const track = this.project.tracks[take.trackId];
    if (!track || track.kind !== 'instrument') return null;
    const id = this.ids.create('clip');
    const startTick = Math.max(0, take.startTick);
    const lengthTicks = Math.max(PPQ, take.endTick - startTick);
    const clip = createMidiClip({
      id,
      trackId: take.trackId,
      startTick,
      lengthTicks,
      name: `${track.name} rec`,
      notes: take.notes
        .filter((n) => n.startTick >= startTick && n.startTick < startTick + lengthTicks)
        .map((n) => ({
          id: this.ids.create('note'),
          pitch: n.pitch,
          velocity: Math.min(127, Math.max(1, n.velocity)),
          startTick: n.startTick - startTick,
          durationTicks: Math.max(1, n.durationTicks),
        })),
    });
    const result = this.history.execute({ type: 'clip.add', clips: [clip] }, { label: 'Record MIDI' });
    return result.ok ? id : null;
  }

  addEffect(target: TrackId | 'master', kind: EffectKind): EffectId {
    const id = this.ids.create('effect');
    this.history.execute({ type: 'effect.add', target, effect: createEffectSlot(id, kind) }, { label: 'Add Effect' });
    return id;
  }

  /** Ensures there is an instrument track to play into (first armed, else selected, else first). */
  liveInstrumentTrack(): TrackId | null {
    const project = this.project;
    const tracks = orderedTracks(project).filter((t) => t.kind === 'instrument');
    const armed = tracks.find((t) => t.armed);
    if (armed) return armed.id;
    const selectedId = this.ui.getState().selection.trackId;
    const selected = selectedId ? project.tracks[selectedId] : undefined;
    if (selected?.kind === 'instrument') return selected.id;
    return null;
  }
}
