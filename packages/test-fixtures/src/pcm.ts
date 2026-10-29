/**
 * Planar PCM produced by the fixture generators. Structurally identical to
 * `PcmAudio` from `@studio/audio-dsp` (this package stays dependency-free so any
 * implementation — TS, Rust golden-file generators — can consume it).
 */
export interface FixturePcm {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export function monoPcm(sampleRate: number, samples: Float32Array): FixturePcm {
  return { sampleRate, channels: [samples] };
}

/** Number of sample frames for a duration (rounded to the nearest sample). */
export function framesFor(sampleRate: number, durationSeconds: number): number {
  return Math.max(0, Math.round(durationSeconds * sampleRate));
}

/** Silence of the given duration (mono unless `channelCount` is given). */
export function silence(sampleRate: number, durationSeconds: number, channelCount = 1): FixturePcm {
  const frames = framesFor(sampleRate, durationSeconds);
  return {
    sampleRate,
    channels: Array.from({ length: channelCount }, () => new Float32Array(frames)),
  };
}

/**
 * Concatenates PCM parts in time. All parts must share the sample rate; the result has
 * as many channels as the widest part, and mono parts are copied into every channel.
 */
export function concatenatePcm(parts: readonly FixturePcm[]): FixturePcm {
  const first = parts[0];
  if (first === undefined) throw new RangeError('concatenatePcm needs at least one part');
  const sampleRate = first.sampleRate;
  let channelCount = 0;
  let total = 0;
  for (const part of parts) {
    if (part.sampleRate !== sampleRate) {
      throw new RangeError(`sample rate mismatch: ${part.sampleRate} vs ${sampleRate}`);
    }
    channelCount = Math.max(channelCount, part.channels.length);
    total += part.channels[0]?.length ?? 0;
  }
  const channels = Array.from({ length: channelCount }, () => new Float32Array(total));
  let offset = 0;
  for (const part of parts) {
    const frames = part.channels[0]?.length ?? 0;
    for (let c = 0; c < channelCount; c++) {
      const source = part.channels.length === 1 ? part.channels[0] : part.channels[c];
      if (source !== undefined) channels[c]!.set(source, offset);
    }
    offset += frames;
  }
  return { sampleRate, channels };
}

/** Sample-wise sum of equally long mono or multichannel parts (for mixing noise into a vowel). */
export function mixPcm(parts: readonly FixturePcm[]): FixturePcm {
  const first = parts[0];
  if (first === undefined) throw new RangeError('mixPcm needs at least one part');
  const frames = first.channels[0]?.length ?? 0;
  const channelCount = Math.max(...parts.map((p) => p.channels.length));
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
  for (const part of parts) {
    if (part.sampleRate !== first.sampleRate) throw new RangeError('sample rate mismatch');
    if ((part.channels[0]?.length ?? 0) !== frames) throw new RangeError('length mismatch');
    for (let c = 0; c < channelCount; c++) {
      const source = part.channels.length === 1 ? part.channels[0]! : part.channels[c];
      if (source === undefined) continue;
      const target = channels[c]!;
      for (let i = 0; i < frames; i++) target[i]! += source[i]!;
    }
  }
  return { sampleRate: first.sampleRate, channels };
}

/** Scales a buffer in place so its peak absolute value equals `peak` (no-op for silence). */
export function normalizePeak(samples: Float32Array | Float64Array, peak: number): void {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]!));
  if (max === 0) return;
  const gain = peak / max;
  for (let i = 0; i < samples.length; i++) samples[i] = samples[i]! * gain;
}
