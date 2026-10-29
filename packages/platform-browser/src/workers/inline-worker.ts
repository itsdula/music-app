import type { VocalWorkerLike } from '@studio/vocal-dsp';

/** Starts a classic Worker from an inline source string; the Blob URL lives until terminate(). */
export function createInlineWorker(source: string, name: string): VocalWorkerLike {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url, { name });
  let handler: ((event: { data: unknown }) => void) | null = null;
  worker.onmessage = (event: MessageEvent) => handler?.({ data: event.data });
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer ?? []),
    get onmessage() {
      return handler;
    },
    set onmessage(next) {
      handler = next;
    },
    terminate: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
  };
}
