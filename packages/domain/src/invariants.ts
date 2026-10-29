/**
 * Structural invariants of a Project. Commands must preserve them; importers and
 * migrations check them after schema validation. Returns all violations (empty = valid).
 */
import type { Project } from './model';
import { MAX_BPM, MIN_BPM, isValidTimeSignature } from './time';

export interface InvariantViolation {
  readonly path: string;
  readonly message: string;
}

const isInt = (n: number) => Number.isInteger(n);

export function checkProjectInvariants(project: Project): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const push = (path: string, message: string) => v.push({ path, message });

  if (!(project.bpm >= MIN_BPM && project.bpm <= MAX_BPM))
    push('bpm', `bpm out of range: ${project.bpm}`);
  if (!isValidTimeSignature(project.meter)) push('meter', 'invalid time signature');
  if (
    !isInt(project.loop.startTick) ||
    !isInt(project.loop.endTick) ||
    project.loop.startTick < 0
  ) {
    push('loop', 'loop bounds must be non-negative integer ticks');
  }
  if (project.loop.endTick <= project.loop.startTick)
    push('loop', 'loop end must be after loop start');

  const trackIds = Object.keys(project.tracks);
  const orderSet = new Set<string>(project.trackOrder);
  if (orderSet.size !== project.trackOrder.length)
    push('trackOrder', 'duplicate track in trackOrder');
  if (orderSet.size !== trackIds.length || trackIds.some((id) => !orderSet.has(id))) {
    push('trackOrder', 'trackOrder must list every track exactly once');
  }

  for (const [id, track] of Object.entries(project.tracks)) {
    if (track.id !== id) push(`tracks.${id}`, 'track id does not match its key');
    if (track.kind === 'instrument' && !track.instrument)
      push(`tracks.${id}`, 'instrument track without instrument');
    if (track.mixer.pan < -1 || track.mixer.pan > 1)
      push(`tracks.${id}.mixer.pan`, 'pan out of range');
    const effectIds = new Set(track.effects.map((e) => e.id));
    if (effectIds.size !== track.effects.length)
      push(`tracks.${id}.effects`, 'duplicate effect id');
  }

  for (const [id, clip] of Object.entries(project.clips)) {
    const path = `clips.${id}`;
    if (clip.id !== id) push(path, 'clip id does not match its key');
    const track = project.tracks[clip.trackId];
    if (!track) {
      push(path, `clip references missing track ${clip.trackId}`);
      continue;
    }
    if (!isInt(clip.startTick) || clip.startTick < 0)
      push(path, 'startTick must be a non-negative integer');
    if (clip.kind === 'midi') {
      if (track.kind !== 'instrument') push(path, 'MIDI clip on a non-instrument track');
      if (!isInt(clip.lengthTicks) || clip.lengthTicks <= 0)
        push(path, 'lengthTicks must be a positive integer');
      if (!isInt(clip.contentOffsetTicks) || clip.contentOffsetTicks < 0)
        push(path, 'contentOffsetTicks must be >= 0');
      if (
        clip.loopLengthTicks !== undefined &&
        (!isInt(clip.loopLengthTicks) || clip.loopLengthTicks <= 0)
      ) {
        push(path, 'loopLengthTicks must be a positive integer');
      }
      let previous: (typeof clip.notes)[number] | undefined;
      const noteIds = new Set<string>();
      for (const note of clip.notes) {
        if (noteIds.has(note.id)) push(`${path}.notes`, `duplicate note id ${note.id}`);
        noteIds.add(note.id);
        if (!isInt(note.startTick) || note.startTick < 0)
          push(`${path}.notes.${note.id}`, 'note start must be an integer >= 0');
        if (!isInt(note.durationTicks) || note.durationTicks <= 0)
          push(`${path}.notes.${note.id}`, 'note duration must be a positive integer');
        if (!isInt(note.pitch) || note.pitch < 0 || note.pitch > 127)
          push(`${path}.notes.${note.id}`, 'pitch out of range');
        if (!isInt(note.velocity) || note.velocity < 1 || note.velocity > 127)
          push(`${path}.notes.${note.id}`, 'velocity out of range');
        if (
          previous &&
          (previous.startTick > note.startTick ||
            (previous.startTick === note.startTick && previous.pitch > note.pitch))
        ) {
          push(`${path}.notes`, 'notes are not sorted');
        }
        previous = note;
      }
    } else {
      if (track.kind === 'instrument') push(path, 'audio clip on an instrument track');
      const asset = project.assets[clip.assetId];
      if (!asset) push(path, `clip references missing asset ${clip.assetId}`);
      if (!isInt(clip.sourceStartFrame) || clip.sourceStartFrame < 0)
        push(path, 'sourceStartFrame must be >= 0');
      if (!isInt(clip.lengthFrames) || clip.lengthFrames <= 0)
        push(path, 'lengthFrames must be positive');
      if (
        clip.fadeInFrames < 0 ||
        clip.fadeOutFrames < 0 ||
        clip.fadeInFrames + clip.fadeOutFrames > clip.lengthFrames
      ) {
        push(path, 'fades must be non-negative and fit within the clip');
      }
      if (
        asset &&
        clip.loopLengthFrames === undefined &&
        clip.sourceStartFrame + clip.lengthFrames > asset.frames
      ) {
        push(path, 'non-looping clip extends past the end of its asset');
      }
    }
  }

  for (const [assetId, doc] of Object.entries(project.vocalEdits)) {
    if (!project.assets[assetId as keyof typeof project.assets])
      push(`vocalEdits.${assetId}`, 'vocal edits for missing asset');
    for (let i = 1; i < doc.segments.length; i++) {
      if (doc.segments[i - 1]!.startSeconds > doc.segments[i]!.startSeconds) {
        push(`vocalEdits.${assetId}.segments`, 'segments are not sorted');
        break;
      }
    }
  }

  const mappingIds = new Set(project.midiMappings.map((m) => m.id));
  if (mappingIds.size !== project.midiMappings.length) push('midiMappings', 'duplicate mapping id');
  return v;
}
