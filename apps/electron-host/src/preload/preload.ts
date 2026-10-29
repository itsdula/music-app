/**
 * Sandboxed preload (bundled to CommonJS). Exposes exactly `window.studioHost`; never
 * `ipcRenderer`, never Node built-ins. Arguments are type-checked here for early, clear
 * errors and validated again in the main process, which is the real trust boundary.
 */
import { contextBridge, ipcRenderer } from 'electron';
import {
  HOST_GLOBAL,
  IPC_CHANNELS,
  type HostPickedFile,
  type StudioHostApi,
} from '../shared/host-api';

const api: StudioHostApi = {
  saveFile(bytes: Uint8Array, suggestedName: string, mimeType: string): Promise<boolean> {
    if (!(bytes instanceof Uint8Array)) {
      return Promise.reject(new TypeError('saveFile: bytes must be a Uint8Array'));
    }
    return ipcRenderer.invoke(
      IPC_CHANNELS.saveFile,
      bytes,
      suggestedName,
      mimeType,
    ) as Promise<boolean>;
  },
  openFiles(accept: string[], multiple: boolean): Promise<HostPickedFile[]> {
    if (!Array.isArray(accept)) {
      return Promise.reject(new TypeError('openFiles: accept must be an array'));
    }
    return ipcRenderer.invoke(IPC_CHANNELS.openFiles, [...accept], multiple) as Promise<
      HostPickedFile[]
    >;
  },
  platform: Object.freeze({
    os: process.platform,
    versions: Object.freeze({
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
    }),
  }),
};

contextBridge.exposeInMainWorld(HOST_GLOBAL, Object.freeze(api));
