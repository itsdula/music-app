/**
 * IndexedDB persistence (via Dexie) implementing the @studio/project-storage ports.
 *
 * Database layout (Dexie schema version 1 = native IDB version 10):
 *
 *   projects          out-of-line key projectId → StoredProjectRecord (primary revision)
 *   projectBackups    out-of-line key projectId → StoredProjectRecord (previous good revision)
 *   projectSummaries  keyPath id              → ProjectSummary (list() reads only this)
 *   assetMeta         keyPath id              → AssetRef
 *   assetBytes        out-of-line key assetId → Uint8Array (encoded file bytes)
 *   derived           out-of-line key string  → any structured-cloneable value
 *   settings          out-of-line key string  → any structured-cloneable value
 *
 * Project records use out-of-line keys so whatever is stored under a key can be
 * read back and judged (even a non-object), which is what crash recovery needs.
 * Revision/backup/recovery decisions are delegated to the shared logic in
 * @studio/project-storage so every host behaves identically. See
 * docs/persistence.md §IndexedDB for upgrade rules.
 */
import type { AssetId, AssetRef, Project, ProjectId } from '@studio/domain';
import {
  AssetRefSchema,
  StorageCorruptionError,
  assertValidAssetRecord,
  compareSummaries,
  planProjectSave,
  resolveProjectLoad,
  type AssetRecord,
  type AssetRepository,
  type DerivedDataCache,
  type ProjectLoadResult,
  type ProjectRepository,
  type ProjectSummary,
  type SaveOptions,
  type SaveResult,
  type SettingsRepository,
} from '@studio/project-storage';
import Dexie, { type Table } from 'dexie';
import { withStorageErrors } from './errors';

export const DEFAULT_DB_NAME = 'studio';

/** Dexie schema version of the current layout. Bump with a new `version(n)` block, never edit old ones. */
export const DB_SCHEMA_VERSION = 1;

export const STORE_NAMES = [
  'projects',
  'projectBackups',
  'projectSummaries',
  'assetMeta',
  'assetBytes',
  'derived',
  'settings',
] as const;

export class StudioDatabase extends Dexie {
  /** Values are untrusted until validated, hence `unknown`. */
  projects!: Table<unknown, string>;
  projectBackups!: Table<unknown, string>;
  projectSummaries!: Table<ProjectSummary, string>;
  assetMeta!: Table<AssetRef, string>;
  assetBytes!: Table<Uint8Array, string>;
  derived!: Table<unknown, string>;
  settings!: Table<unknown, string>;

  constructor(name: string, options: { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }) {
    super(name, {
      ...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
      ...(options.IDBKeyRange ? { IDBKeyRange: options.IDBKeyRange } : {}),
      // No Dexie-side caching: every read goes to IndexedDB, so writes from other
      // tabs and recovery decisions always see the stored truth.
      cache: 'disabled',
    });
    this.version(DB_SCHEMA_VERSION).stores({
      projects: '',
      projectBackups: '',
      projectSummaries: 'id',
      assetMeta: 'id',
      assetBytes: '',
      derived: '',
      settings: '',
    });
  }
}

export interface IndexedDbStorage {
  readonly projects: ProjectRepository;
  readonly assets: AssetRepository;
  readonly derived: DerivedDataCache;
  readonly settings: SettingsRepository;
  /** Closes the connection; later calls on the repositories reject. */
  close(): void;
}

export interface IndexedDbStorageOptions {
  readonly dbName?: string;
  /** Defaults to the global `indexedDB` (pass fake-indexeddb's in tests). */
  readonly indexedDB?: IDBFactory;
  readonly IDBKeyRange?: typeof IDBKeyRange;
  /** Clock for `savedAt`; defaults to the wall clock. */
  readonly now?: () => string;
}

/**
 * Smallest string greater than every string starting with `prefix`, or undefined
 * when no such string exists (prefix made only of U+FFFF code units).
 */
export function prefixUpperBound(prefix: string): string | undefined {
  let end = prefix.length;
  while (end > 0 && prefix.charCodeAt(end - 1) === 0xffff) end--;
  if (end === 0) return undefined;
  return prefix.slice(0, end - 1) + String.fromCharCode(prefix.charCodeAt(end - 1) + 1);
}

function isSummary(value: unknown): value is ProjectSummary {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s['id'] === 'string' &&
    typeof s['name'] === 'string' &&
    typeof s['createdAt'] === 'string' &&
    typeof s['updatedAt'] === 'string' &&
    typeof s['trackCount'] === 'number' &&
    typeof s['revision'] === 'number'
  );
}

/** Copies a view so that only its own bytes (not the whole backing buffer) get stored. */
function exactBytes(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

function readMeta(id: string, raw: unknown): AssetRef {
  const parsed = AssetRefSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== id) {
    throw new StorageCorruptionError(`assetMeta/${id}`, 'metadata is malformed');
  }
  return parsed.data as AssetRef;
}

function createProjectRepository(db: StudioDatabase, now: () => string): ProjectRepository {
  return {
    async list(): Promise<ProjectSummary[]> {
      const rows: unknown[] = await db.projectSummaries.toArray();
      return rows.filter(isSummary).sort(compareSummaries);
    },

    async load(id: ProjectId): Promise<ProjectLoadResult> {
      const [primary, backup] = await db.transaction('r', [db.projects, db.projectBackups], () =>
        Promise.all([db.projects.get(id), db.projectBackups.get(id)]),
      );
      // Validation runs outside the transaction (it is pure and may be slow).
      return resolveProjectLoad(id, primary, backup);
    },

    save(project: Project, options: SaveOptions = {}): Promise<SaveResult> {
      return withStorageErrors(`saving project ${project.id}`, () =>
        db.transaction('rw', [db.projects, db.projectBackups, db.projectSummaries], async () => {
          const [primary, backup] = await Promise.all([
            db.projects.get(project.id),
            db.projectBackups.get(project.id),
          ]);
          // Pure and synchronous: safe inside the transaction (no foreign awaits).
          const plan = planProjectSave({
            project,
            expectedRevision: options.expectedRevision,
            existingPrimary: primary,
            existingBackup: backup,
            savedAt: now(),
          });
          if (plan.status === 'conflict') return plan.result;
          // One transaction: the new primary, the backup and the summary commit together or not at all.
          const writes: Promise<unknown>[] = [
            db.projects.put(plan.primary, project.id),
            db.projectSummaries.put(plan.summary),
          ];
          if (plan.backup !== undefined && plan.backup !== backup) {
            writes.push(db.projectBackups.put(plan.backup, project.id));
          }
          await Promise.all(writes);
          return plan.result;
        }),
      );
    },

    async delete(id: ProjectId): Promise<void> {
      await db.transaction('rw', [db.projects, db.projectBackups, db.projectSummaries], () =>
        Promise.all([
          db.projects.delete(id),
          db.projectBackups.delete(id),
          db.projectSummaries.delete(id),
        ]),
      );
    },
  };
}

function createAssetRepository(db: StudioDatabase): AssetRepository {
  return {
    put(record: AssetRecord): Promise<void> {
      return withStorageErrors(`storing asset ${record.meta?.id}`, async () => {
        assertValidAssetRecord(record);
        const id = record.meta.id;
        await db.transaction('rw', [db.assetMeta, db.assetBytes], () =>
          Promise.all([
            db.assetMeta.put({ ...record.meta }),
            db.assetBytes.put(exactBytes(record.bytes), id),
          ]),
        );
      });
    },

    async get(id: AssetId): Promise<AssetRecord | undefined> {
      const [rawMeta, rawBytes] = await db.transaction('r', [db.assetMeta, db.assetBytes], () =>
        Promise.all([db.assetMeta.get(id), db.assetBytes.get(id)]),
      );
      if (rawMeta === undefined && rawBytes === undefined) return undefined;
      if (rawMeta === undefined)
        throw new StorageCorruptionError(`assets/${id}`, 'bytes without metadata');
      const meta = readMeta(id, rawMeta);
      if (!(rawBytes instanceof Uint8Array))
        throw new StorageCorruptionError(`assets/${id}`, 'bytes are missing');
      if (rawBytes.byteLength !== meta.byteLength) {
        throw new StorageCorruptionError(
          `assets/${id}`,
          `stored ${rawBytes.byteLength} bytes but metadata says ${meta.byteLength}`,
        );
      }
      return { meta, bytes: rawBytes };
    },

    async getMeta(id: AssetId): Promise<AssetRef | undefined> {
      const raw: unknown = await db.assetMeta.get(id);
      return raw === undefined ? undefined : readMeta(id, raw);
    },

    async has(id: AssetId): Promise<boolean> {
      return (await db.assetMeta.where(':id').equals(id).count()) > 0;
    },

    async delete(id: AssetId): Promise<void> {
      await db.transaction('rw', [db.assetMeta, db.assetBytes], () =>
        Promise.all([db.assetMeta.delete(id), db.assetBytes.delete(id)]),
      );
    },

    async listIds(): Promise<AssetId[]> {
      // Key-only cursor: no metadata objects or bytes are loaded.
      const keys = await db.assetMeta.toCollection().primaryKeys();
      return keys.sort() as AssetId[];
    },
  };
}

function createKeyValue(table: Table<unknown, string>, label: string) {
  const get = async <T>(key: string): Promise<T | undefined> =>
    (await table.get(key)) as T | undefined;
  const put = <T>(key: string, value: T): Promise<void> =>
    withStorageErrors(`writing ${label} entry ${key}`, async () => {
      await table.put(value, key);
    });
  const remove = async (key: string): Promise<void> => {
    await table.delete(key);
  };
  const deleteByPrefix = async (prefix: string): Promise<void> => {
    if (prefix === '') {
      await table.clear();
      return;
    }
    // Keys are strings; in IndexedDB key order every array sorts after every string,
    // so `[]` is a safe exclusive upper bound when the prefix has no string successor.
    const upper: string | never[] = prefixUpperBound(prefix) ?? [];
    await table.where(':id').between(prefix, upper, true, false).delete();
  };
  return { get, put, delete: remove, deleteByPrefix };
}

export function createIndexedDbStorage(options: IndexedDbStorageOptions = {}): IndexedDbStorage {
  const db = new StudioDatabase(options.dbName ?? DEFAULT_DB_NAME, {
    ...(options.indexedDB ? { indexedDB: options.indexedDB } : {}),
    ...(options.IDBKeyRange ? { IDBKeyRange: options.IDBKeyRange } : {}),
  });
  const now = options.now ?? (() => new Date().toISOString());
  const derived = createKeyValue(db.derived, 'derived cache');
  const settings = createKeyValue(db.settings, 'settings');
  return {
    projects: createProjectRepository(db, now),
    assets: createAssetRepository(db),
    derived,
    settings: { get: settings.get, set: settings.put, delete: settings.delete },
    close: () => db.close(),
  };
}
