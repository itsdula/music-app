import { useCallback, useState } from 'react';

const PREFIX = 'studio.ui.';

function read(key: string, fallback: boolean): boolean {
  try {
    const value = globalThis.localStorage?.getItem(PREFIX + key);
    return value === null || value === undefined ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

/**
 * A boolean UI preference remembered per browser (e.g. a collapsed lane). Storage failures
 * (private mode, blocked storage) fall back to in-memory state.
 */
export function usePersistentToggle(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key, fallback) }));
  // Re-read when the key changes (e.g. bottom panel vs full editor).
  const value = state.key === key ? state.value : read(key, fallback);
  if (state.key !== key) setState({ key, value });
  const set = useCallback(
    (next: boolean) => {
      setState({ key, value: next });
      try {
        globalThis.localStorage?.setItem(PREFIX + key, next ? '1' : '0');
      } catch {
        // Not persisted; the in-memory value still applies.
      }
    },
    [key],
  );
  return [value, set];
}
