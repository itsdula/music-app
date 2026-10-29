import type { EngineError, EngineErrorCode, EngineLogger } from '@studio/audio-contracts';

/** Error thrown by engine methods; also carried by `error` events. */
export class AudioEngineError extends Error implements EngineError {
  readonly code: EngineErrorCode;
  readonly detail?: string;

  constructor(code: EngineErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AudioEngineError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }

  toEngineError(): EngineError {
    return this.detail !== undefined
      ? { code: this.code, message: this.message, detail: this.detail }
      : { code: this.code, message: this.message };
  }
}

/** Maps a getUserMedia rejection to the contract's error codes. */
export function microphoneError(error: unknown): AudioEngineError {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new AudioEngineError('microphone-denied', 'Microphone access was denied', message);
  }
  return new AudioEngineError(
    'microphone-unavailable',
    'No usable microphone input',
    `${name}: ${message}`,
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/** Logger used when the host injects none (the package never writes to the console). */
export const SILENT_LOGGER: EngineLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
