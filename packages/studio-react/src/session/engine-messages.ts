import type { EngineError } from '@studio/audio-contracts';

/** Turns engine error codes into actionable guidance for the notice bar (host-neutral wording). */
export function userFacingEngineMessage(error: EngineError): string {
  switch (error.code) {
    case 'microphone-denied':
      return 'Microphone access was denied. Allow the microphone for this site in your browser or system settings, then record again.';
    case 'microphone-unavailable':
      return 'No usable microphone was found. Connect an input device (or close other apps using it) and record again.';
    case 'context-unavailable':
      return 'Audio could not start in this browser. Use a current version of Chrome, Edge or Firefox.';
    case 'worklet-failed':
      return 'Part of the audio engine failed to load, so recording and meters are unavailable. Reload the page to retry.';
    default:
      return error.message;
  }
}
