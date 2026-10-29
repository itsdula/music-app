import { EFFECT_LABELS } from '@studio/domain';
import type { Command } from './types';

/** "Note" for one item, "3 Notes" for several. */
function count(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : `${n} ${plural}`;
}

function onlyKeys(patch: object, keys: readonly string[]): boolean {
  const defined = Object.entries(patch)
    .filter(([key, value]) => value !== undefined && key !== 'id')
    .map(([key]) => key);
  return defined.length > 0 && defined.every((key) => keys.includes(key));
}

function describeNotesUpdate(command: Extract<Command, { type: 'notes.update' }>): string {
  const n = command.patches.length;
  const notes = count(n, 'Note');
  if (command.patches.every((p) => onlyKeys(p, ['startTick', 'pitch']))) return `Move ${notes}`;
  if (command.patches.every((p) => onlyKeys(p, ['durationTicks']))) return `Resize ${notes}`;
  if (command.patches.every((p) => onlyKeys(p, ['velocity']))) return 'Change Velocity';
  return `Edit ${notes}`;
}

function describeMixer(command: Extract<Command, { type: 'track.setMixer' }>): string {
  const { mixer } = command;
  if (onlyKeys(mixer, ['gainDb'])) return 'Change Volume';
  if (onlyKeys(mixer, ['pan'])) return 'Change Pan';
  if (onlyKeys(mixer, ['mute'])) return mixer.mute ? 'Mute Track' : 'Unmute Track';
  if (onlyKeys(mixer, ['solo'])) return mixer.solo ? 'Solo Track' : 'Unsolo Track';
  return 'Change Mixer';
}

function describeTrackUpdate(command: Extract<Command, { type: 'track.update' }>): string {
  const { patch } = command;
  if (onlyKeys(patch, ['name'])) return 'Rename Track';
  if (onlyKeys(patch, ['color'])) return 'Change Track Color';
  if (onlyKeys(patch, ['armed'])) return patch.armed ? 'Arm Track' : 'Disarm Track';
  if (onlyKeys(patch, ['monitor'])) return 'Change Monitoring';
  if (onlyKeys(patch, ['midiInput'])) return 'Change MIDI Input';
  return 'Edit Track';
}

function describeAudioUpdate(command: Extract<Command, { type: 'clip.updateAudio' }>): string {
  const { patch } = command;
  if (onlyKeys(patch, ['fadeInFrames', 'fadeOutFrames'])) return 'Change Fade';
  if (onlyKeys(patch, ['gainDb'])) return 'Change Clip Gain';
  return describeClipPatch(patch);
}

function describeClipPatch(patch: object & { name?: string; muted?: boolean }): string {
  if (onlyKeys(patch, ['name'])) return 'Rename Clip';
  if (onlyKeys(patch, ['muted'])) return patch.muted ? 'Mute Clip' : 'Unmute Clip';
  if (onlyKeys(patch, ['color'])) return 'Change Clip Color';
  if (onlyKeys(patch, ['loopLengthTicks', 'loopLengthFrames'])) return 'Change Clip Loop';
  return 'Edit Clip';
}

function describeSegments(command: Extract<Command, { type: 'vocal.replaceSegments' }>): string {
  const removed = command.removeIds.length;
  const added = command.add.length;
  if (removed === 1 && added >= 2) return 'Split Vocal Note';
  if (removed >= 2 && added === 1) return 'Merge Vocal Notes';
  return 'Edit Vocal Notes';
}

/** Short, human-readable undo-menu label for a command (e.g. "Move 3 Notes"). */
export function describeCommand(command: Command): string {
  switch (command.type) {
    case 'project.rename':
      return 'Rename Project';
    case 'project.setTempo':
      return 'Set Tempo';
    case 'project.setMeter':
      return 'Set Time Signature';
    case 'project.setLoop':
      return 'Set Loop';
    case 'project.setMetronome':
      return 'Change Metronome';
    case 'track.add':
      return 'Add Track';
    case 'track.remove':
      return 'Delete Track';
    case 'track.update':
      return describeTrackUpdate(command);
    case 'track.move':
      return 'Move Track';
    case 'track.setMixer':
      return describeMixer(command);
    case 'track.setInstrument':
      return 'Change Instrument';
    case 'track.setInstrumentParams':
      return 'Change Instrument Settings';
    case 'effect.add':
      return `Add ${EFFECT_LABELS[command.effect.kind] ?? 'Effect'}`;
    case 'effect.remove':
      return 'Remove Effect';
    case 'effect.move':
      return 'Move Effect';
    case 'effect.setParams':
      return 'Change Effect Settings';
    case 'effect.setBypass':
      return command.bypass ? 'Bypass Effect' : 'Enable Effect';
    case 'master.setGain':
      return 'Change Master Volume';
    case 'clip.add':
      return `Add ${count(command.clips.length, 'Clip')}`;
    case 'clip.remove':
      return `Delete ${count(command.clipIds.length, 'Clip')}`;
    case 'clip.move':
      return `Move ${count(command.moves.length, 'Clip')}`;
    case 'clip.updateMidi':
      return describeClipPatch(command.patch);
    case 'clip.updateAudio':
      return describeAudioUpdate(command);
    case 'clip.trimStart':
    case 'clip.trimEnd':
      return 'Trim Clip';
    case 'clip.split':
      return 'Split Clip';
    case 'notes.add':
      return `Add ${count(command.notes.length, 'Note')}`;
    case 'notes.remove':
      return `Delete ${count(command.noteIds.length, 'Note')}`;
    case 'notes.update':
      return describeNotesUpdate(command);
    case 'notes.quantize':
      return `Quantize ${count(command.noteIds.length, 'Note')}`;
    case 'asset.register':
      return 'Add Audio File';
    case 'asset.remove':
      return 'Remove Audio File';
    case 'vocal.setDoc':
      return 'Analyze Vocal';
    case 'vocal.removeDoc':
      return 'Remove Vocal Edits';
    case 'vocal.setCorrection':
      return 'Change Pitch Correction';
    case 'vocal.setNoteEdits':
      return `Edit ${count(Object.keys(command.edits).length, 'Vocal Note')}`;
    case 'vocal.clearTargets':
      return 'Clear Pitch Targets';
    case 'vocal.resetNotes':
      return `Reset ${count(command.noteIds.length, 'Vocal Note')}`;
    case 'vocal.replaceSegments':
      return describeSegments(command);
    case 'vocal.setEnabled':
      return command.enabled ? 'Enable Pitch Correction' : 'Bypass Pitch Correction';
    case 'mapping.add':
      return 'Add MIDI Mapping';
    case 'mapping.update':
      return 'Edit MIDI Mapping';
    case 'mapping.remove':
      return `Remove ${count(command.mappingIds.length, 'MIDI Mapping')}`;
    default:
      return 'Edit';
  }
}

/** Label for a group of commands: the shared label when they agree, otherwise a generic one. */
export function describeCommands(commands: readonly Command[]): string {
  if (commands.length === 0) return 'Edit';
  const labels = new Set(commands.map(describeCommand));
  return labels.size === 1 ? describeCommand(commands[0]!) : 'Multiple Edits';
}
