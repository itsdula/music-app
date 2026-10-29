/**
 * Web Worker entry for vocal analysis/rendering. Bundled into an inline string by
 * `pnpm codegen` (scripts/codegen.mjs) and started from a Blob URL.
 */
import { handleVocalWorkerRequest, type VocalWorkerRequest } from '@studio/vocal-dsp';

interface WorkerScope {
  onmessage: ((event: MessageEvent<VocalWorkerRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (event) => {
  handleVocalWorkerRequest(event.data, (response, transfer) => scope.postMessage(response, transfer ?? []));
};
