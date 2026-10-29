import { dominantFrequency, encodeWav } from '@studio/audio-dsp';
import { describe, expect, it } from 'vitest';
import {
  AudioEngineError,
  BROWSER_DECODE_SAMPLE_RATE,
  audioBufferToPcm,
  decodeAudioBytes,
  pcmToAudioBuffer,
} from '../src';
import { sine } from './helpers';

/** Encodes ~0.6 s of a 440 Hz tone with the browser's MediaRecorder (WebM/Opus). */
async function recordOpus(): Promise<Uint8Array> {
  const ctx = new AudioContext({ sampleRate: 44100 });
  const osc = new OscillatorNode(ctx, { frequency: 440 });
  const destination = new MediaStreamAudioDestinationNode(ctx);
  osc.connect(destination);
  osc.start();
  const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  await new Promise((r) => setTimeout(r, 600));
  recorder.stop();
  await stopped;
  await ctx.close();
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
}

describe('decodeAudioBytes', () => {
  it('decodes WAV with decodeWav, preserving the native sample rate and samples', async () => {
    const pcm = {
      sampleRate: 44100,
      channels: [sine(440, 0.25, 0.5, 44100), sine(660, 0.25, 0.5, 44100)],
    };
    const bytes = encodeWav(pcm, { bitDepth: 32 });
    const decoded = await decodeAudioBytes(bytes, { mimeType: 'audio/wav', fileName: 'tone.wav' });
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels[1]).toEqual(pcm.channels[1]);
    // Detected by magic even with a misleading hint.
    const sniffed = await decodeAudioBytes(bytes, {
      mimeType: 'application/octet-stream',
      fileName: 'x.bin',
    });
    expect(sniffed.sampleRate).toBe(44100);
  });

  it('decodes compressed formats through the browser at 48 kHz without consuming the input', async () => {
    const bytes = await recordOpus();
    const copy = bytes.slice();
    const decoded = await decodeAudioBytes(bytes, {
      mimeType: 'audio/webm',
      fileName: 'take.webm',
    });
    expect(decoded.sampleRate).toBe(BROWSER_DECODE_SAMPLE_RATE);
    expect(decoded.channels[0]!.length).toBeGreaterThan(0.3 * 48000);
    const middle = decoded.channels[0]!.subarray(4800, 4800 + 8192);
    expect(dominantFrequency(middle, 48000)).toBeCloseTo(440, -1);
    expect(bytes).toEqual(copy);
  });

  it('rejects undecodable data with asset-decode-failed', async () => {
    await expect(
      decodeAudioBytes(new Uint8Array([1, 2, 3, 4]), {
        mimeType: 'audio/mpeg',
        fileName: 'bad.mp3',
      }),
    ).rejects.toMatchObject({
      code: 'asset-decode-failed',
    });
    // A WAV header with an unsupported codec falls back to the browser, then fails with both reasons.
    const adpcm = encodeWav(
      { sampleRate: 8000, channels: [new Float32Array(8)] },
      { bitDepth: 16 },
    );
    new DataView(adpcm.buffer).setUint16(20, 2, true);
    const error = await decodeAudioBytes(adpcm, {
      mimeType: 'audio/wav',
      fileName: 'adpcm.wav',
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AudioEngineError);
    expect((error as AudioEngineError).detail).toMatch(/unsupported format tag/);
  });

  it('converts between PcmAudio and AudioBuffer', () => {
    const pcm = { sampleRate: 22050, channels: [Float32Array.from([0.1, -0.2, 0.3])] };
    const buffer = pcmToAudioBuffer(pcm);
    expect(buffer.sampleRate).toBe(22050);
    expect(audioBufferToPcm(buffer)).toEqual(pcm);
    expect(() => pcmToAudioBuffer({ sampleRate: 1, channels: [] })).toThrow(/Invalid PCM/);
  });
});
