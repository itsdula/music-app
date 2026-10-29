import { decodeWav, encodeWav } from '@studio/audio-dsp';

/** A mono 16-bit sine WAV (deterministic) for import tests. */
export function sineWav({ seconds = 1, frequency = 440, amplitude = 0.5, sampleRate = 48_000 } = {}): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return Buffer.from(encodeWav({ sampleRate, channels: [data] }, { bitDepth: 16 }));
}

export interface WavStats {
  readonly seconds: number;
  readonly peak: number;
  readonly rms: number;
  readonly sampleRate: number;
  readonly channelCount: number;
}

export function wavStats(bytes: Uint8Array): WavStats {
  const pcm = decodeWav(bytes);
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const channel of pcm.channels) {
    for (const v of channel) {
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      count += 1;
    }
  }
  return {
    seconds: (pcm.channels[0]?.length ?? 0) / pcm.sampleRate,
    peak,
    rms: Math.sqrt(sum / Math.max(1, count)),
    sampleRate: pcm.sampleRate,
    channelCount: pcm.channels.length,
  };
}
