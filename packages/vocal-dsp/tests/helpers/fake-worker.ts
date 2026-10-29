import {
  handleVocalWorkerRequest,
  type VocalWorkerLike,
  type VocalWorkerRequest,
} from '../../src/index';

export interface FakeWorkerOptions {
  /** Keep processing and posting after terminate() (simulates late, stale messages). */
  readonly ignoreTerminate?: boolean;
  /**
   * Deliver responses to the `onmessage` handler that was installed when the request was
   * posted (events already in flight when the host replaced or cleared the handler).
   */
  readonly captureHandlerAtPost?: boolean;
  /** Delay before the worker starts processing a request (ms). */
  readonly startDelayMs?: number;
  /** Replace the handler's responses (e.g. to inject malformed or foreign messages). */
  readonly rewrite?: (data: unknown) => unknown[];
}

/**
 * In-process stand-in for a Web Worker running `handleVocalWorkerRequest`. Messages are
 * passed through `structuredClone` with their transfer lists in both directions, so
 * transferred buffers are really detached on the sending side — exactly like
 * `postMessage` between threads.
 */
export class FakeVocalWorker implements VocalWorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;
  readonly received: unknown[] = [];

  constructor(private readonly options: FakeWorkerOptions = {}) {}

  postMessage(message: unknown, transfer?: ArrayBuffer[]): void {
    const cloned = structuredClone(message, { transfer: transfer ?? [] });
    this.received.push(cloned);
    const handlerAtPost = this.onmessage;
    const alive = (): boolean => !this.terminated || this.options.ignoreTerminate === true;
    setTimeout(() => {
      if (!alive()) return;
      handleVocalWorkerRequest(cloned as VocalWorkerRequest, (response, responseTransfer) => {
        const data = structuredClone(response, { transfer: responseTransfer ?? [] });
        const messages = this.options.rewrite ? this.options.rewrite(data) : [data];
        setTimeout(() => {
          if (!alive()) return;
          const handler =
            this.options.captureHandlerAtPost === true ? handlerAtPost : this.onmessage;
          for (const m of messages) handler?.({ data: m });
        }, 0);
      });
    }, this.options.startDelayMs ?? 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Factory that records every worker it creates. */
export function fakeWorkerFactory(options: FakeWorkerOptions = {}): {
  readonly create: () => FakeVocalWorker;
  readonly created: FakeVocalWorker[];
} {
  const created: FakeVocalWorker[] = [];
  return {
    created,
    create: () => {
      const worker = new FakeVocalWorker(options);
      created.push(worker);
      return worker;
    },
  };
}
