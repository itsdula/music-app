/**
 * Audio file decoding for imports.
 */
import { decodeWav, isWavBytes, type PcmAudio } from '@studio/audio-dsp';
import { audioBufferToPcm } from './assets';
import { AudioEngineError, describeError } from './errors';

/** Sample rate used for formats decoded by the browser (decodeAudioData resamples). */
export const BROWSER_DECODE_SAMPLE_RATE = 48000;

function looksLikeWav(bytes: Uint8Array, hint: { mimeType: string; fileName: string }): boolean {
  if (isWavBytes(bytes)) return true;
  const mime = hint.mimeType.toLowerCase();
  return (
    mime === 'audio/wav' ||
    mime === 'audio/x-wav' ||
    mime === 'audio/wave' ||
    /\.wav$/i.test(hint.fileName)
  );
}

/**
 * Decodes an audio file to planar PCM.
 *
 * - WAV (detected by RIFF/WAVE magic, MIME type or extension) is parsed by
 *   `decodeWav`, preserving the file's native sample rate and exact sample values.
 *   WAV encodings `decodeWav` does not support (e.g. ADPCM) fall back to the browser.
 * - Everything else (MP3, AAC/M4A, Ogg Vorbis/Opus, FLAC — whatever the browser
 *   supports) is decoded with `decodeAudioData` on an OfflineAudioContext at 48 kHz.
 *   Browsers always resample decoded audio to the context rate, so such assets are
 *   stored at 48 kHz regardless of the file's own rate (the resampler is the browser's;
 *   quality is implementation-defined but transparent in practice).
 * - Errors are thrown as `AudioEngineError('asset-decode-failed')`.
 * - Ownership: `bytes` is copied before handing it to the browser decoder (which
 *   detaches its input), so the caller's buffer stays usable.
 */
export async function decodeAudioBytes(
  bytes: Uint8Array,
  hint: { mimeType: string; fileName: string },
): Promise<PcmAudio> {
  let wavError: unknown = null;
  if (looksLikeWav(bytes, hint)) {
    try {
      return decodeWav(bytes);
    } catch (error) {
      wavError = error;
    }
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new AudioEngineError(
      'asset-decode-failed',
      `Cannot decode ${hint.fileName}`,
      wavError ? describeError(wavError) : 'OfflineAudioContext is unavailable',
    );
  }
  try {
    const ctx = new OfflineAudioContext(1, 1, BROWSER_DECODE_SAMPLE_RATE);
    const copy = bytes.slice().buffer;
    const buffer = await ctx.decodeAudioData(copy);
    return audioBufferToPcm(buffer);
  } catch (error) {
    const detail = wavError
      ? `${describeError(wavError)}; browser: ${describeError(error)}`
      : describeError(error);
    throw new AudioEngineError('asset-decode-failed', `Cannot decode ${hint.fileName}`, detail);
  }
}
