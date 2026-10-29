/**
 * Browser file dialogs: File System Access API when available (Chromium), otherwise an
 * <input type="file"> for opening and an <a download> for saving.
 */
import type {
  FileDialogs,
  OpenFileOptions,
  PickedFile,
  SaveFileOptions,
} from '@studio/platform-contracts';

interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FileSystemAccessWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: FilePickerAcceptType[];
  }) => Promise<{
    createWritable(): Promise<{
      write(data: BufferSource | Blob): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
}

async function readFile(file: File): Promise<PickedFile> {
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    mimeType: file.type || guessMime(file.name),
    bytes: new Uint8Array(buffer),
  };
}

export function guessMime(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    wav: 'audio/wav',
    wave: 'audio/wav',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    flac: 'audio/flac',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    json: 'application/json',
    studio: 'application/x-studio-bundle',
    zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function createBrowserFileDialogs(doc: Document = document): FileDialogs {
  return {
    openFiles(options: OpenFileOptions): Promise<PickedFile[]> {
      return new Promise((resolve, reject) => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = options.accept.join(',');
        input.multiple = options.multiple;
        input.style.display = 'none';
        let settled = false;
        const finish = (files: File[]) => {
          if (settled) return;
          settled = true;
          input.remove();
          Promise.all(files.map(readFile)).then(resolve, reject);
        };
        input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
        input.addEventListener('cancel', () => finish([]));
        doc.body.appendChild(input);
        input.click();
      });
    },

    async saveFile(bytes: Uint8Array, options: SaveFileOptions): Promise<boolean> {
      const fsWindow = doc.defaultView as (Window & FileSystemAccessWindow) | null;
      const copy = bytes.slice();
      if (fsWindow?.showSaveFilePicker) {
        try {
          const ext = options.suggestedName.includes('.')
            ? `.${options.suggestedName.split('.').pop()}`
            : '';
          const handle = await fsWindow.showSaveFilePicker({
            suggestedName: options.suggestedName,
            ...(ext
              ? {
                  types: [{ description: options.mimeType, accept: { [options.mimeType]: [ext] } }],
                }
              : {}),
          });
          const writable = await handle.createWritable();
          await writable.write(copy);
          await writable.close();
          return true;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return false;
          // Fall through to the download fallback (e.g. picker blocked in iframes).
        }
      }
      const blob = new Blob([copy], { type: options.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = doc.createElement('a');
      anchor.href = url;
      anchor.download = options.suggestedName;
      anchor.style.display = 'none';
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    },
  };
}
