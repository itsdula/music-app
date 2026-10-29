import { decodeWav, encodeWav, type PcmAudio } from '@studio/audio-dsp';
import { melodyF0, synthesizeVowel } from '@studio/test-fixtures';

/** A mono 16-bit sine WAV (deterministic) for import tests. */
export function sineWav({
  seconds = 1,
  frequency = 440,
  amplitude = 0.5,
  sampleRate = 48_000,
} = {}): Buffer {
  const frames = Math.round(seconds * sampleRate);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++)
    data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
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

/** Pitches (MIDI) and detuning (cents) of the synthetic vocal phrase. */
export const VOCAL_NOTES = [57, 60, 64]; // A3, C4, E4
export const VOCAL_DETUNE_CENTS = [-30, 20, -15];

/** A synthetic sung vowel with known, deliberately detuned pitches (no recorded voices). */
export function detunedVocalWav(): Buffer {
  const f0 = melodyF0(
    VOCAL_NOTES.map((midi, i) => ({ midi, startSeconds: 0.1 + i * 0.48, durationSeconds: 0.38 })),
    { detuneCents: VOCAL_DETUNE_CENTS },
  );
  const pcm = synthesizeVowel({
    sampleRate: 44_100,
    durationSeconds: 1.5,
    f0,
    vowel: 'a',
    seed: 7,
  });
  const audio: PcmAudio = {
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.map((c) => c.slice()),
  };
  return Buffer.from(encodeWav(audio, { bitDepth: 16 }));
}
