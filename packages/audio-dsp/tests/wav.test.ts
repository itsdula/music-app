import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSeededRandom, decodeWav, encodeWav, isWavBytes, type PcmAudio } from '../src';

function sinePcm(sampleRate: number, channels: number, frames: number): PcmAudio {
  return {
    sampleRate,
    channels: Array.from({ length: channels }, (_, c) => {
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++)
        out[i] = 0.8 * Math.sin((2 * Math.PI * (440 + c * 110) * i) / sampleRate);
      return out;
    }),
  };
}

function maxError(a: PcmAudio, b: PcmAudio): number {
  let err = 0;
  a.channels.forEach((ch, c) => {
    for (let i = 0; i < ch.length; i++) err = Math.max(err, Math.abs(ch[i]! - b.channels[c]![i]!));
  });
  return err;
}

/** Builds a WAV byte array chunk by chunk (for hand-crafted header tests). */
function buildWav(chunks: { id: string; body: Uint8Array; declaredSize?: number }[]): Uint8Array {
  const parts: number[] = [];
  const push32 = (v: number) =>
    parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const pushAscii = (s: string) => {
    for (const ch of s) parts.push(ch.charCodeAt(0));
  };
  pushAscii('RIFF');
  push32(0); // patched below
  pushAscii('WAVE');
  for (const chunk of chunks) {
    pushAscii(chunk.id);
    push32(chunk.declaredSize ?? chunk.body.length);
    parts.push(...chunk.body);
    if (chunk.body.length % 2 === 1) parts.push(0);
  }
  const bytes = Uint8Array.from(parts);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  return bytes;
}

function fmtBody(
  tag: number,
  channels: number,
  rate: number,
  bits: number,
  extra?: Uint8Array,
): Uint8Array {
  const size = 16 + (extra ? 2 + extra.length : 0);
  const body = new Uint8Array(size);
  const v = new DataView(body.buffer);
  const blockAlign = (bits / 8) * channels;
  v.setUint16(0, tag, true);
  v.setUint16(2, channels, true);
  v.setUint32(4, rate, true);
  v.setUint32(8, rate * blockAlign, true);
  v.setUint16(12, blockAlign, true);
  v.setUint16(14, bits, true);
  if (extra) {
    v.setUint16(16, extra.length, true);
    body.set(extra, 18);
  }
  return body;
}

function extensibleExtra(subFormat: number, validBits: number): Uint8Array {
  const extra = new Uint8Array(22);
  const v = new DataView(extra.buffer);
  v.setUint16(0, validBits, true);
  v.setUint32(2, 0x3, true); // channel mask FL|FR
  v.setUint16(6, subFormat, true);
  // remainder of KSDATAFORMAT_SUBTYPE GUID
  extra.set(
    [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71],
    8,
  );
  return extra;
}

describe('encodeWav / decodeWav round trips', () => {
  it('32-bit float is exact and preserves sample rate and channels', () => {
    const pcm = sinePcm(44100, 2, 1000);
    pcm.channels[0]![10] = 1.5; // out-of-range values survive float encoding
    const decoded = decodeWav(encodeWav(pcm, { bitDepth: 32 }));
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels).toHaveLength(2);
    expect(maxError(pcm, decoded)).toBe(0);
  });

  it('16-bit is within half an LSB', () => {
    const pcm = sinePcm(48000, 2, 2048);
    const decoded = decodeWav(encodeWav(pcm, { bitDepth: 16 }));
    expect(maxError(pcm, decoded)).toBeLessThanOrEqual(0.5 / 32768 + 1e-9);
  });

  it('24-bit is within half an LSB', () => {
    const pcm = sinePcm(96000, 1, 2048);
    const decoded = decodeWav(encodeWav(pcm, { bitDepth: 24 }));
    expect(decoded.sampleRate).toBe(96000);
    expect(maxError(pcm, decoded)).toBeLessThanOrEqual(0.5 / 8388608 + 1e-9);
  });

  it('round-trips arbitrary audio within quantization (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 3 }),
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 0, maxLength: 64 }),
        fc.constantFrom<16 | 24 | 32>(16, 24, 32),
        (channelCount, samples, bitDepth) => {
          const pcm: PcmAudio = {
            sampleRate: 22050,
            channels: Array.from({ length: channelCount }, () => Float32Array.from(samples)),
          };
          const decoded = decodeWav(encodeWav(pcm, { bitDepth }));
          const lsb = bitDepth === 16 ? 1 / 32768 : bitDepth === 24 ? 1 / 8388608 : 0;
          // +1.0 clamps to the largest positive code: one LSB of error.
          expect(maxError(pcm, decoded)).toBeLessThanOrEqual(lsb + 1e-9);
          expect(decoded.channels[0]!.length).toBe(samples.length);
        },
      ),
    );
  });

  it('clamps out-of-range integers and maps NaN to silence', () => {
    const pcm: PcmAudio = { sampleRate: 8000, channels: [Float32Array.from([2, -2, Number.NaN])] };
    const decoded = decodeWav(encodeWav(pcm, { bitDepth: 16 }));
    expect(Array.from(decoded.channels[0]!)).toEqual([32767 / 32768, -1, 0]);
  });

  it('writes odd-length data with a pad byte and a valid RIFF size', () => {
    const pcm: PcmAudio = { sampleRate: 8000, channels: [new Float32Array(3)] };
    const bytes = encodeWav(pcm, { bitDepth: 24 });
    expect(bytes.length % 2).toBe(0);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(decodeWav(bytes).channels[0]).toHaveLength(3);
  });

  it('rejects invalid encoder input', () => {
    expect(() => encodeWav({ sampleRate: 8000, channels: [] }, { bitDepth: 16 })).toThrow(
      /no channels/,
    );
    expect(() =>
      encodeWav(
        { sampleRate: 8000, channels: [new Float32Array(2), new Float32Array(3)] },
        { bitDepth: 16 },
      ),
    ).toThrow(/different lengths/);
    expect(() =>
      encodeWav({ sampleRate: 0, channels: [new Float32Array(2)] }, { bitDepth: 16 }),
    ).toThrow(/sample rate/);
    expect(() =>
      encodeWav(
        { sampleRate: 8000, channels: [new Float32Array(2)] },
        { bitDepth: 8 as unknown as 16 },
      ),
    ).toThrow(/bit depth/);
  });
});

describe('TPDF dither', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const pcm = sinePcm(48000, 1, 512);
    const a = encodeWav(pcm, { bitDepth: 16, dither: 'tpdf', seed: 7 });
    const b = encodeWav(pcm, { bitDepth: 16, dither: 'tpdf', seed: 7 });
    const c = encodeWav(pcm, { bitDepth: 16, dither: 'tpdf', seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('has zero mean, triangular spread and stays within ±1 LSB of the signal', () => {
    const frames = 200_000;
    const silence: PcmAudio = { sampleRate: 48000, channels: [new Float32Array(frames)] };
    const decoded = decodeWav(encodeWav(silence, { bitDepth: 16, dither: 'tpdf', seed: 42 }));
    const codes = Array.from(decoded.channels[0]!, (v) => Math.round(v * 32768));
    const mean = codes.reduce((s, v) => s + v, 0) / frames;
    const variance = codes.reduce((s, v) => s + (v - mean) ** 2, 0) / frames;
    expect(codes.reduce((m, v) => Math.min(m, v), 0)).toBeGreaterThanOrEqual(-1);
    expect(codes.reduce((m, v) => Math.max(m, v), 0)).toBeLessThanOrEqual(1);
    expect(Math.abs(mean)).toBeLessThan(0.01);
    // P(|d| > 0.5) = 1/4 for a triangular variable on (-1, 1) → variance of codes = 0.25.
    expect(variance).toBeGreaterThan(0.23);
    expect(variance).toBeLessThan(0.27);
  });

  it('removes quantization bias for sub-LSB signals', () => {
    const frames = 100_000;
    const level = 0.3 / 32768;
    const dc: PcmAudio = { sampleRate: 48000, channels: [new Float32Array(frames).fill(level)] };
    const plain = decodeWav(encodeWav(dc, { bitDepth: 16 }));
    const dithered = decodeWav(encodeWav(dc, { bitDepth: 16, dither: 'tpdf', seed: 3 }));
    const mean = (pcm: PcmAudio) => pcm.channels[0]!.reduce((s, v) => s + v, 0) / frames;
    expect(mean(plain)).toBe(0); // truncated away without dither
    expect(Math.abs(mean(dithered) - level) / level).toBeLessThan(0.05);
  });

  it('applies to 24-bit and is ignored for float', () => {
    const pcm = sinePcm(48000, 1, 256);
    const d24 = decodeWav(encodeWav(pcm, { bitDepth: 24, dither: 'tpdf', seed: 1 }));
    expect(maxError(pcm, d24)).toBeLessThanOrEqual(1.5 / 8388608);
    expect(encodeWav(pcm, { bitDepth: 32, dither: 'tpdf' })).toEqual(
      encodeWav(pcm, { bitDepth: 32 }),
    );
  });
});

describe('decodeWav with hand-built headers', () => {
  it('decodes WAVE_FORMAT_EXTENSIBLE 24-bit PCM and skips unknown odd-sized chunks', () => {
    const data = new Uint8Array(12); // 2 frames × 2 channels × 3 bytes
    const v = new DataView(data.buffer);
    const write24 = (offset: number, n: number) => {
      v.setUint8(offset, n & 0xff);
      v.setUint8(offset + 1, (n >> 8) & 0xff);
      v.setUint8(offset + 2, (n >> 16) & 0xff);
    };
    write24(0, 4194304); // +0.5
    write24(3, -4194304 & 0xffffff); // -0.5
    write24(6, 8388607);
    write24(9, -8388608 & 0xffffff);
    const bytes = buildWav([
      { id: 'JUNK', body: new Uint8Array(3) }, // odd size → pad byte
      { id: 'fmt ', body: fmtBody(0xfffe, 2, 44100, 24, extensibleExtra(1, 24)) },
      { id: 'LIST', body: new Uint8Array(5).fill(7) },
      { id: 'data', body: data },
    ]);
    const pcm = decodeWav(bytes);
    expect(pcm.sampleRate).toBe(44100);
    expect(Array.from(pcm.channels[0]!)).toEqual([0.5, 8388607 / 8388608]);
    expect(Array.from(pcm.channels[1]!)).toEqual([-0.5, -1]);
  });

  it('decodes extensible float32 and plain float64', () => {
    const f32 = new Uint8Array(8);
    new DataView(f32.buffer).setFloat32(0, 0.25, true);
    new DataView(f32.buffer).setFloat32(4, -0.75, true);
    const ext = decodeWav(
      buildWav([
        { id: 'fmt ', body: fmtBody(0xfffe, 1, 32000, 32, extensibleExtra(3, 32)) },
        { id: 'data', body: f32 },
      ]),
    );
    expect(Array.from(ext.channels[0]!)).toEqual([0.25, -0.75]);

    const f64 = new Uint8Array(16);
    new DataView(f64.buffer).setFloat64(0, 0.125, true);
    new DataView(f64.buffer).setFloat64(8, -1, true);
    const plain = decodeWav(
      buildWav([
        { id: 'fmt ', body: fmtBody(3, 1, 48000, 64) },
        { id: 'data', body: f64 },
      ]),
    );
    expect(Array.from(plain.channels[0]!)).toEqual([0.125, -1]);
  });

  it('decodes unsigned 8-bit and signed 32-bit integer PCM', () => {
    const u8 = decodeWav(
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 1, 8000, 8) },
        { id: 'data', body: Uint8Array.from([128, 255, 0]) },
      ]),
    );
    expect(Array.from(u8.channels[0]!)).toEqual([0, 127 / 128, -1]);

    const i32 = new Uint8Array(8);
    new DataView(i32.buffer).setInt32(0, 1073741824, true);
    new DataView(i32.buffer).setInt32(4, -2147483648, true);
    const pcm = decodeWav(
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 1, 8000, 32) },
        { id: 'data', body: i32 },
      ]),
    );
    expect(Array.from(pcm.channels[0]!)).toEqual([0.5, -1]);
  });

  it('clamps a data chunk whose declared size exceeds the file', () => {
    const pcm = decodeWav(
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 1, 8000, 16) },
        { id: 'data', body: new Uint8Array(6), declaredSize: 0xffffffff },
      ]),
    );
    expect(pcm.channels[0]).toHaveLength(3);
  });

  it('accepts a subarray view with a byte offset', () => {
    const wav = encodeWav(sinePcm(8000, 1, 10), { bitDepth: 16 });
    const padded = new Uint8Array(wav.length + 5);
    padded.set(wav, 5);
    expect(decodeWav(padded.subarray(5)).channels[0]).toHaveLength(10);
  });

  it.each([
    ['too short', Uint8Array.from([1, 2, 3]), /too short/],
    ['not RIFF', new Uint8Array(44), /not a RIFF\/WAVE/],
    ['missing fmt', buildWav([{ id: 'LIST', body: new Uint8Array(4) }]), /missing fmt/],
    ['missing data', buildWav([{ id: 'fmt ', body: fmtBody(1, 1, 8000, 16) }]), /missing data/],
    ['data before fmt', buildWav([{ id: 'data', body: new Uint8Array(4) }]), /before fmt/],
    ['truncated fmt', buildWav([{ id: 'fmt ', body: new Uint8Array(10) }]), /truncated fmt/],
    [
      'truncated extensible',
      buildWav([{ id: 'fmt ', body: fmtBody(0xfffe, 1, 8000, 16) }]),
      /truncated WAVE_FORMAT_EXTENSIBLE/,
    ],
    [
      'zero channels',
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 0, 8000, 16) },
        { id: 'data', body: new Uint8Array(4) },
      ]),
      /zero channels/,
    ],
    [
      'zero sample rate',
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 1, 0, 16) },
        { id: 'data', body: new Uint8Array(4) },
      ]),
      /zero sample rate/,
    ],
    [
      'ADPCM',
      buildWav([
        { id: 'fmt ', body: fmtBody(2, 1, 8000, 4) },
        { id: 'data', body: new Uint8Array(4) },
      ]),
      /unsupported format tag 0x2/,
    ],
    [
      '12-bit int',
      buildWav([
        { id: 'fmt ', body: fmtBody(1, 1, 8000, 12) },
        { id: 'data', body: new Uint8Array(4) },
      ]),
      /unsupported integer bit depth 12/,
    ],
    [
      '16-bit float',
      buildWav([
        { id: 'fmt ', body: fmtBody(3, 1, 8000, 16) },
        { id: 'data', body: new Uint8Array(4) },
      ]),
      /unsupported float bit depth 16/,
    ],
  ])('rejects %s', (_label, bytes, message) => {
    expect(() => decodeWav(bytes)).toThrow(message);
  });

  it('rejects a block align that contradicts channels × bit depth', () => {
    const fmt = fmtBody(1, 2, 8000, 16);
    new DataView(fmt.buffer).setUint16(12, 3, true);
    expect(() =>
      decodeWav(
        buildWav([
          { id: 'fmt ', body: fmt },
          { id: 'data', body: new Uint8Array(8) },
        ]),
      ),
    ).toThrow(/block align/);
  });

  it('never throws anything but descriptive Errors on random bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 80 }), (body) => {
        const bytes = new Uint8Array(12 + body.length);
        bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
        bytes.set(body, 12);
        try {
          const pcm = decodeWav(bytes);
          expect(pcm.channels.length).toBeGreaterThan(0);
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toMatch(/^decodeWav: /);
        }
      }),
    );
  });

  it('detects WAV magic', () => {
    expect(isWavBytes(encodeWav(sinePcm(8000, 1, 1), { bitDepth: 16 }))).toBe(true);
    expect(isWavBytes(new Uint8Array(4))).toBe(false);
    const random = createSeededRandom(1);
    expect(isWavBytes(Uint8Array.from({ length: 64 }, () => Math.floor(random() * 256)))).toBe(
      false,
    );
  });
});
