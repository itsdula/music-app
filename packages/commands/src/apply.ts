import type { Project } from '@studio/domain';
import * as assets from './handlers/assets';
import * as clips from './handlers/clips';
import * as effects from './handlers/effects';
import * as mappings from './handlers/mappings';
import * as notes from './handlers/notes';
import * as projectHandlers from './handlers/project';
import * as tracks from './handlers/tracks';
import * as vocal from './handlers/vocal';
import { CommandError, type Command } from './types';

function dispatch(project: Project, command: Command): Project {
  switch (command.type) {
    case 'project.rename':
      return projectHandlers.rename(project, command);
    case 'project.setTempo':
      return projectHandlers.setTempo(project, command);
    case 'project.setMeter':
      return projectHandlers.setMeter(project, command);
    case 'project.setLoop':
      return projectHandlers.setLoop(project, command);
    case 'project.setMetronome':
      return projectHandlers.setMetronome(project, command);
    case 'track.add':
      return tracks.addTrack(project, command);
    case 'track.remove':
      return tracks.removeTrack(project, command);
    case 'track.update':
      return tracks.updateTrack(project, command);
    case 'track.move':
      return tracks.moveTrack(project, command);
    case 'track.setMixer':
      return tracks.setMixer(project, command);
    case 'track.setInstrument':
      return tracks.setInstrument(project, command);
    case 'track.setInstrumentParams':
      return tracks.setInstrumentParams(project, command);
    case 'effect.add':
      return effects.addEffect(project, command);
    case 'effect.remove':
      return effects.removeEffect(project, command);
    case 'effect.move':
      return effects.moveEffect(project, command);
    case 'effect.setParams':
      return effects.setEffectParams(project, command);
    case 'effect.setBypass':
      return effects.setEffectBypass(project, command);
    case 'master.setGain':
      return effects.setMasterGain(project, command);
    case 'clip.add':
      return clips.addClips(project, command);
    case 'clip.remove':
      return clips.removeClips(project, command);
    case 'clip.move':
      return clips.moveClips(project, command);
    case 'clip.updateMidi':
      return clips.updateMidiClip(project, command);
    case 'clip.updateAudio':
      return clips.updateAudioClip(project, command);
    case 'clip.trimStart':
      return clips.trimClipStart(project, command);
    case 'clip.trimEnd':
      return clips.trimClipEnd(project, command);
    case 'clip.split':
      return clips.splitClip(project, command);
    case 'notes.add':
      return notes.addNotes(project, command);
    case 'notes.remove':
      return notes.removeNotes(project, command);
    case 'notes.update':
      return notes.updateNotes(project, command);
    case 'notes.quantize':
      return notes.quantizeNotes(project, command);
    case 'asset.register':
      return assets.registerAsset(project, command);
    case 'asset.remove':
      return assets.removeAsset(project, command);
    case 'vocal.setDoc':
      return vocal.setDoc(project, command);
    case 'vocal.removeDoc':
      return vocal.removeDoc(project, command);
    case 'vocal.setCorrection':
      return vocal.setCorrection(project, command);
    case 'vocal.setNoteEdits':
      return vocal.setNoteEdits(project, command);
    case 'vocal.clearTargets':
      return vocal.clearTargets(project, command);
    case 'vocal.resetNotes':
      return vocal.resetNotes(project, command);
    case 'vocal.replaceSegments':
      return vocal.replaceSegments(project, command);
    case 'vocal.setEnabled':
      return vocal.setEnabled(project, command);
    case 'mapping.add':
      return mappings.addMapping(project, command);
    case 'mapping.update':
      return mappings.updateMapping(project, command);
    case 'mapping.remove':
      return mappings.removeMappings(project, command);
    default: {
      const unknown: never = command;
      throw new CommandError(
        'invalid-argument',
        `unknown command type ${String((unknown as { type?: unknown }).type)}`,
      );
    }
  }
}

/**
 * Applies one command purely. Returns the same `project` reference when the command
 * changes nothing; throws `CommandError` (tagged with the command type) when invalid.
 */
export function applyCommand(project: Project, command: Command): Project {
  try {
    return dispatch(project, command);
  } catch (error) {
    if (error instanceof CommandError && error.commandType === undefined) {
      throw new CommandError(error.code, error.message, command.type);
    }
    throw error;
  }
}

/** Applies commands in order; throws on the first invalid command (inputs stay untouched). */
export function applyCommands(project: Project, commands: readonly Command[]): Project {
  let current = project;
  for (const command of commands) current = applyCommand(current, command);
  return current;
}
