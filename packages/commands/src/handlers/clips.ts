import {
  clampParam,
  clipEndTick,
  framesToTicks,
  ticksToFrames,
  type AssetRef,
  type AudioClip,
  type Clip,
  type ClipId,
  type MidiClip,
  type Project,
} from '@studio/domain';
import type { CommandOf, CommandType } from '../types';
import {
  clamp,
  fail,
  getOwn,
  hasOwn,
  mergeChanged,
  omitEntries,
  requireFinite,
  requireInt,
  requireUniqueIds,
  setEntries,
  setEntry,
} from '../util';
import {
  CLIP_GAIN_SPEC,
  clampFades,
  normalizeClip,
  requireClipTrack,
  requireColor,
} from '../validate';

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function requireClip(project: Project, clipId: ClipId): Clip {
  const clip = getOwn(project.clips, clipId);
  if (!clip) fail('not-found', `clip ${clipId} not found`);
  return clip;
}

export function requireMidiClip(project: Project, clipId: ClipId, type: CommandType): MidiClip {
  const clip = requireClip(project, clipId);
  if (clip.kind !== 'midi') fail('kind-mismatch', `${type} requires a MIDI clip`);
  return clip;
}

function requireAudioClip(project: Project, clipId: ClipId, type: CommandType): AudioClip {
  const clip = requireClip(project, clipId);
  if (clip.kind !== 'audio') fail('kind-mismatch', `${type} requires an audio clip`);
  return clip;
}

function requireClipAsset(project: Project, clip: AudioClip): AssetRef {
  const asset = getOwn(project.assets, clip.assetId);
  if (!asset) fail('not-found', `asset ${clip.assetId} not found`);
  return asset;
}

export function withClip(project: Project, clip: Clip): Project {
  const clips = setEntry(project.clips, clip.id, clip);
  return clips === project.clips ? project : { ...project, clips };
}

function requireString(value: string, what: string): string {
  if (typeof value !== 'string') fail('invalid-argument', `${what} must be a string`);
  return value;
}

/** Longest non-looping length an audio clip can have from its source start. */
function maxAudioLength(asset: AssetRef, sourceStartFrame: number): number {
  return Math.max(1, asset.frames - sourceStartFrame);
}

// ---------------------------------------------------------------------------
// Add / remove / move
// ---------------------------------------------------------------------------

export function addClips(project: Project, command: CommandOf<'clip.add'>): Project {
  requireUniqueIds(
    command.clips.map((c) => c.id),
    'clip',
  );
  const entries: (readonly [ClipId, Clip])[] = [];
  for (const clip of command.clips) {
    if (hasOwn(project.clips, clip.id)) fail('invalid-argument', `clip ${clip.id} already exists`);
    entries.push([clip.id, normalizeClip(project, clip)]);
  }
  const clips = setEntries(project.clips, entries);
  return clips === project.clips ? project : { ...project, clips };
}

export function removeClips(project: Project, command: CommandOf<'clip.remove'>): Project {
  for (const id of command.clipIds) requireClip(project, id);
  const clips = omitEntries(project.clips, new Set(command.clipIds));
  return clips === project.clips ? project : { ...project, clips };
}

export function moveClips(project: Project, command: CommandOf<'clip.move'>): Project {
  requireUniqueIds(
    command.moves.map((m) => m.clipId),
    'clip move',
  );
  const entries: (readonly [ClipId, Clip])[] = [];
  for (const move of command.moves) {
    const clip = requireClip(project, move.clipId);
    const startTick = requireInt(move.startTick, 'clip startTick', 0);
    const trackId = move.trackId ?? clip.trackId;
    if (move.trackId !== undefined) requireClipTrack(project, { kind: clip.kind, trackId });
    entries.push([clip.id, mergeChanged<Clip>(clip, { startTick, trackId })]);
  }
  const clips = setEntries(project.clips, entries);
  return clips === project.clips ? project : { ...project, clips };
}

// ---------------------------------------------------------------------------
// Property updates
// ---------------------------------------------------------------------------

export function updateMidiClip(project: Project, command: CommandOf<'clip.updateMidi'>): Project {
  const clip = requireMidiClip(project, command.clipId, command.type);
  const { patch } = command;
  let next: MidiClip = mergeChanged(clip, {
    ...(patch.name !== undefined ? { name: requireString(patch.name, 'clip name') } : {}),
    ...(patch.color !== undefined ? { color: requireColor(patch.color, 'clip color') } : {}),
    ...(patch.muted !== undefined ? { muted: patch.muted === true } : {}),
    ...(typeof patch.loopLengthTicks === 'number'
      ? { loopLengthTicks: requireInt(patch.loopLengthTicks, 'loopLengthTicks', 1) }
      : {}),
  });
  if (patch.loopLengthTicks === null && next.loopLengthTicks !== undefined) {
    const { loopLengthTicks: _cleared, ...rest } = next;
    next = rest;
  }
  return withClip(project, next);
}

export function updateAudioClip(project: Project, command: CommandOf<'clip.updateAudio'>): Project {
  const clip = requireAudioClip(project, command.clipId, command.type);
  const asset = requireClipAsset(project, clip);
  const { patch } = command;
  let next: AudioClip = mergeChanged(clip, {
    ...(patch.name !== undefined ? { name: requireString(patch.name, 'clip name') } : {}),
    ...(patch.color !== undefined ? { color: requireColor(patch.color, 'clip color') } : {}),
    ...(patch.muted !== undefined ? { muted: patch.muted === true } : {}),
    ...(patch.gainDb !== undefined
      ? { gainDb: clampParam(CLIP_GAIN_SPEC, requireFinite(patch.gainDb, 'clip gainDb')) }
      : {}),
    ...(typeof patch.loopLengthFrames === 'number'
      ? { loopLengthFrames: requireInt(patch.loopLengthFrames, 'loopLengthFrames', 1) }
      : {}),
  });
  if (patch.loopLengthFrames === null && next.loopLengthFrames !== undefined) {
    const { loopLengthFrames: _cleared, ...rest } = next;
    next = rest;
  }
  if (next.loopLengthFrames === undefined && next.sourceStartFrame >= asset.frames) {
    // A looped clip's window can be trimmed past the end of its audio; once it stops
    // looping it must start inside the asset again.
    next = mergeChanged(next, { sourceStartFrame: Math.max(0, asset.frames - 1) });
  }
  const lengthFrames =
    next.loopLengthFrames === undefined
      ? Math.min(next.lengthFrames, maxAudioLength(asset, next.sourceStartFrame))
      : next.lengthFrames;
  const fadeIn =
    patch.fadeInFrames !== undefined
      ? requireInt(patch.fadeInFrames, 'fadeInFrames')
      : next.fadeInFrames;
  const fadeOut =
    patch.fadeOutFrames !== undefined
      ? requireInt(patch.fadeOutFrames, 'fadeOutFrames')
      : next.fadeOutFrames;
  // The fade that was *not* edited keeps its value; the edited one is clamped to fit.
  const keep = patch.fadeInFrames !== undefined && patch.fadeOutFrames === undefined ? 'out' : 'in';
  next = mergeChanged(next, { lengthFrames, ...clampFades(lengthFrames, fadeIn, fadeOut, keep) });
  return withClip(project, next);
}

// ---------------------------------------------------------------------------
// Trim / split
// ---------------------------------------------------------------------------

export function trimClipStart(project: Project, command: CommandOf<'clip.trimStart'>): Project {
  const clip = requireClip(project, command.clipId);
  const requested = requireInt(command.startTick, 'startTick', 0);
  const endTick = clipEndTick(clip, project);
  if (requested >= endTick) fail('invalid-argument', 'trimmed start must stay before the clip end');

  if (clip.kind === 'midi') {
    // Content cannot start before content tick 0: clamp so contentOffsetTicks >= 0.
    const delta = Math.max(requested - clip.startTick, -clip.contentOffsetTicks);
    if (delta === 0) return project;
    return withClip(project, {
      ...clip,
      startTick: clip.startTick + delta,
      contentOffsetTicks: clip.contentOffsetTicks + delta,
      lengthTicks: clip.lengthTicks - delta,
    });
  }

  const asset = requireClipAsset(project, clip);
  const delta = requested - clip.startTick;
  if (delta === 0) return project;
  let deltaFrames = ticksToFrames(delta, asset.sampleRate, project.bpm);
  let startTick = requested;
  if (clip.sourceStartFrame + deltaFrames < 0) {
    // Cannot reveal audio before the source start: stop at frame 0 and move the
    // timeline start by the equivalent (rounded) number of ticks.
    deltaFrames = -clip.sourceStartFrame;
    startTick = Math.max(
      0,
      clip.startTick + Math.round(framesToTicks(deltaFrames, asset.sampleRate, project.bpm)),
    );
  }
  deltaFrames = Math.min(deltaFrames, clip.lengthFrames - 1);
  const lengthFrames = clip.lengthFrames - deltaFrames;
  return withClip(
    project,
    mergeChanged(clip, {
      startTick,
      sourceStartFrame: clip.sourceStartFrame + deltaFrames,
      lengthFrames,
      ...clampFades(lengthFrames, clip.fadeInFrames, clip.fadeOutFrames, 'in'),
    }),
  );
}

export function trimClipEnd(project: Project, command: CommandOf<'clip.trimEnd'>): Project {
  const clip = requireClip(project, command.clipId);
  const endTick = requireInt(command.endTick, 'endTick', 0);
  if (endTick <= clip.startTick)
    fail('invalid-argument', 'trimmed end must be after the clip start');
  if (clip.kind === 'midi') {
    return withClip(project, mergeChanged(clip, { lengthTicks: endTick - clip.startTick }));
  }
  const asset = requireClipAsset(project, clip);
  let lengthFrames = Math.max(
    1,
    ticksToFrames(endTick - clip.startTick, asset.sampleRate, project.bpm),
  );
  if (clip.loopLengthFrames === undefined) {
    lengthFrames = Math.min(lengthFrames, maxAudioLength(asset, clip.sourceStartFrame));
  }
  return withClip(
    project,
    mergeChanged(clip, {
      lengthFrames,
      ...clampFades(lengthFrames, clip.fadeInFrames, clip.fadeOutFrames, 'in'),
    }),
  );
}

export function splitClip(project: Project, command: CommandOf<'clip.split'>): Project {
  const clip = requireClip(project, command.clipId);
  const atTick = requireInt(command.atTick, 'atTick');
  if (hasOwn(project.clips, command.newClipId)) {
    fail('invalid-argument', `clip ${command.newClipId} already exists`);
  }
  const endTick = clipEndTick(clip, project);
  if (!(clip.startTick < atTick && atTick < endTick)) {
    fail('invalid-argument', 'split position must be strictly inside the clip');
  }
  const offset = atTick - clip.startTick;
  let left: Clip;
  let right: Clip;
  if (clip.kind === 'midi') {
    left = { ...clip, lengthTicks: offset };
    right = {
      ...clip,
      id: command.newClipId,
      startTick: atTick,
      lengthTicks: clip.lengthTicks - offset,
      contentOffsetTicks: clip.contentOffsetTicks + offset,
    };
  } else {
    if (clip.lengthFrames < 2) fail('invalid-argument', 'clip is too short to split');
    const asset = requireClipAsset(project, clip);
    const leftFrames = clamp(
      ticksToFrames(offset, asset.sampleRate, project.bpm),
      1,
      clip.lengthFrames - 1,
    );
    const rightFrames = clip.lengthFrames - leftFrames;
    left = {
      ...clip,
      lengthFrames: leftFrames,
      ...clampFades(leftFrames, clip.fadeInFrames, 0, 'in'),
    };
    right = {
      ...clip,
      id: command.newClipId,
      startTick: atTick,
      sourceStartFrame: clip.sourceStartFrame + leftFrames,
      lengthFrames: rightFrames,
      ...clampFades(rightFrames, 0, clip.fadeOutFrames, 'out'),
    };
  }
  return {
    ...project,
    clips: setEntries(project.clips, [
      [left.id, left],
      [right.id, right],
    ]),
  };
}
