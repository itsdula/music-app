import { describe, expect, it } from 'vitest';
import {
  createSilentPcm,
  downmixToMono,
  pcmDurationSeconds,
  pcmFrames,
  pcmTransferables,
  validatePcm,
  type PcmAudio,
} from '../src';

describe('PcmAudio layout helpers (frozen pcm.ts)', () => {
  it('reports frames and duration', () => {
    const pcm = createSilentPcm(48000, 2, 24000);
    expect(pcm.channels).toHaveLength(2);
    expect(pcmFrames(pcm)).toBe(24000);
    expect(pcmDurationSeconds(pcm)).toBe(0.5);
    expect(pcmFrames({ sampleRate: 48000, channels: [] })).toBe(0);
    expect(pcmDurationSeconds({ sampleRate: 0, channels: [new Float32Array(10)] })).toBe(0);
  });

  it('down-mixes by averaging and copies mono input', () => {
    const stereo: PcmAudio = {
      sampleRate: 8000,
      channels: [Float32Array.from([1, 0]), Float32Array.from([0, 1])],
    };
    expect(Array.from(downmixToMono(stereo))).toEqual([0.5, 0.5]);
    const mono: PcmAudio = { sampleRate: 8000, channels: [Float32Array.from([0.25])] };
    const copy = downmixToMono(mono);
    expect(copy).toEqual(mono.channels[0]);
    expect(copy).not.toBe(mono.channels[0]);
  });

  it('validates the planar invariants', () => {
    expect(validatePcm(createSilentPcm(44100, 1, 10))).toBeNull();
    expect(validatePcm({ sampleRate: 100, channels: [new Float32Array(1)] })).toMatch(
      /sample rate/,
    );
    expect(validatePcm({ sampleRate: 44100.5, channels: [new Float32Array(1)] })).toMatch(
      /sample rate/,
    );
    expect(validatePcm({ sampleRate: 44100, channels: [] })).toBe('no channels');
    expect(
      validatePcm({ sampleRate: 44100, channels: [new Float32Array(1), new Float32Array(2)] }),
    ).toMatch(/different lengths/);
  });

  it('lists unique transferable buffers', () => {
    const shared = new Float32Array(8);
    const pcm: PcmAudio = {
      sampleRate: 8000,
      channels: [shared.subarray(0, 4), shared.subarray(4), new Float32Array(4)],
    };
    expect(pcmTransferables(pcm)).toHaveLength(2);
  });
});
