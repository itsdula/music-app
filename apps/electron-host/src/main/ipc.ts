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
import {
  extensionOf,
  isAcceptedFile,
  mimeTypeForName,
  sanitizeFileName,
  validateOpenFilesArgs,
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

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.saveFile, handleSaveFile);
  ipcMain.handle(IPC_CHANNELS.openFiles, handleOpenFiles);
}
