/**
 * Contract between the preload bridge (`window.studioHost`) and the renderer, plus the IPC
 * channel names shared with the main process. Pure types and constants only, so it can be
 * imported from main, preload, renderer and Node tests alike.
 */

/** A file read from disk by the main process after a native open dialog. */
export interface HostPickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface HostPlatformInfo {
  /** `process.platform` of the main process, e.g. `darwin`, `win32`, `linux`. */
  readonly os: string;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
  };
}

/** The complete surface exposed to the renderer via `contextBridge`. Keep it minimal. */
export interface StudioHostApi {
  /** Shows a native save dialog and writes `bytes`. Resolves `false` when cancelled. */
  saveFile(bytes: Uint8Array, suggestedName: string, mimeType: string): Promise<boolean>;
  /** Shows a native open dialog filtered by `accept` (MIME types or `.ext`). Empty when cancelled. */
  openFiles(accept: string[], multiple: boolean): Promise<HostPickedFile[]>;
  readonly platform: HostPlatformInfo;
}

export const HOST_GLOBAL = 'studioHost';

export const IPC_CHANNELS = {
  saveFile: 'studio-host:save-file',
  openFiles: 'studio-host:open-files',
} as const;

/** Custom privileged scheme the renderer is served from: `studio://app/`. */
export const APP_SCHEME = 'studio';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** Upper bound for a single file crossing IPC in either direction (2 GiB). */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
/** Upper bound for the combined size of one `openFiles` result. */
export const MAX_TOTAL_OPEN_BYTES = MAX_FILE_BYTES;
export const MAX_FILE_NAME_LENGTH = 255;
export const MAX_ACCEPT_ENTRIES = 64;
export const MAX_OPEN_FILES = 256;

declare global {
  interface Window {
    readonly studioHost?: StudioHostApi;
  }
}
