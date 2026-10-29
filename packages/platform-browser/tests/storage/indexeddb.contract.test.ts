/**
 * IndexedDB adapters (fake-indexeddb in Node): the shared persistence contract
 * suites plus IndexedDB-specific behaviour (recovery from raw corruption, multi-tab
 * conflicts, large assets, key-range deletes, quota mapping, atomicity, DB layout).
 */
import { asAssetId, asProjectId, type Project } from '@studio/domain';
import { StorageCorruptionError, StorageQuotaError } from '@studio/project-storage';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRichProject,
  emptyProject,
  fakeAudioBytes,
  makeAsset,
} from '../../../project-storage/tests/fixtures';
import {
  runAssetRepositoryContract,
  runDerivedCacheContract,
  runProjectRepositoryContract,
  runSettingsRepositoryContract,
} from '../../../project-storage/tests/repository-contracts';
import {
  DB_SCHEMA_VERSION,
  STORE_NAMES,
  StudioDatabase,
  createIndexedDbStorage,
  isQuotaError,
  mapStorageError,
  prefixUpperBound,
  type IndexedDbStorage,
} from '../../src/storage';

let dbCounter = 0;

/** A fresh, isolated IndexedDB (own factory and database name) per call. */
function freshEnvironment() {
  const indexedDB = new IDBFactory();
  const dbName = `studio-test-${++dbCounter}`;
  const open = () => createIndexedDbStorage({ dbName, indexedDB, IDBKeyRange });
  /** Second connection used to read/write raw records underneath the adapter. */
  const raw = () => new StudioDatabase(dbName, { indexedDB, IDBKeyRange });
  return { indexedDB, dbName, open, raw };
}

function storageHarness() {
  const env = freshEnvironment();
  const storage = env.open();
  const raw = env.raw();
  return {
    env,
    storage,
    raw,
    dispose: () => {
      storage.close();
      raw.close();
    },
  };
}

runProjectRepositoryContract('indexeddb', () => {
  const h = storageHarness();
  return {
    repository: h.storage.projects,
    injectRawRecord: async (id, slot, value) => {
      const table = slot === 'primary' ? h.raw.projects : h.raw.projectBackups;
      if (value === undefined) await table.delete(id);
      else await table.put(value, id);
    },
    dispose: h.dispose,
  };
});
runAssetRepositoryContract('indexeddb', () => {
  const h = storageHarness();
  return { repository: h.storage.assets, dispose: h.dispose };
});
runDerivedCacheContract('indexeddb', () => {
  const h = storageHarness();
  return { repository: h.storage.derived, dispose: h.dispose };
});
runSettingsRepositoryContract('indexeddb', () => {
  const h = storageHarness();
  return { repository: h.storage.settings, dispose: h.dispose };
});

describe('IndexedDB storage specifics', () => {
  let h: ReturnType<typeof storageHarness>;
  let storage: IndexedDbStorage;
  const ID = asProjectId('prj_rich');
  const named = (project: Project, name: string): Project => ({ ...project, name });

  beforeEach(() => {
    h = storageHarness();
    storage = h.storage;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    h.dispose();
  });

  it('creates the documented layout (Dexie version 1 = native version 10)', async () => {
    await storage.settings.get('warm-up'); // opens the database
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = h.env.indexedDB.open(h.env.dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error as Error);
    });
    expect(db.version).toBe(DB_SCHEMA_VERSION * 10);
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    db.close();
  });

  describe('crash recovery', () => {
    it('falls back to the backup when the primary payload is corrupt', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(named(project, 'good'));
      await storage.projects.save(named(project, 'about to be damaged'));
      // Simulate a torn/garbled write: a binary blob where the record should be.
      await h.raw.projects.put(new Uint8Array([1, 2, 3]), ID);

      const loaded = await storage.projects.load(ID);
      expect(loaded).toMatchObject({ status: 'ok', recoveredFromBackup: true });
      expect(loaded.status === 'ok' && loaded.project.name).toBe('good');
    });

    it('falls back to the backup when the primary record is missing', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(named(project, 'r1'));
      await storage.projects.save(named(project, 'r2'));
      await h.raw.projects.delete(ID);
      const loaded = await storage.projects.load(ID);
      expect(loaded).toMatchObject({ status: 'ok', recoveredFromBackup: true, revision: 1 });
    });

    it('reports corrupt with errors from both slots when both fail', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(project);
      await storage.projects.save(project);
      const stored = (await h.raw.projects.get(ID)) as { data: Record<string, unknown> };
      await h.raw.projects.put({ ...stored, data: { ...stored.data, bpm: -1 } }, ID);
      await h.raw.projectBackups.put(
        { ...stored, revision: 1, data: { ...stored.data, schemaVersion: 42 } },
        ID,
      );
      const loaded = await storage.projects.load(ID);
      expect(loaded.status).toBe('corrupt');
      if (loaded.status !== 'corrupt') return;
      expect(loaded.errors.find((e) => e.startsWith('primary: '))).toMatch(/bpm/);
      expect(loaded.errors.find((e) => e.startsWith('backup: '))).toMatch(/newer version/);
    });

    it('survives reopening the database (data is durable across connections)', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(project);
      storage.close();
      const reopened = h.env.open();
      expect(await reopened.projects.load(ID)).toMatchObject({ status: 'ok', revision: 1 });
      reopened.close();
    });
  });

  describe('multi-tab conflicts', () => {
    it('rejects a stale writer from another connection', async () => {
      const otherTab = h.env.open();
      const { project } = buildRichProject();
      await storage.projects.save(project, { expectedRevision: 0 });
      const mine = await storage.projects.load(ID);
      const theirs = await otherTab.projects.load(ID);
      expect(mine.status === 'ok' && theirs.status === 'ok').toBe(true);
      if (mine.status !== 'ok' || theirs.status !== 'ok') return;

      expect(
        await otherTab.projects.save(named(project, 'theirs'), {
          expectedRevision: theirs.revision,
        }),
      ).toMatchObject({
        status: 'saved',
        revision: 2,
      });
      expect(
        await storage.projects.save(named(project, 'mine'), { expectedRevision: mine.revision }),
      ).toEqual({
        status: 'conflict',
        storedRevision: 2,
      });
      const final = await storage.projects.load(ID);
      expect(final.status === 'ok' && final.project.name).toBe('theirs');
      otherTab.close();
    });
  });

  describe('assets', () => {
    it('round-trips a 10 MB asset', async () => {
      const record = makeAsset('ast_10mb', fakeAudioBytes(10 * 1024 * 1024, 77));
      await storage.assets.put(record);
      const loaded = await storage.assets.get(record.meta.id);
      expect(loaded?.meta).toEqual(record.meta);
      expect(loaded!.bytes.byteLength).toBe(10 * 1024 * 1024);
      expect(Buffer.from(loaded!.bytes).equals(Buffer.from(record.bytes))).toBe(true);
    });

    it('lists, checks and reads metadata without touching the bytes store', async () => {
      await storage.assets.put(makeAsset('ast_a', fakeAudioBytes(1000)));
      await storage.assets.put(makeAsset('ast_b', fakeAudioBytes(1000)));
      const touched: string[] = [];
      for (const method of [
        'get',
        'getAll',
        'openCursor',
        'openKeyCursor',
        'getAllKeys',
        'count',
      ] as const) {
        const original = IDBObjectStore.prototype[method] as (...args: unknown[]) => unknown;
        vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (
          this: IDBObjectStore,
          ...args: unknown[]
        ) {
          touched.push(`${this.name}.${method}`);
          return original.apply(this, args);
        } as never);
      }
      expect(await storage.assets.listIds()).toEqual(['ast_a', 'ast_b']);
      expect(await storage.assets.has(asAssetId('ast_a'))).toBe(true);
      expect((await storage.assets.getMeta(asAssetId('ast_b')))?.id).toBe('ast_b');
      expect(touched.length).toBeGreaterThan(0);
      expect(touched.filter((t) => t.startsWith('assetBytes.'))).toEqual([]);
      expect(touched).not.toContain('assetMeta.getAll');
      expect(touched).not.toContain('assetMeta.openCursor');
    });

    it('reports corrupted asset rows instead of returning bad data', async () => {
      const record = makeAsset('ast_c', fakeAudioBytes(100));
      await storage.assets.put(record);
      await h.raw.assetBytes.put(new Uint8Array(99), 'ast_c');
      await expect(storage.assets.get(record.meta.id)).rejects.toBeInstanceOf(
        StorageCorruptionError,
      );
      await h.raw.assetBytes.delete('ast_c');
      await expect(storage.assets.get(record.meta.id)).rejects.toBeInstanceOf(
        StorageCorruptionError,
      );
      await h.raw.assetMeta.put({ ...record.meta, contentHash: 'bad' });
      await expect(storage.assets.getMeta(record.meta.id)).rejects.toBeInstanceOf(
        StorageCorruptionError,
      );
      await h.raw.assetMeta.delete('ast_c');
      await h.raw.assetBytes.put(new Uint8Array(1), 'ast_c');
      await expect(storage.assets.get(record.meta.id)).rejects.toBeInstanceOf(
        StorageCorruptionError,
      );
    });
  });

  describe('derived cache', () => {
    it('deleteByPrefix deletes with a single key range', async () => {
      for (const key of ['peaks:aaa:1:-', 'peaks:aaa:2:-', 'peaks:aab:1:-', 'pitch:aaa:1:-']) {
        await storage.derived.put(key, new Float32Array(4));
      }
      const boundSpy = vi.spyOn(IDBKeyRange, 'bound');
      const deleteSpy = vi.spyOn(IDBObjectStore.prototype, 'delete');
      await storage.derived.deleteByPrefix('peaks:aaa:');
      expect(boundSpy).toHaveBeenCalledWith('peaks:aaa:', 'peaks:aaa;', false, true);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy.mock.calls[0]![0]).toBeInstanceOf(IDBKeyRange);
      expect(await storage.derived.get('peaks:aaa:1:-')).toBeUndefined();
      expect(await storage.derived.get('peaks:aab:1:-')).toBeInstanceOf(Float32Array);
      expect(await storage.derived.get('pitch:aaa:1:-')).toBeInstanceOf(Float32Array);
    });

    it('handles prefixes ending in U+FFFF', async () => {
      await storage.derived.put('￿￿a', 1);
      await storage.derived.put('z', 2);
      await storage.derived.deleteByPrefix('￿￿');
      expect(await storage.derived.get('￿￿a')).toBeUndefined();
      expect(await storage.derived.get('z')).toBe(2);
    });
  });

  describe('quota and atomicity', () => {
    const quotaError = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

    function failPutsOn(store: string, error: () => unknown) {
      const original = IDBObjectStore.prototype.put;
      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (this.name === store) throw error();
        return original.apply(this, args);
      });
    }

    it('surfaces quota failures on project save as StorageQuotaError and changes nothing', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(named(project, 'r1'));
      failPutsOn('projects', quotaError);
      const failure = storage.projects.save(named(project, 'r2'));
      await expect(failure).rejects.toBeInstanceOf(StorageQuotaError);
      await expect(failure).rejects.toThrow(/quota exceeded while saving project prj_rich/i);
      vi.restoreAllMocks();
      const loaded = await storage.projects.load(ID);
      expect(loaded).toMatchObject({ status: 'ok', revision: 1, recoveredFromBackup: false });
      expect(loaded.status === 'ok' && loaded.project.name).toBe('r1');
    });

    it('rolls back the whole save when a later write in the transaction fails', async () => {
      const { project } = buildRichProject();
      await storage.projects.save(named(project, 'r1'));
      await storage.projects.save(named(project, 'r2'));
      failPutsOn('projectSummaries', () => new Error('disk error'));
      await expect(storage.projects.save(named(project, 'r3'))).rejects.toThrow('disk error');
      vi.restoreAllMocks();
      const loaded = await storage.projects.load(ID);
      expect(loaded.status === 'ok' && [loaded.project.name, loaded.revision]).toEqual(['r2', 2]);
      // The backup is still r1 (not r2): nothing from the failed save was committed.
      await h.raw.projects.delete(ID);
      const backup = await storage.projects.load(ID);
      expect(backup.status === 'ok' && backup.project.name).toBe('r1');
      expect((await storage.projects.list())[0]?.revision).toBe(2);
    });

    it('surfaces quota failures on asset writes and keeps metadata and bytes consistent', async () => {
      failPutsOn('assetBytes', quotaError);
      const record = makeAsset('ast_q', fakeAudioBytes(100));
      await expect(storage.assets.put(record)).rejects.toBeInstanceOf(StorageQuotaError);
      vi.restoreAllMocks();
      expect(await storage.assets.has(record.meta.id)).toBe(false);
      expect(await storage.assets.listIds()).toEqual([]);
    });

    it('surfaces quota failures on cache and settings writes', async () => {
      failPutsOn('derived', quotaError);
      await expect(storage.derived.put('k', 1)).rejects.toBeInstanceOf(StorageQuotaError);
      vi.restoreAllMocks();
      failPutsOn('settings', quotaError);
      await expect(storage.settings.set('k', 1)).rejects.toBeInstanceOf(StorageQuotaError);
    });

    it('passes other errors through unchanged', async () => {
      await expect(storage.projects.save({ ...emptyProject(), bpm: 0 })).rejects.toMatchObject({
        name: 'ProjectValidationError',
      });
    });
  });

  it('rejects operations after close()', async () => {
    storage.close();
    await expect(storage.settings.get('x')).rejects.toThrow();
  });
});

describe('prefixUpperBound', () => {
  it('computes the exclusive upper bound of a prefix range', () => {
    expect(prefixUpperBound('peaks:')).toBe('peaks;');
    expect(prefixUpperBound('a￿')).toBe('b');
    expect(prefixUpperBound('￿')).toBeUndefined();
    expect(prefixUpperBound('')).toBeUndefined();
  });
});

describe('quota error detection', () => {
  it('recognises native, legacy, Firefox and wrapped quota errors', () => {
    expect(isQuotaError(new DOMException('x', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ name: 'Error', code: 22 })).toBe(true);
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(
      isQuotaError(new Error('outer', { cause: new DOMException('x', 'QuotaExceededError') })),
    ).toBe(true);
    expect(isQuotaError(new Error('nope'))).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('maps only quota errors', () => {
    const quota = mapStorageError(new DOMException('x', 'QuotaExceededError'), 'testing');
    expect(quota).toBeInstanceOf(StorageQuotaError);
    expect((quota as Error).message).toMatch(/while testing/);
    const already = new StorageQuotaError();
    expect(mapStorageError(already, 'x')).toBe(already);
    const other = new Error('other');
    expect(mapStorageError(other, 'x')).toBe(other);
  });
});
