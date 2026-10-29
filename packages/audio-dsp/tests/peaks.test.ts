import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPeakPyramid, readPeaks, selectPeakLevel, type PcmAudio } from '../src';

function bruteForce(pcm: PcmAudio, from: number, to: number): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const ch of pcm.channels) {
    for (let i = Math.max(0, from); i < Math.min(ch.length, to); i++) {
      lo = Math.min(lo, ch[i]!);
      hi = Math.max(hi, ch[i]!);
    }
  }
  return [lo, hi];
}

describe('peak pyramid', () => {
  it('builds levels down to a single bin with the documented block sizes', () => {
    const pcm: PcmAudio = { sampleRate: 48000, channels: [new Float32Array(10_000)] };
    const pyramid = buildPeakPyramid(pcm, { baseBlockSize: 100, factor: 4 });
    expect(pyramid.levels.map((l) => l.blockSize)).toEqual([100, 400, 1600, 6400, 25600]);
    expect(pyramid.levels.map((l) => l.min.length)).toEqual([100, 25, 7, 2, 1]);
    expect(pyramid.frames).toBe(10_000);
    expect(pyramid.channelCount).toBe(1);
    expect(selectPeakLevel(pyramid, 50)).toBe(0);
    expect(selectPeakLevel(pyramid, 1600)).toBe(2);
    expect(selectPeakLevel(pyramid, 1e9)).toBe(4);
  });

  it('handles empty audio and degenerate reads', () => {
    const empty = buildPeakPyramid({ sampleRate: 8000, channels: [new Float32Array(0)] });
    expect(empty.levels).toHaveLength(1);
    expect(Array.from(readPeaks(empty, 0, 100, 4))).toEqual(new Array(8).fill(0));
    const pcm: PcmAudio = { sampleRate: 8000, channels: [Float32Array.from([0.5, -0.5])] };
    const pyramid = buildPeakPyramid(pcm, { baseBlockSize: 1 });
    expect(readPeaks(pyramid, 0, 2, 0)).toHaveLength(0);
    expect(Array.from(readPeaks(pyramid, 2, 1, 2))).toEqual([0, 0, 0, 0]);
    // Columns beyond the end of the audio are zero.
    expect(Array.from(readPeaks(pyramid, 0, 4, 2))).toEqual([-0.5, 0.5, 0, 0]);
  });

  it('matches brute force over the bin-aligned span of every column (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 600 }),
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 600 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 0, max: 700 }),
        fc.integer({ min: 1, max: 700 }),
        fc.integer({ min: 1, max: 30 }),
        (a, b, baseBlockSize, factor, start, span, columns) => {
          const frames = Math.min(a.length, b.length);
          const pcm: PcmAudio = {
            sampleRate: 8000,
            channels: [
              Float32Array.from(a.slice(0, frames)),
              Float32Array.from(b.slice(0, frames)),
            ],
          };
          const pyramid = buildPeakPyramid(pcm, { baseBlockSize, factor });
          const end = start + span;
          const out = readPeaks(pyramid, start, end, columns);
          const width = span / columns;
          const level = pyramid.levels[selectPeakLevel(pyramid, width)]!;
          for (let c = 0; c < columns; c++) {
            const from = Math.max(0, start + c * width);
            const to = Math.min(frames, start + (c + 1) * width);
            if (to <= from) {
              expect([out[c * 2], out[c * 2 + 1]]).toEqual([0, 0]);
              continue;
            }
            const alignedFrom = Math.floor(from / level.blockSize) * level.blockSize;
            const alignedTo = Math.ceil(to / level.blockSize) * level.blockSize;
            const [lo, hi] = bruteForce(pcm, alignedFrom, alignedTo);
            expect(out[c * 2]).toBe(Math.fround(lo));
            expect(out[c * 2 + 1]).toBe(Math.fround(hi));
            // Conservative: never under-reports the exact column envelope.
            const [exactLo, exactHi] = bruteForce(pcm, Math.floor(from), Math.ceil(to));
            expect(out[c * 2]!).toBeLessThanOrEqual(exactLo);
            expect(out[c * 2 + 1]!).toBeGreaterThanOrEqual(exactHi);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('is exact when columns align with base blocks', () => {
    const frames = 4096;
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = Math.sin(i * 0.37) * (i / frames);
    const pcm: PcmAudio = { sampleRate: 48000, channels: [ch] };
    const pyramid = buildPeakPyramid(pcm, { baseBlockSize: 64 });
    const out = readPeaks(pyramid, 0, frames, 16);
    for (let c = 0; c < 16; c++) {
      const [lo, hi] = bruteForce(pcm, c * 256, (c + 1) * 256);
      expect(out[c * 2]).toBe(Math.fround(lo));
      expect(out[c * 2 + 1]).toBe(Math.fround(hi));
    }
  });

  it('is structured-clone serializable', () => {
    const pcm: PcmAudio = { sampleRate: 8000, channels: [Float32Array.from([0.1, -0.2, 0.3])] };
    const pyramid = buildPeakPyramid(pcm, { baseBlockSize: 2 });
    const clone = structuredClone(pyramid);
    expect(clone).toEqual(pyramid);
    expect(readPeaks(clone, 0, 3, 1)).toEqual(readPeaks(pyramid, 0, 3, 1));
  });
});
