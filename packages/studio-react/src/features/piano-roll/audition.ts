import type { AudioEngine } from '@studio/audio-contracts';
import type { TrackId } from '@studio/domain';

/** Plays a short preview note through the track's instrument (live input path). */
export function auditionNote(engine: AudioEngine, trackId: TrackId, pitch: number, velocity = 96, durationMs = 220): void {
  if (engine.getLifecycleState() !== 'running') return;
  engine.live.noteOn(trackId, pitch, velocity);
  setTimeout(() => engine.live.noteOff(trackId, pitch), durationMs);
}
