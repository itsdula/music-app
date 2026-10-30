/**
 * A live signal in the shape of an external store, as `@audio-ui/react` sources expect:
 * `subscribe` registers a listener called on each new frame, `getSnapshot` returns the latest.
 */
export interface FrameSource<T> {
  getSnapshot: () => T;
  subscribe: (listener: () => void) => () => void;
}

/** A frame source you push to yourself: from the engine's render loop, a worker or a test. */
export interface FrameEmitter<T> extends FrameSource<T> {
  emit: (frame: T) => void;
}

export function createFrameEmitter<T>(initial: T): FrameEmitter<T> {
  const listeners = new Set<() => void>();
  let latest = initial;
  return {
    emit: (frame) => {
      latest = frame;
      for (const listener of listeners) listener();
    },
    getSnapshot: () => latest,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
