/**
 * Scheduler heartbeat worker, bundled by `pnpm codegen` into `CLOCK_WORKER_SOURCE`.
 *
 * Dedicated-worker timers are not subject to the aggressive main-thread timer
 * throttling browsers apply to background tabs, so the lookahead scheduler keeps being
 * woken while the tab is hidden. The worker only sends 'tick' messages; all scheduling
 * decisions are made on the main thread from AudioContext time.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<ClockCommand>) => void) | null;
  postMessage(message: unknown): void;
}

type ClockCommand =
  { readonly type: 'start'; readonly intervalMs: number } | { readonly type: 'stop' };

declare const self: WorkerScope;

let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event) => {
  const command = event.data;
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
  if (command.type === 'start') {
    timer = setInterval(() => self.postMessage('tick'), Math.max(1, command.intervalMs));
  }
};
