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

/**
 * UI preferences (theme, keymap overrides, layout, toggles) kept by the main process in
 * `<userData>/preferences.json`. The renderer loads them once and then mirrors its writes
 * (`createBridgedKeyValueStore` in @studio/platform-browser).
 */
export interface HostPreferencesApi {
  /** Every stored entry. */
  load(): Promise<Record<string, string>>;
  /** Rejects when the key or value breaks the limits below. */
  set(key: string, value: string): Promise<void>;
  /** A no-op when the key is absent. */
  delete(key: string): Promise<void>;
}

/** The complete surface exposed to the renderer via `contextBridge`. Keep it minimal. */
export interface StudioHostApi {
  /** Shows a native save dialog and writes `bytes`. Resolves `false` when cancelled. */
  saveFile(bytes: Uint8Array, suggestedName: string, mimeType: string): Promise<boolean>;
  /** Shows a native open dialog filtered by `accept` (MIME types or `.ext`). Empty when cancelled. */
  openFiles(accept: string[], multiple: boolean): Promise<HostPickedFile[]>;
  readonly platform: HostPlatformInfo;
  readonly preferences: HostPreferencesApi;
}

export const HOST_GLOBAL = 'studioHost';

export const IPC_CHANNELS = {
  saveFile: 'studio-host:save-file',
  openFiles: 'studio-host:open-files',
  preferencesLoad: 'studio-host:preferences-load',
  preferencesSet: 'studio-host:preferences-set',
  preferencesDelete: 'studio-host:preferences-delete',
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

// Preference limits. They mirror PREFERENCE_KEY_PATTERN and PREFERENCE_LIMITS in
// @studio/project-storage, which apps cannot import; the renderer store checks the same rules.
/** Keys: 1-128 characters of `A-Z a-z 0-9 _ . -`, starting with a letter or digit. */
export const PREFERENCE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** Largest single preference value, in UTF-8 bytes (64 KiB). */
export const MAX_PREFERENCE_VALUE_BYTES = 64 * 1024;
/** Largest total of all preference keys plus values, in UTF-8 bytes (1 MiB). */
export const MAX_PREFERENCES_TOTAL_BYTES = 1024 * 1024;
/** File in Electron's `userData` directory that holds the preferences. */
export const PREFERENCES_FILE_NAME = 'preferences.json';

declare global {
  interface Window {
    readonly studioHost?: StudioHostApi;
  }
}
