export * from './repositories';
export * from './errors';
export {
  ProjectSchema,
  AssetRefSchema,
  TrackSchema,
  ClipSchema,
  EffectSlotSchema,
  VocalEditDocSchema,
  MidiMappingSchema,
  MidiControlSourceSchema,
  ParameterAddressSchema,
  MusicalKeySchema,
  ENTITY_ID_PATTERN,
  SHA256_HEX_PATTERN,
  SCHEMA_LIMITS,
  type ProjectSchemaOutput,
  type Unbranded,
} from './schema';
export {
  MIGRATIONS,
  migrateProjectData,
  migrateWith,
  migrateV0ToV1,
  type ProjectMigration,
  type JsonRecord,
} from './migrations';
export { parseProject, parseProjectJson, type ParsedProject } from './parse';
export { serializeProject, stableStringify } from './serialize';
export { cloneStructured, DataCloneError } from './clone';
export {
  planProjectSave,
  resolveProjectLoad,
  readStoredRecord,
  headRevision,
  summarizeProject,
  validateProjectForSave,
  type ProjectSavePlan,
  type StoredProjectRecord,
} from './project-records';
export {
  createMemoryProjectRepository,
  createMemoryAssetRepository,
  createMemoryDerivedCache,
  createMemorySettingsRepository,
  assertValidAssetRecord,
  compareSummaries,
  type MemoryProjectRepository,
  type MemoryProjectRepositoryOptions,
  type MemoryAssetRepositoryOptions,
  type ProjectRecordSlot,
} from './memory';
export {
  createMemoryKeyValueStore,
  assertValidPreference,
  assertValidPreferenceKey,
  preferenceKeyError,
  preferenceValueError,
  utf8ByteLength,
  PREFERENCE_KEY_PATTERN,
  PREFERENCE_LIMITS,
  type KeyValueStore,
  type KeyValueListener,
  type MemoryKeyValueStore,
  type MemoryKeyValueStoreOptions,
} from './preferences';
export {
  derivedCacheKey,
  derivedCachePrefix,
  parseDerivedCacheKey,
  type DerivedCacheKeyParts,
} from './derived-keys';
export {
  exportProjectBundle,
  importProjectBundle,
  checkBundlePath,
  assetFileExtension,
  assetBundlePath,
  BundleError,
  DEFAULT_BUNDLE_LIMITS,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_FILE_EXTENSION,
  BUNDLE_MIME_TYPE,
  MANIFEST_PATH,
  PROJECT_PATH,
  type BundleLimits,
  type BundleErrorCode,
  type BundleDeps,
  type BundleManifest,
  type BundleManifestEntry,
} from './bundle';
export {
  AutosaveCoordinator,
  type AutosaveOptions,
  type AutosaveScheduler,
  type AutosaveState,
  type AutosaveStatus,
  type AutosaveRetryInfo,
} from './autosave';
