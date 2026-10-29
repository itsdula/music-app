import {
  asAssetId,
  asClipId,
  asEffectId,
  asNoteId,
  asProjectId,
  asTrackId,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createTrack,
  type AssetRef,
  type AudioClip,
  type Clip,
  type EffectKind,
  type MidiClip,
  type MidiNote,
  type Project,
  type Track,
  type TrackKind,
} from '@studio/domain';

export function note(
  id: string,
  startTick: number,
  durationTicks: number,
  pitch = 60,
  velocity = 100,
): MidiNote {
  return { id: asNoteId(id), startTick, durationTicks, pitch, velocity };
}

export function track(
  id: string,
  kind: TrackKind = 'instrument',
  patch: Partial<Track> = {},
): Track {
  return { ...createTrack({ id: asTrackId(id), kind }), ...patch };
}

export function midiClip(
  id: string,
  trackId: string,
  startTick: number,
  notes: MidiNote[],
  patch: Partial<MidiClip> = {},
): MidiClip {
  return {
    ...createMidiClip({ id: asClipId(id), trackId: asTrackId(trackId), startTick, notes }),
    ...patch,
  };
}

export function audioClip(
  id: string,
  trackId: string,
  assetId: string,
  startTick: number,
  lengthFrames: number,
  patch: Partial<AudioClip> = {},
): AudioClip {
  return {
    ...createAudioClip({
      id: asClipId(id),
      trackId: asTrackId(trackId),
      assetId: asAssetId(assetId),
      startTick,
      lengthFrames,
    }),
    ...patch,
  };
}

export function asset(id: string, frames: number, sampleRate = 48000): AssetRef {
  return {
    id: asAssetId(id),
    name: id,
    kind: 'audio',
    mimeType: 'audio/wav',
    sampleRate,
    channels: 1,
    frames,
    contentHash: `hash-${id}`,
    byteLength: frames * 2,
    source: 'import',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

export function effect(
  id: string,
  kind: EffectKind,
  params: Record<string, number> = {},
  bypass = false,
) {
  const slot = createEffectSlot(asEffectId(id), kind);
  return { ...slot, bypass, params: { ...slot.params, ...params } };
}

export function synthTrack(id: string, params: Record<string, number> = {}): Track {
  const instrument = createInstrumentConfig('synth');
  return track(id, 'instrument', {
    instrument: { ...instrument, params: { ...instrument.params, ...params } },
  });
}

export function project(
  tracks: Track[],
  clips: Clip[] = [],
  assets: AssetRef[] = [],
  patch: Partial<Project> = {},
): Project {
  const base = createEmptyProject({ id: asProjectId('prj_1'), now: '2026-01-01T00:00:00.000Z' });
  return {
    ...base,
    trackOrder: tracks.map((t) => t.id),
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    clips: Object.fromEntries(clips.map((c) => [c.id, c])),
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
    ...patch,
  };
}
