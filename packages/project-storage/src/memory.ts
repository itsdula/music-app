/**
 * In-memory repositories. They are the reference implementations of the
 * persistence contracts (revisions, backups, conflicts, copy semantics) — the
 * IndexedDB adapters must behave identically, which the shared contract suites in
 * tests/ verify — and the storage of last resort for hosts without IndexedDB.
 */
import type { AssetId, AssetRef, Project, ProjectId } from '@studio/domain';
import { cloneStructured } from './clone';
import { InvalidRecordError, StorageQuotaError } from './errors';
import { planProjectSave, resolveProjectLoad, type StoredProjectRecord } from './project-records';
import type {
  AssetRecord,
  AssetRepository,
  DerivedDataCache,
  ProjectLoadResult,
  ProjectRepository,
  ProjectSummary,
  SaveOptions,
  SaveResult,
  SettingsRepository,
} from './repositories';
import { AssetRefSchema } from './schema';

const defaultNow = () => new Date().toISOString();

/** Sort order of `ProjectRepository.list()`: most recently updated first, then by id. */
export function compareSummaries(a: ProjectSummary, b: ProjectSummary): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type ProjectRecordSlot = 'primary' | 'backup';

export interface MemoryProjectRepository extends ProjectRepository {
  /**
   * Fault injection for tests: replaces the raw stored record in a slot with
   * arbitrary data (`undefined` removes it), simulating corruption.
   */
  injectRawRecord(id: string, slot: ProjectRecordSlot, raw: unknown): void;
}

export interface MemoryProjectRepositoryOptions {
  /** Clock for `savedAt`; defaults to the wall clock. */
  readonly now?: () => string;
}

export function createMemoryProjectRepository(
  options: MemoryProjectRepositoryOptions = {},
): MemoryProjectRepository {
  const now = options.now ?? defaultNow;
  const primaries = new Map<string, unknown>();
  const backups = new Map<string, unknown>();
  const summaries = new Map<string, ProjectSummary>();

  const setSlot = (map: Map<string, unknown>, id: string, value: unknown) => {
    if (value === undefined) map.delete(id);
    else map.set(id, value);
  };

  return {
    list(): Promise<ProjectSummary[]> {
      return Promise.resolve([...summaries.values()].map((s) => ({ ...s })).sort(compareSummaries));
    },

    load(id: ProjectId): Promise<ProjectLoadResult> {
      return Promise.resolve(resolveProjectLoad(id, primaries.get(id), backups.get(id)));
    },

    save(project: Project, saveOptions: SaveOptions = {}): Promise<SaveResult> {
      try {
        const plan = planProjectSave({
          project,
          expectedRevision: saveOptions.expectedRevision,
          existingPrimary: primaries.get(project.id),
          existingBackup: backups.get(project.id),
          savedAt: now(),
        });
        if (plan.status === 'conflict') return Promise.resolve(plan.result);
        // All three writes happen synchronously: atomic with respect to other callers.
        primaries.set(project.id, plan.primary);
        setSlot(backups, project.id, plan.backup satisfies StoredProjectRecord | undefined);
        summaries.set(project.id, plan.summary);
        return Promise.resolve(plan.result);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },

    delete(id: ProjectId): Promise<void> {
      primaries.delete(id);
      backups.delete(id);
      summaries.delete(id);
      return Promise.resolve();
    },

    injectRawRecord(id, slot, raw) {
      setSlot(slot === 'primary' ? primaries : backups, id, raw);
    },
  };
}

/** Validates an asset record before it is stored; shared by all asset repositories. */
export function assertValidAssetRecord(record: AssetRecord): void {
  const meta = AssetRefSchema.safeParse(record.meta);
  if (!meta.success) {
    const first = meta.error.issues[0];
    throw new InvalidRecordError(
      `invalid asset meta${first ? ` at ${first.path.map(String).join('.') || '(root)'}: ${first.message}` : ''}`,
    );
  }
  if (!(record.bytes instanceof Uint8Array))
    throw new InvalidRecordError('asset bytes must be a Uint8Array');
  if (record.bytes.byteLength !== record.meta.byteLength) {
    throw new InvalidRecordError(
      `asset ${record.meta.id}: meta.byteLength ${record.meta.byteLength} does not match ${record.bytes.byteLength} bytes`,
    );
  }
}

export interface MemoryAssetRepositoryOptions {
  /** Simulated storage quota in bytes; writes beyond it throw {@link StorageQuotaError}. */
  readonly quotaBytes?: number;
}

export function createMemoryAssetRepository(
  options: MemoryAssetRepositoryOptions = {},
): AssetRepository {
  const records = new Map<string, { meta: AssetRef; bytes: Uint8Array }>();
  const usedBytes = () => {
    let total = 0;
    for (const r of records.values()) total += r.bytes.byteLength;
    return total;
  };

  return {
    put(record: AssetRecord): Promise<void> {
      try {
        assertValidAssetRecord(record);
        if (options.quotaBytes !== undefined) {
          const replaced = records.get(record.meta.id)?.bytes.byteLength ?? 0;
          if (usedBytes() - replaced + record.bytes.byteLength > options.quotaBytes) {
            throw new StorageQuotaError(
              `Storage quota exceeded while storing asset ${record.meta.id}`,
            );
          }
        }
        records.set(record.meta.id, { meta: { ...record.meta }, bytes: record.bytes.slice() });
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    get(id: AssetId): Promise<AssetRecord | undefined> {
      const r = records.get(id);
      return Promise.resolve(r ? { meta: { ...r.meta }, bytes: r.bytes.slice() } : undefined);
    },
    getMeta(id: AssetId): Promise<AssetRef | undefined> {
      const r = records.get(id);
      return Promise.resolve(r ? { ...r.meta } : undefined);
    },
    has(id: AssetId): Promise<boolean> {
      return Promise.resolve(records.has(id));
    },
    delete(id: AssetId): Promise<void> {
      records.delete(id);
      return Promise.resolve();
    },
    listIds(): Promise<AssetId[]> {
      return Promise.resolve([...records.keys()].sort() as AssetId[]);
    },
  };
}

function createMemoryKeyValue() {
  const values = new Map<string, unknown>();
  const get = <T>(key: string): Promise<T | undefined> =>
    Promise.resolve(values.has(key) ? cloneStructured(values.get(key) as T) : undefined);
  const put = <T>(key: string, value: T): Promise<void> => {
    try {
      values.set(key, cloneStructured(value));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const remove = (key: string): Promise<void> => {
    values.delete(key);
    return Promise.resolve();
  };
  const deleteByPrefix = (prefix: string): Promise<void> => {
    for (const key of [...values.keys()]) if (key.startsWith(prefix)) values.delete(key);
    return Promise.resolve();
  };
  return { get, put, delete: remove, deleteByPrefix };
}

export function createMemoryDerivedCache(): DerivedDataCache {
  return createMemoryKeyValue();
}

export function createMemorySettingsRepository(): SettingsRepository {
  const kv = createMemoryKeyValue();
  return { get: kv.get, set: kv.put, delete: kv.delete };
}
