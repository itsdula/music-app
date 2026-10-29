/**
 * PCM audio memory layout shared by every portable DSP function and backend.
 *
 * - Planar: one Float32Array per channel, all of equal length (`frames`).
 * - Nominal range [-1, 1]; values outside are legal intermediates (no implicit clipping).
 * - `sampleRate` is an integer in Hz.
 * - Ownership: functions never retain or mutate input buffers unless documented.
 *   When PCM crosses a Worker/IPC boundary the underlying ArrayBuffers are
 *   *transferred* (the sender must not touch them afterwards); see docs/audio-engine.md.
 */
export interface PcmAudio {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export function pcmFrames(pcm: PcmAudio): number {
  return pcm.channels[0]?.length ?? 0;
}

export function pcmDurationSeconds(pcm: PcmAudio): number {
  return pcm.sampleRate > 0 ? pcmFrames(pcm) / pcm.sampleRate : 0;
}

export function createSilentPcm(
  sampleRate: number,
  channelCount: number,
  frames: number,
): PcmAudio {
  return {
    sampleRate,
    channels: Array.from({ length: channelCount }, () => new Float32Array(frames)),
  };
}

/** Averages all channels into a new mono buffer. */
export function downmixToMono(pcm: PcmAudio): Float32Array {
  const frames = pcmFrames(pcm);
  const count = pcm.channels.length;
  if (count === 1) return pcm.channels[0]!.slice();
  const out = new Float32Array(frames);
  for (const channel of pcm.channels) {
    for (let i = 0; i < frames; i++) out[i]! += channel[i]! / count;
  }
  return out;
}

/** Validates the planar layout invariants; returns an error message or null. */
export function validatePcm(pcm: PcmAudio): string | null {
  if (!Number.isInteger(pcm.sampleRate) || pcm.sampleRate < 3000 || pcm.sampleRate > 768000) {
    return `invalid sample rate ${pcm.sampleRate}`;
  }
  if (pcm.channels.length === 0) return 'no channels';
  const frames = pcm.channels[0]!.length;
  if (pcm.channels.some((c) => c.length !== frames)) return 'channels have different lengths';
  return null;
}

/** ArrayBuffers backing the PCM, for postMessage transfer lists. */
export function pcmTransferables(pcm: PcmAudio): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const channel of pcm.channels) {
    if (channel.buffer instanceof ArrayBuffer) buffers.add(channel.buffer);
  }
  return [...buffers];
}
