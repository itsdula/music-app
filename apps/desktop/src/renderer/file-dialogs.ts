/**
 * `FileDialogs` adapter over the preload bridge. Structurally typed (no import from
 * platform-contracts, which apps may not depend on); `main.tsx` assigns it to
 * `PlatformServices['fileDialogs']`, so the compiler checks it against the real contract.
 */
import type { HostPickedFile, StudioHostApi } from '../shared/host-api';

export interface ElectronFileDialogs {
  openFiles(options: {
    readonly accept: readonly string[];
    readonly multiple: boolean;
  }): Promise<HostPickedFile[]>;
  saveFile(
    bytes: Uint8Array,
    options: { readonly suggestedName: string; readonly mimeType: string },
  ): Promise<boolean>;
}

export function createElectronFileDialogs(
  host: Pick<StudioHostApi, 'openFiles' | 'saveFile'>,
): ElectronFileDialogs {
  return {
    async openFiles(options) {
      const files = await host.openFiles([...options.accept], options.multiple);
      return files.map((file) => ({ name: file.name, mimeType: file.mimeType, bytes: file.bytes }));
    },
    saveFile(bytes, options) {
      return host.saveFile(bytes, options.suggestedName, options.mimeType);
    },
  };
}
