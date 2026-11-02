/**
 * IPC handlers behind `window.studioHost`. Every call checks the sender frame (main frame
 * of the app origin) and validates every argument before touching dialogs or the disk.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type FileFilter,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import {
  IPC_CHANNELS,
  MAX_FILE_BYTES,
  MAX_OPEN_FILES,
  MAX_TOTAL_OPEN_BYTES,
  type HostPickedFile,
} from '../shared/host-api';
import { isAppOrigin } from './policy';
import type { PreferencesStore } from './preferences-store';
import {
  extensionOf,
  isAcceptedFile,
  mimeTypeForName,
  sanitizeFileName,
  validateOpenFilesArgs,
  validatePreferenceDeleteArgs,
  validatePreferenceSetArgs,
  validatePreferencesLoadArgs,
  validateSaveFileArgs,
} from './validation';

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null || !isAppOrigin(frame.url)) {
    throw new Error('studioHost: call rejected (untrusted sender)');
  }
}

function ownerWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

/** A Uint8Array that owns exactly its bytes, so structured clone copies nothing extra. */
function exactBytes(buffer: Buffer): Uint8Array {
  const exact = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength;
  return exact ? new Uint8Array(buffer.buffer, 0, buffer.byteLength) : new Uint8Array(buffer);
}

async function handleSaveFile(event: IpcMainInvokeEvent, ...args: unknown[]): Promise<boolean> {
  assertTrustedSender(event);
  const parsed = validateSaveFileArgs(args);
  if (!parsed.ok) throw new Error(`studioHost.saveFile: ${parsed.error}`);
  const { bytes, suggestedName, mimeType } = parsed.value;
  const ext = extensionOf(suggestedName);
  const filters: FileFilter[] = ext
    ? [
        { name: mimeType, extensions: [ext] },
        { name: 'All files', extensions: ['*'] },
      ]
    : [];
  const options: SaveDialogOptions = {
    defaultPath: join(app.getPath('documents'), suggestedName),
    filters,
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  };
  const win = ownerWindow(event);
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  await writeFile(result.filePath, bytes);
  return true;
}

async function handleOpenFiles(
  event: IpcMainInvokeEvent,
  ...args: unknown[]
): Promise<HostPickedFile[]> {
  assertTrustedSender(event);
  const parsed = validateOpenFilesArgs(args);
  if (!parsed.ok) throw new Error(`studioHost.openFiles: ${parsed.error}`);
  const { multiple, extensions } = parsed.value;
  const options: OpenDialogOptions = {
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: extensions ? [{ name: 'Supported files', extensions: [...extensions] }] : [],
  };
  const win = ownerWindow(event);
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled) return [];

  const paths = result.filePaths.slice(0, multiple ? MAX_OPEN_FILES : 1);
  const files: HostPickedFile[] = [];
  let total = 0;
  for (const filePath of paths) {
    if (!isAcceptedFile(filePath, extensions)) {
      console.warn(`studioHost.openFiles: skipped ${basename(filePath)} (type not accepted)`);
      continue;
    }
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(`studioHost.openFiles: ${basename(filePath)} exceeds the 2 GiB limit`);
    }
    total += info.size;
    if (total > MAX_TOTAL_OPEN_BYTES) {
      throw new Error('studioHost.openFiles: selection exceeds the 2 GiB limit');
    }
    const name = sanitizeFileName(basename(filePath));
    files.push({
      name,
      mimeType: mimeTypeForName(name),
      bytes: exactBytes(await readFile(filePath)),
    });
  }
  return files;
}

/** `studioHost.preferences`: the renderer's mirror of the JSON file in `userData`. */
function preferenceHandlers(store: PreferencesStore) {
  return {
    load: (event: IpcMainInvokeEvent, ...args: unknown[]): Record<string, string> => {
      assertTrustedSender(event);
      const parsed = validatePreferencesLoadArgs(args);
      if (!parsed.ok) throw new Error(`studioHost.preferences.load: ${parsed.error}`);
      return store.entries();
    },
    set: (event: IpcMainInvokeEvent, ...args: unknown[]): void => {
      assertTrustedSender(event);
      const parsed = validatePreferenceSetArgs(args);
      if (!parsed.ok) throw new Error(`studioHost.preferences.set: ${parsed.error}`);
      // Throws when the total would exceed the limit; the renderer keeps its in-memory value.
      store.set(parsed.value.key, parsed.value.value);
    },
    delete: (event: IpcMainInvokeEvent, ...args: unknown[]): void => {
      assertTrustedSender(event);
      const parsed = validatePreferenceDeleteArgs(args);
      if (!parsed.ok) throw new Error(`studioHost.preferences.delete: ${parsed.error}`);
      store.delete(parsed.value);
    },
  };
}

export interface IpcHandlerOptions {
  /** Observes every rejected call (the error still reaches the renderer). Dev logging only. */
  readonly onError?: (channel: string, error: unknown) => void;
}

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export function registerIpcHandlers(
  preferences: PreferencesStore,
  options: IpcHandlerOptions = {},
): void {
  const { onError } = options;
  const handle = (channel: string, handler: IpcHandler) => {
    ipcMain.handle(
      channel,
      onError
        ? async (event, ...args: unknown[]) => {
            try {
              return await handler(event, ...args);
            } catch (error) {
              onError(channel, error);
              throw error;
            }
          }
        : handler,
    );
  };
  handle(IPC_CHANNELS.saveFile, handleSaveFile);
  handle(IPC_CHANNELS.openFiles, handleOpenFiles);
  const prefs = preferenceHandlers(preferences);
  handle(IPC_CHANNELS.preferencesLoad, prefs.load);
  handle(IPC_CHANNELS.preferencesSet, prefs.set);
  handle(IPC_CHANNELS.preferencesDelete, prefs.delete);
}
