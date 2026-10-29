/**
 * Incremental engine updates produced by {@link diffProjects}. The union itself is owned by
 * the AudioEngine contract (`@studio/audio-contracts`), which every backend consumes.
 */
import type { AudioGraphChange } from '@studio/audio-contracts';

export type { AudioGraphChange };
export type AudioGraphChangeType = AudioGraphChange['type'];
