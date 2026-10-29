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
