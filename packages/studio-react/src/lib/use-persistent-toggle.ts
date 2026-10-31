import { useCallback, useSyncExternalStore } from 'react';
import { useSession } from '../session/context';

const PREFIX = 'ui.';

/**
 * A boolean UI preference remembered by the host (e.g. a collapsed lane), stored as
 * `ui.<key>` = `'1'`/`'0'` in `platform.preferences`. The store keeps the value in memory
 * when it cannot persist it (private mode, blocked storage), and every component using the
 * same key re-renders when it changes, also from another tab.
 */
export function usePersistentToggle(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const preferences = useSession().platform.preferences;
  const storageKey = PREFIX + key;
  const subscribe = useCallback(
    (onChange: () => void) =>
      preferences.subscribe((changed) => {
        if (changed === storageKey) onChange();
      }),
    [preferences, storageKey],
  );
  const read = () => preferences.get(storageKey);
  const stored = useSyncExternalStore(subscribe, read, read);
  const set = useCallback(
    (next: boolean) => preferences.set(storageKey, next ? '1' : '0'),
    [preferences, storageKey],
  );
  return [stored === undefined ? fallback : stored === '1', set];
}
