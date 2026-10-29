/**
 * Small pure command builders shared by editors and the EditController.
 */
import type { Command } from '@studio/commands';
import type { Clip, TrackColor } from '@studio/domain';

/** Whether a clip repeats its content (MIDI loop length / audio loop length set). */
export function isClipLooping(clip: Clip): boolean {
  return clip.kind === 'midi'
    ? clip.loopLengthTicks !== undefined
    : clip.loopLengthFrames !== undefined;
}

/** Command that turns looping on (repeating what is currently visible) or off; null if unchanged. */
export function setClipLoopCommand(clip: Clip, on: boolean): Command | null {
  if (isClipLooping(clip) === on) return null;
  if (clip.kind === 'midi')
    return {
      type: 'clip.updateMidi',
      clipId: clip.id,
      patch: {
        loopLengthTicks: on ? Math.max(1, clip.contentOffsetTicks + clip.lengthTicks) : null,
      },
    };
  return {
    type: 'clip.updateAudio',
    clipId: clip.id,
    patch: { loopLengthFrames: on ? Math.max(1, clip.lengthFrames) : null },
  };
}

/** Patch for clip-level properties shared by both clip kinds. */
export function clipPatchCommand(
  clip: Clip,
  patch: { readonly name?: string; readonly color?: TrackColor; readonly muted?: boolean },
): Command {
  return clip.kind === 'midi'
    ? { type: 'clip.updateMidi', clipId: clip.id, patch }
    : { type: 'clip.updateAudio', clipId: clip.id, patch };
}
