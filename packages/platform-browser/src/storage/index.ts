export {
  createIndexedDbStorage,
  prefixUpperBound,
  StudioDatabase,
  DEFAULT_DB_NAME,
  DB_SCHEMA_VERSION,
  STORE_NAMES,
  type IndexedDbStorage,
  type IndexedDbStorageOptions,
} from './indexeddb';
export { isQuotaError, mapStorageError } from './errors';
export {
  createLocalStorageKeyValueStore,
  DEFAULT_PREFERENCES_PREFIX,
  type KeyValueStorageArea,
  type LocalStorageKeyValueStore,
  type LocalStorageKeyValueStoreOptions,
  type StorageEventSource,
} from './local-storage';
export {
  createBridgedKeyValueStore,
  type BridgedKeyValueStoreOptions,
  type KeyValueBridge,
} from './bridged';
