import { useMemo, type Ref, type RefCallback } from 'react';

type Cleanup = () => void;

/** Combines refs (objects, callbacks, callbacks returning cleanups) into one callback ref. */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node: T | null) => {
    const cleanups: Cleanup[] = [];
    for (const ref of refs) {
      if (typeof ref === 'function') {
        const cleanup = ref(node);
        cleanups.push(typeof cleanup === 'function' ? cleanup : () => ref(null));
      } else if (ref) {
        ref.current = node;
        cleanups.push(() => {
          ref.current = null;
        });
      }
    }
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  };
}

/** Memoized `mergeRefs` for two refs, so React does not re-attach them on every render. */
export function useMergedRefs<T>(a: Ref<T> | undefined, b: Ref<T> | undefined): RefCallback<T> {
  return useMemo(() => mergeRefs(a, b), [a, b]);
}
