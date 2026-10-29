/**
 * Security probe page served instead of Studio when `STUDIO_ELECTRON_PROBE=1` (smoke tests
 * only). It exercises the host features Studio relies on — Blob-URL Workers and AudioWorklet
 * modules under the production CSP — without depending on the Studio packages, so the
 * Electron shell (protocol, CSP, preload, IPC, permissions) can be verified on its own.
 */

export interface ProbeResults {
  readonly blobWorker: boolean;
  readonly audioWorklet: boolean;
  readonly errors: readonly string[];
}

declare global {
  interface Window {
    studioProbe?: ProbeResults;
  }
}

function blobUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
}

async function probeBlobWorker(): Promise<boolean> {
  const url = blobUrl('self.onmessage = (e) => self.postMessage(e.data * 2);');
  const worker = new Worker(url);
  try {
    return await new Promise<boolean>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<number>) => resolve(event.data === 42);
      worker.onerror = (event) => reject(new Error(event.message || 'worker error'));
      worker.postMessage(21);
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

async function probeAudioWorklet(): Promise<boolean> {
  const context = new OfflineAudioContext(1, 128, 48000);
  const url = blobUrl(
    "registerProcessor('probe', class extends AudioWorkletProcessor { process() { return false; } });",
  );
  try {
    await context.audioWorklet.addModule(url);
    new AudioWorkletNode(context, 'probe');
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function run(): Promise<void> {
  const errors: string[] = [];
  const attempt = async (name: string, fn: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await fn();
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const blobWorker = await attempt('blobWorker', probeBlobWorker);
  const audioWorklet = await attempt('audioWorklet', probeAudioWorklet);
  window.studioProbe = { blobWorker, audioWorklet, errors };
  document.getElementById('probe')?.setAttribute('data-probe-status', 'ready');
}

void run();
