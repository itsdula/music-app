/**
 * RIFF/WAVE encoder and decoder.
 *
 * Encoder: 16/24-bit integer PCM (format tag 1, optional seeded TPDF dither) or 32-bit
 * IEEE float (format tag 3 with `cbSize = 0` and a `fact` chunk). Little-endian, planar
 * input, interleaved output.
 *
 * Decoder: integer PCM 8 (unsigned) / 16 / 24 / 32-bit, IEEE float 32 / 64-bit, and
 * WAVE_FORMAT_EXTENSIBLE (0xFFFE) wrapping either. Unknown chunks are skipped, honouring
 * the RIFF rule that odd-sized chunks are followed by one pad byte.
 *
 * Integer scaling is symmetric: encode `round(x · 2^(b-1))` clamped to
 * [-2^(b-1), 2^(b-1) - 1]; decode `n / 2^(b-1)`. A round trip therefore errs by at most
 * half an LSB (one LSB at exactly +1.0, which clamps), plus the dither amplitude.
 */
import { createSeededRandom } from './random';
import { type PcmAudio } from './pcm';

export type WavBitDepth = 16 | 24 | 32;

export interface WavEncodeOptions {
  /** 16/24 = integer PCM, 32 = IEEE float. */
  readonly bitDepth: WavBitDepth;
  /** Integer formats only; ignored for 32-bit float. Default 'none'. */
  readonly dither?: 'tpdf' | 'none';
  /** Dither noise seed (default 0x5eed); identical seeds give identical bytes. */
  readonly seed?: number;
}

const WAVE_FORMAT_PCM = 0x0001;
const WAVE_FORMAT_IEEE_FLOAT = 0x0003;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;
const DEFAULT_DITHER_SEED = 0x5eed;

/**
 * Encodes planar PCM as a WAV file.
 *
 * - Units: samples nominally in [-1, 1]; integer formats clamp out-of-range values,
 *   float keeps them. `pcm.sampleRate` is written verbatim.
 * - Dither: TPDF (sum of two independent uniform variables, ±1 LSB peak, variance 1/6
 *   LSB²) drawn from `createSeededRandom(seed)` in interleaved sample order, so output
 *   bytes are fully deterministic for a given input and seed.
 * - Ownership: reads `pcm`; returns a newly allocated buffer owned by the caller.
 * - Complexity: O(channels · frames). Throws if channels have different lengths, there
 *   are no channels, or the data would exceed the 4 GiB RIFF limit.
 */
export function encodeWav(pcm: PcmAudio, options: WavEncodeOptions): Uint8Array<ArrayBuffer> {
  const channelCount = pcm.channels.length;
  if (channelCount === 0) throw new Error('encodeWav: PCM has no channels');
  const frames = pcm.channels[0]!.length;
  for (const channel of pcm.channels) {
    if (channel.length !== frames) throw new Error('encodeWav: channels have different lengths');
  }
  if (!Number.isInteger(pcm.sampleRate) || pcm.sampleRate <= 0) {
    throw new Error(`encodeWav: invalid sample rate ${pcm.sampleRate}`);
  }
  const { bitDepth } = options;
  if (bitDepth !== 16 && bitDepth !== 24 && bitDepth !== 32) {
    throw new Error(`encodeWav: unsupported bit depth ${String(bitDepth)}`);
  }
  const isFloat = bitDepth === 32;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = bytesPerSample * channelCount;
  const dataBytes = frames * blockAlign;
  const fmtChunkBytes = isFloat ? 18 : 16;
  const factChunkBytes = isFloat ? 12 : 0;
  const headerBytes = 12 + 8 + fmtChunkBytes + factChunkBytes + 8;
  const padByte = dataBytes % 2;
  const totalBytes = headerBytes + dataBytes + padByte;
  if (totalBytes - 8 > 0xffffffff) throw new Error('encodeWav: data exceeds the 4 GiB RIFF limit');

  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  let p = 0;
  const ascii = (text: string) => {
    for (let i = 0; i < text.length; i++) bytes[p++] = text.charCodeAt(i);
  };
  ascii('RIFF');
  view.setUint32(p, totalBytes - 8, true);
  p += 4;
  ascii('WAVE');
  ascii('fmt ');
  view.setUint32(p, fmtChunkBytes, true);
  p += 4;
  view.setUint16(p, isFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM, true);
  view.setUint16(p + 2, channelCount, true);
  view.setUint32(p + 4, pcm.sampleRate, true);
  view.setUint32(p + 8, pcm.sampleRate * blockAlign, true);
  view.setUint16(p + 12, blockAlign, true);
  view.setUint16(p + 14, bitDepth, true);
  p += 16;
  if (isFloat) {
    view.setUint16(p, 0, true); // cbSize
    p += 2;
    ascii('fact');
    view.setUint32(p, 4, true);
    view.setUint32(p + 4, frames, true);
    p += 8;
  }
  ascii('data');
  view.setUint32(p, dataBytes, true);
  p += 4;

  const channels = pcm.channels;
  if (isFloat) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channelCount; c++) {
        view.setFloat32(p, channels[c]![i]!, true);
        p += 4;
      }
    }
    return bytes;
  }

  const scale = bitDepth === 16 ? 32768 : 8388608;
  const max = scale - 1;
  const min = -scale;
  const random =
    options.dither === 'tpdf' ? createSeededRandom(options.seed ?? DEFAULT_DITHER_SEED) : null;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      let x = channels[c]![i]! * scale;
      if (x !== x) x = 0; // NaN -> silence
      if (random) x += random() - random();
      let n = Math.round(x);
      if (n > max) n = max;
      else if (n < min) n = min;
      if (bitDepth === 16) {
        view.setInt16(p, n, true);
        p += 2;
      } else {
        bytes[p] = n & 0xff;
        bytes[p + 1] = (n >> 8) & 0xff;
        bytes[p + 2] = (n >> 16) & 0xff;
        p += 3;
      }
    }
  }
  return bytes;
}

interface WavFormat {
  readonly formatTag: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly blockAlign: number;
  readonly bitsPerSample: number;
}

function readAscii(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Decodes a WAV file to planar float PCM at the file's native sample rate.
 *
 * - Supported: PCM 8/16/24/32-bit integer, IEEE float 32/64-bit, and
 *   WAVE_FORMAT_EXTENSIBLE with a PCM or float sub-format.
 * - Chunks other than `fmt ` and `data` are skipped (odd sizes are padded). A `data`
 *   chunk whose declared size exceeds the file (streaming writers, truncated copies) is
 *   clamped to the whole frames actually present.
 * - Errors (thrown `Error` with a descriptive message): not RIFF/WAVE, truncated header,
 *   missing `fmt ` or `data`, `data` before `fmt `, zero channels or sample rate,
 *   inconsistent block alignment, unsupported format tag or bit depth.
 * - Ownership: reads `bytes`; returns newly allocated channel arrays.
 * - Complexity: O(file size).
 */
export function decodeWav(bytes: Uint8Array): PcmAudio {
  if (bytes.byteLength < 12) throw new Error('decodeWav: file too short to be a WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0) !== 'RIFF' || readAscii(view, 8) !== 'WAVE') {
    throw new Error('decodeWav: not a RIFF/WAVE file');
  }
  let format: WavFormat | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > bytes.byteLength) {
        throw new Error('decodeWav: truncated fmt chunk');
      }
      let formatTag = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (formatTag === WAVE_FORMAT_EXTENSIBLE) {
        if (size < 40 || body + 40 > bytes.byteLength) {
          throw new Error('decodeWav: truncated WAVE_FORMAT_EXTENSIBLE fmt chunk');
        }
        // SubFormat GUID starts at byte 24 of the fmt body; its first two bytes are the tag.
        formatTag = view.getUint16(body + 24, true);
      }
      format = { formatTag, channels, sampleRate, blockAlign, bitsPerSample };
    } else if (id === 'data') {
      if (!format) throw new Error('decodeWav: data chunk appears before fmt chunk');
      const available = Math.min(size, bytes.byteLength - body);
      return decodeSamples(view, body, available, format);
    }
    offset = body + size + (size % 2);
  }
  if (!format) throw new Error('decodeWav: missing fmt chunk');
  throw new Error('decodeWav: missing data chunk');
}

function decodeSamples(view: DataView, start: number, byteLength: number, f: WavFormat): PcmAudio {
  if (f.channels === 0) throw new Error('decodeWav: zero channels');
  if (f.sampleRate === 0) throw new Error('decodeWav: zero sample rate');
  const isFloat = f.formatTag === WAVE_FORMAT_IEEE_FLOAT;
  const isPcm = f.formatTag === WAVE_FORMAT_PCM;
  if (!isFloat && !isPcm) {
    throw new Error(`decodeWav: unsupported format tag 0x${f.formatTag.toString(16)}`);
  }
  if (isPcm && ![8, 16, 24, 32].includes(f.bitsPerSample)) {
    throw new Error(`decodeWav: unsupported integer bit depth ${f.bitsPerSample}`);
  }
  if (isFloat && f.bitsPerSample !== 32 && f.bitsPerSample !== 64) {
    throw new Error(`decodeWav: unsupported float bit depth ${f.bitsPerSample}`);
  }
  const bytesPerSample = f.bitsPerSample / 8;
  if (f.blockAlign !== bytesPerSample * f.channels) {
    throw new Error(
      `decodeWav: block align ${f.blockAlign} does not match ${f.channels} × ${f.bitsPerSample}-bit`,
    );
  }
  const frames = Math.floor(byteLength / f.blockAlign);
  const channels = Array.from({ length: f.channels }, () => new Float32Array(frames));
  let p = start;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < f.channels; c++) {
      let v: number;
      if (isFloat) {
        v = f.bitsPerSample === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      } else if (f.bitsPerSample === 16) {
        v = view.getInt16(p, true) / 32768;
      } else if (f.bitsPerSample === 24) {
        const n = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16);
        v = n / 8388608;
      } else if (f.bitsPerSample === 32) {
        v = view.getInt32(p, true) / 2147483648;
      } else {
        v = (view.getUint8(p) - 128) / 128;
      }
      channels[c]![i] = v;
      p += bytesPerSample;
    }
  }
  return { sampleRate: f.sampleRate, channels };
}

/** True when `bytes` start with a RIFF/WAVE header. Complexity O(1). */
export function isWavBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const tag = (offset: number) =>
    String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
  return tag(0) === 'RIFF' && tag(8) === 'WAVE';
}
