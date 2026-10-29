import {
  INSTRUMENT_PARAM_SPECS,
  type ClipId,
  type MidiMapping,
  type Project,
  type Track,
  type TrackId,
} from '@studio/domain';
import type { CommandOf, TrackPatch } from '../types';
import {
  clampIndex,
  fail,
  getOwn,
  hasOwn,
  insertAt,
  mergeChanged,
  moveItem,
  omitEntries,
  setEntry,
} from '../util';
import {
  clampParamPatch,
  normalizeInstrument,
  normalizeMidiInput,
  normalizeMixerPatch,
  normalizeTrack,
  requireColor,
  requireInputChannels,
  requireMonitor,
  requireName,
} from '../validate';

export function requireTrack(project: Project, trackId: TrackId): Track {
  const track = getOwn(project.tracks, trackId);
  if (!track) fail('not-found', `track ${trackId} not found`);
  return track;
}

export function withTrack(project: Project, track: Track): Project {
  const tracks = setEntry(project.tracks, track.id, track);
  return tracks === project.tracks ? project : { ...project, tracks };
}

export function addTrack(project: Project, command: CommandOf<'track.add'>): Project {
  const track = normalizeTrack(project, command.track);
  if (hasOwn(project.tracks, track.id))
    fail('invalid-argument', `track ${track.id} already exists`);
  const index = clampIndex(command.index, project.trackOrder.length, 'track index');
  return {
    ...project,
    tracks: setEntry(project.tracks, track.id, track),
    trackOrder: insertAt(project.trackOrder, index, track.id),
  };
}

/** Whether a project-scope mapping's parameter address targets the given track. */
function mappingTargetsTrack(mapping: MidiMapping, trackId: TrackId): boolean {
  if (mapping.target.kind !== 'parameter') return false;
  const address = mapping.target.address;
  return (
    (address.scope === 'track' || address.scope === 'instrument' || address.scope === 'effect') &&
    address.trackId === trackId
  );
}

/**
 * Removes the track, every clip on it, its `trackOrder` entry, and every project-scope
 * MIDI mapping whose parameter address targets the track (track, instrument and effect
 * scopes). Mappings to `selectedTrack`/`selectedInstrument` or actions are kept.
 */
export function removeTrack(project: Project, command: CommandOf<'track.remove'>): Project {
  const { trackId } = command;
  requireTrack(project, trackId);
  const clipIds = new Set<ClipId>();
  for (const clip of Object.values(project.clips))
    if (clip.trackId === trackId) clipIds.add(clip.id);
  const midiMappings = project.midiMappings.filter((m) => !mappingTargetsTrack(m, trackId));
  return {
    ...project,
    tracks: omitEntries(project.tracks, new Set([trackId])),
    trackOrder: project.trackOrder.filter((id) => id !== trackId),
    clips: omitEntries(project.clips, clipIds),
    midiMappings:
      midiMappings.length === project.midiMappings.length ? project.midiMappings : midiMappings,
  };
}

export function updateTrack(project: Project, command: CommandOf<'track.update'>): Project {
  const track = requireTrack(project, command.trackId);
  const { patch } = command;
  const normalized: { -readonly [K in keyof TrackPatch]?: TrackPatch[K] } = {};
  if (patch.name !== undefined) normalized.name = requireName(patch.name, 'track name');
  if (patch.color !== undefined) normalized.color = requireColor(patch.color, 'track color');
  if (patch.armed !== undefined) normalized.armed = patch.armed === true;
  if (patch.monitor !== undefined) {
    requireMonitor(patch.monitor);
    normalized.monitor = patch.monitor;
  }
  if (patch.inputChannels !== undefined) {
    if (track.kind === 'instrument') {
      fail('kind-mismatch', 'inputChannels only applies to audio/vocal tracks');
    }
    requireInputChannels(patch.inputChannels);
    normalized.inputChannels = patch.inputChannels;
  }
  if (patch.midiInput !== undefined) {
    if (track.kind !== 'instrument') {
      fail('kind-mismatch', 'MIDI input routing only applies to instrument tracks');
    }
    normalized.midiInput = normalizeMidiInput(patch.midiInput);
  }
  return withTrack(project, mergeChanged(track, normalized));
}

/** Moves a track within `trackOrder`; `toIndex` is clamped into bounds. */
export function moveTrack(project: Project, command: CommandOf<'track.move'>): Project {
  requireTrack(project, command.trackId);
  const from = project.trackOrder.indexOf(command.trackId);
  const to = clampIndex(command.toIndex, project.trackOrder.length - 1, 'track index');
  const trackOrder = moveItem(project.trackOrder, from, to);
  return trackOrder === project.trackOrder ? project : { ...project, trackOrder };
}

export function setMixer(project: Project, command: CommandOf<'track.setMixer'>): Project {
  const track = requireTrack(project, command.trackId);
  const mixer = mergeChanged(track.mixer, normalizeMixerPatch(command.mixer));
  return mixer === track.mixer ? project : withTrack(project, { ...track, mixer });
}

function requireInstrumentTrack(project: Project, trackId: TrackId) {
  const track = requireTrack(project, trackId);
  if (track.kind !== 'instrument' || !track.instrument) {
    fail('kind-mismatch', `track ${trackId} is not an instrument track`);
  }
  return { track, instrument: track.instrument };
}

export function setInstrument(
  project: Project,
  command: CommandOf<'track.setInstrument'>,
): Project {
  const { track } = requireInstrumentTrack(project, command.trackId);
  const instrument = normalizeInstrument(project, command.instrument);
  return withTrack(project, mergeChanged(track, { instrument }));
}

export function setInstrumentParams(
  project: Project,
  command: CommandOf<'track.setInstrumentParams'>,
): Project {
  const { track, instrument } = requireInstrumentTrack(project, command.trackId);
  const patch = clampParamPatch(
    INSTRUMENT_PARAM_SPECS[instrument.kind],
    command.params,
    'instrument',
  );
  const params = mergeChanged(instrument.params, patch);
  if (params === instrument.params) return project;
  return withTrack(project, { ...track, instrument: { ...instrument, params } });
}
