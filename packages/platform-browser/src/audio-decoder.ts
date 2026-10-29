import { decodeAudioBytes } from '@studio/audio-web';
import type { AudioDecoder } from '@studio/platform-contracts';
import { guessMime } from './files';

const DECODABLE = /^(audio\/|video\/(mp4|webm|ogg))/;
const EXTENSIONS = /\.(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|webm|aif|aiff)$/i;

/** WAV decoded in JS at its native rate; other formats via the browser's decodeAudioData. */
export function createBrowserAudioDecoder(): AudioDecoder {
  return {
    canDecode(mimeType, fileName) {
      return DECODABLE.test(mimeType || guessMime(fileName)) || EXTENSIONS.test(fileName);
    },
    decode(bytes, hint) {
      return decodeAudioBytes(bytes, { mimeType: hint.mimeType || guessMime(hint.fileName), fileName: hint.fileName });
    },
  };
}
