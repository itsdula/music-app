// @vitest-environment jsdom
/**
 * The KeyValueStore contract against jsdom's real `window.localStorage` and `storage`
 * events, using the adapter's defaults (no injected storage or event source).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { runKeyValueStoreContract } from '../../../project-storage/tests/repository-contracts';
import { createLocalStorageKeyValueStore, DEFAULT_PREFERENCES_PREFIX } from '../../src/storage';

afterEach(() => localStorage.clear());

/** Another tab's write: the shared storage changes, then this window gets the event. */
function otherTabWrite(key: string, value: string | undefined) {
  const name = DEFAULT_PREFERENCES_PREFIX + key;
  const oldValue = localStorage.getItem(name);
  if (value === undefined) localStorage.removeItem(name);
  else localStorage.setItem(name, value);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: name,
      oldValue,
      newValue: value ?? null,
      storageArea: localStorage,
    }),
  );
}

runKeyValueStoreContract('localStorage (jsdom)', () => {
  localStorage.clear();
  const store = createLocalStorageKeyValueStore();
  return {
    store,
    reopen: () => createLocalStorageKeyValueStore(),
    externalChange: otherTabWrite,
    dispose: () => store.dispose(),
  };
});

describe('createLocalStorageKeyValueStore in a browser environment', () => {
  it('uses window.localStorage by default', () => {
    const store = createLocalStorageKeyValueStore();
    expect(store.persistent).toBe(true);
    store.set('ui.pianoRoll.velocityLane.editor', '1');
    expect(localStorage.getItem('studio.pref.ui.pianoRoll.velocityLane.editor')).toBe('1');
    store.dispose();
  });

  it('ignores events from sessionStorage', () => {
    const store = createLocalStorageKeyValueStore();
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'studio.pref.ui.a',
        newValue: '1',
        storageArea: sessionStorage,
      }),
    );
    expect(store.get('ui.a')).toBeUndefined();
    store.dispose();
  });
});
