/**
 * Runs the persistence contract suites against the in-memory reference
 * implementations. The suites themselves live in ./repository-contracts and are
 * re-exported here; other adapters (e.g. IndexedDB in @studio/platform-browser)
 * import them from that module to run the identical checks.
 */
import {
  createMemoryAssetRepository,
  createMemoryDerivedCache,
  createMemoryProjectRepository,
  createMemorySettingsRepository,
} from '../src';
import {
  runAssetRepositoryContract,
  runDerivedCacheContract,
  runProjectRepositoryContract,
  runSettingsRepositoryContract,
} from './repository-contracts';

export {
  runAssetRepositoryContract,
  runDerivedCacheContract,
  runProjectRepositoryContract,
  runSettingsRepositoryContract,
} from './repository-contracts';
export type { Harness, ProjectRepositoryHarness } from './repository-contracts';

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
