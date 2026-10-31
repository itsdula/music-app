/**
 * Runs the persistence contract suites against the in-memory reference
 * implementations. The suites themselves live in ./repository-contracts and are
 * re-exported here; other adapters (e.g. IndexedDB in @studio/platform-browser)
 * import them from that module to run the identical checks.
 */
import {
  createMemoryAssetRepository,
  createMemoryDerivedCache,
  createMemoryKeyValueStore,
  createMemoryProjectRepository,
  createMemorySettingsRepository,
} from '../src';
import {
  runAssetRepositoryContract,
  runDerivedCacheContract,
  runKeyValueStoreContract,
  runProjectRepositoryContract,
  runSettingsRepositoryContract,
} from './repository-contracts';

export {
  runAssetRepositoryContract,
  runDerivedCacheContract,
  runKeyValueStoreContract,
  runProjectRepositoryContract,
  runSettingsRepositoryContract,
} from './repository-contracts';
export type {
  Harness,
  KeyValueStoreHarness,
  ProjectRepositoryHarness,
} from './repository-contracts';

runProjectRepositoryContract('memory', () => {
  const repository = createMemoryProjectRepository();
  return {
    repository,
    injectRawRecord: (id, slot, raw) => repository.injectRawRecord(id, slot, raw),
  };
});
runAssetRepositoryContract('memory', () => ({ repository: createMemoryAssetRepository() }));
runDerivedCacheContract('memory', () => ({ repository: createMemoryDerivedCache() }));
runSettingsRepositoryContract('memory', () => ({ repository: createMemorySettingsRepository() }));
runKeyValueStoreContract('memory', () => {
  const store = createMemoryKeyValueStore();
  return { store, externalChange: (key, value) => store.receive(key, value) };
});
