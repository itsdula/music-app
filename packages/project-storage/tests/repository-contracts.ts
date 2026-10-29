/**
 * Behavioural contract suites for the persistence ports. Every implementation
 * (memory, IndexedDB, future Electron/Tauri adapters) must pass all of them; the
 * memory implementations are the reference.
 *
 * Kept in a plain module (not a *.test.ts file) so other packages can import the
 * suites without also registering the memory runs.
 */
import {
  CURRENT_SCHEMA_VERSION,
  asAssetId,
  asProjectId,
  type Project,
  type ProjectId,
} from '@studio/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectRecordSlot } from '../src/memory';
import type {
  AssetRepository,
  DerivedDataCache,
  ProjectRepository,
  SettingsRepository,
} from '../src/repositories';
import { buildRichProject, emptyProject, fakeAudioBytes, makeAsset } from './fixtures';

type MaybePromise<T> = T | Promise<T>;

export interface ProjectRepositoryHarness {
  readonly repository: ProjectRepository;
  /**
   * Fault injection: overwrite the raw stored record of a slot (`undefined`
   * deletes it), simulating corruption for the backup/recovery tests.
   */
  readonly injectRawRecord: (
    id: string,
    slot: ProjectRecordSlot,
    raw: unknown,
  ) => MaybePromise<void>;
  readonly dispose?: () => MaybePromise<void>;
}

export interface Harness<R> {
  readonly repository: R;
  readonly dispose?: () => MaybePromise<void>;
}

function useHarness<H extends { dispose?: () => MaybePromise<void> }>(
  factory: () => MaybePromise<H>,
) {
  let current: H | undefined;
  beforeEach(async () => {
    current = await factory();
  });
  afterEach(async () => {
    await current?.dispose?.();
    current = undefined;
  });
  return () => {
    if (!current) throw new Error('harness not initialised');
    return current;
  };
}

const at = (project: Project, updatedAt: string, name = project.name): Project => ({
  ...project,
  updatedAt,
  name,
});

const corruptEnvelope = (id: string, revision: number) => ({
  id,
  revision,
  savedAt: '2026-01-01T00:00:00.000Z',
  data: { garbage: true },
});

// ---------------------------------------------------------------------------
// ProjectRepository
// ---------------------------------------------------------------------------

export function runProjectRepositoryContract(
  name: string,
  factory: () => MaybePromise<ProjectRepositoryHarness>,
): void {
  describe(`ProjectRepository contract: ${name}`, () => {
    const harness = useHarness(factory);
    const repo = () => harness().repository;
    const ID: ProjectId = asProjectId('prj_rich');

    it('reports unknown projects as not-found and lists nothing initially', async () => {
      expect(await repo().load(asProjectId('prj_missing'))).toEqual({ status: 'not-found' });
      expect(await repo().list()).toEqual([]);
    });

    it('saves revision 1 and loads it back unchanged', async () => {
      const { project } = buildRichProject();
      const result = await repo().save(project);
      expect(result).toMatchObject({ status: 'saved', revision: 1 });
      expect(typeof (result as { savedAt: string }).savedAt).toBe('string');
      expect(await repo().load(ID)).toEqual({
        status: 'ok',
        project,
        revision: 1,
        migratedFrom: CURRENT_SCHEMA_VERSION,
        recoveredFromBackup: false,
      });
    });

    it('increments the revision on every save and summarises in list()', async () => {
      const { project } = buildRichProject();
      await repo().save(project);
      const second = await repo().save(at(project, '2026-02-01T00:00:00.000Z', 'Renamed'));
      expect(second).toMatchObject({ status: 'saved', revision: 2 });
      expect(await repo().list()).toEqual([
        {
          id: ID,
          name: 'Renamed',
          createdAt: project.createdAt,
          updatedAt: '2026-02-01T00:00:00.000Z',
          trackCount: project.trackOrder.length,
          revision: 2,
        },
      ]);
    });

    it('lists most recently updated first, ties broken by id', async () => {
      const base = emptyProject();
      await repo().save(at({ ...base, id: asProjectId('prj_b') }, '2026-01-01T00:00:00.000Z'));
      await repo().save(at({ ...base, id: asProjectId('prj_c') }, '2026-03-01T00:00:00.000Z'));
      await repo().save(at({ ...base, id: asProjectId('prj_a') }, '2026-01-01T00:00:00.000Z'));
      expect((await repo().list()).map((s) => s.id)).toEqual(['prj_c', 'prj_a', 'prj_b']);
    });

    it('enforces expectedRevision (optimistic concurrency)', async () => {
      const { project } = buildRichProject();
      expect(await repo().save(project, { expectedRevision: 1 })).toEqual({
        status: 'conflict',
        storedRevision: 0,
      });
      expect(await repo().load(ID)).toEqual({ status: 'not-found' });
      expect(await repo().save(project, { expectedRevision: 0 })).toMatchObject({
        status: 'saved',
        revision: 1,
      });
      expect(
        await repo().save(at(project, project.updatedAt, 'v2'), { expectedRevision: 1 }),
      ).toMatchObject({
        status: 'saved',
        revision: 2,
      });
      // A stale writer is rejected and changes nothing.
      expect(
        await repo().save(at(project, project.updatedAt, 'stale'), { expectedRevision: 1 }),
      ).toEqual({
        status: 'conflict',
        storedRevision: 2,
      });
      const loaded = await repo().load(ID);
      expect(loaded.status === 'ok' && [loaded.project.name, loaded.revision]).toEqual(['v2', 2]);
      // Without expectedRevision the save is unconditional.
      expect(await repo().save(at(project, project.updatedAt, 'forced'))).toMatchObject({
        revision: 3,
      });
    });

    it('lets exactly one of two concurrent writers with the same expectedRevision win', async () => {
      const { project } = buildRichProject();
      await repo().save(project);
      const results = await Promise.all([
        repo().save(at(project, project.updatedAt, 'tab A'), { expectedRevision: 1 }),
        repo().save(at(project, project.updatedAt, 'tab B'), { expectedRevision: 1 }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['conflict', 'saved']);
      expect(results.find((r) => r.status === 'conflict')).toEqual({
        status: 'conflict',
        storedRevision: 2,
      });
    });

    it('stores a detached copy', async () => {
      const { project } = buildRichProject();
      const mutable = JSON.parse(JSON.stringify(project)) as {
        name: string;
        trackOrder: string[];
      } & Project;
      await repo().save(mutable);
      mutable.name = 'mutated after save';
      mutable.trackOrder.pop();
      const first = await repo().load(ID);
      expect(first.status === 'ok' && first.project).toEqual(project);
      const second = await repo().load(ID);
      expect(
        first.status === 'ok' && second.status === 'ok' && first.project !== second.project,
      ).toBe(true);
    });

    it('rejects invalid projects without storing anything', async () => {
      const invalid = { ...emptyProject(), bpm: 9999 };
      await expect(repo().save(invalid)).rejects.toMatchObject({ name: 'ProjectValidationError' });
      const oldVersion = { ...emptyProject(), schemaVersion: 0 };
      await expect(repo().save(oldVersion)).rejects.toMatchObject({
        name: 'ProjectValidationError',
        stage: 'version',
      });
      expect(await repo().load(emptyProject().id)).toEqual({ status: 'not-found' });
      expect(await repo().list()).toEqual([]);
    });

    it('deletes projects (idempotently)', async () => {
      const { project } = buildRichProject();
      await repo().save(project);
      await repo().save(project);
      await repo().delete(ID);
      expect(await repo().load(ID)).toEqual({ status: 'not-found' });
      expect(await repo().list()).toEqual([]);
      await expect(repo().delete(ID)).resolves.toBeUndefined();
      expect(await repo().save(project, { expectedRevision: 0 })).toMatchObject({ revision: 1 });
    });

    describe('backup and recovery', () => {
      const inject = (id: string, slot: ProjectRecordSlot, raw: unknown) =>
        harness().injectRawRecord(id, slot, raw);

      it('recovers the previous good revision when the primary is corrupt', async () => {
        const { project } = buildRichProject();
        await repo().save(at(project, project.updatedAt, 'good r1'));
        await repo().save(at(project, project.updatedAt, 'r2'));
        await inject(ID, 'primary', corruptEnvelope(ID, 2));

        const loaded = await repo().load(ID);
        expect(loaded).toMatchObject({ status: 'ok', recoveredFromBackup: true, revision: 2 });
        expect(loaded.status === 'ok' && loaded.project.name).toBe('good r1');

        // Saving on top of the recovered revision repairs the primary and keeps the good backup.
        expect(
          await repo().save(at(project, project.updatedAt, 'r3'), { expectedRevision: 2 }),
        ).toMatchObject({
          revision: 3,
        });
        const repaired = await repo().load(ID);
        expect(repaired).toMatchObject({ status: 'ok', recoveredFromBackup: false, revision: 3 });
        await inject(ID, 'primary', corruptEnvelope(ID, 3));
        const again = await repo().load(ID);
        expect(again.status === 'ok' && again.project.name).toBe('good r1');
      });

      it('keeps the previous primary as backup on a normal save', async () => {
        const { project } = buildRichProject();
        await repo().save(at(project, project.updatedAt, 'r1'));
        await repo().save(at(project, project.updatedAt, 'r2'));
        await repo().save(at(project, project.updatedAt, 'r3'));
        await inject(ID, 'primary', undefined);
        const loaded = await repo().load(ID);
        expect(loaded).toMatchObject({ status: 'ok', recoveredFromBackup: true, revision: 2 });
        expect(loaded.status === 'ok' && loaded.project.name).toBe('r2');
      });

      it('reports corrupt when primary and backup are both unusable', async () => {
        const { project } = buildRichProject();
        await repo().save(project);
        await repo().save(project);
        await inject(ID, 'primary', 'not even an object');
        await inject(ID, 'backup', corruptEnvelope(ID, 1));
        const loaded = await repo().load(ID);
        expect(loaded.status).toBe('corrupt');
        if (loaded.status !== 'corrupt') return;
        expect(loaded.errors.some((e) => e.startsWith('primary: '))).toBe(true);
        expect(loaded.errors.some((e) => e.startsWith('backup: '))).toBe(true);
        // `corrupt` carries no revision: the caller replaces the data with an unconditional save.
        expect(await repo().save(project)).toMatchObject({ revision: 2 });
        expect(await repo().load(ID)).toMatchObject({ status: 'ok', revision: 2 });
      });

      it('keeps the head revision from a readable envelope with a corrupt payload', async () => {
        const { project } = buildRichProject();
        await repo().save(project);
        await repo().save(project);
        await inject(ID, 'primary', corruptEnvelope(ID, 2));
        await inject(ID, 'backup', undefined);
        expect((await repo().load(ID)).status).toBe('corrupt');
        expect(await repo().save(project, { expectedRevision: 1 })).toEqual({
          status: 'conflict',
          storedRevision: 2,
        });
        expect(await repo().save(project, { expectedRevision: 2 })).toMatchObject({ revision: 3 });
        // The corrupt primary was not promoted to backup.
        await inject(ID, 'primary', undefined);
        expect(await repo().load(ID)).toEqual({ status: 'not-found' });
      });

      it('treats a record stored under the wrong key as corrupt', async () => {
        const { project } = buildRichProject();
        await repo().save(project);
        await inject(ID, 'primary', { id: 'prj_other', revision: 1, savedAt: 'x', data: project });
        await inject(ID, 'backup', {
          id: ID,
          revision: 1,
          savedAt: 'x',
          data: { ...project, id: 'prj_other' },
        });
        const loaded = await repo().load(ID);
        expect(loaded.status).toBe('corrupt');
      });

      it('migrates older stored documents on load', async () => {
        const project = emptyProject();
        const { bpm, loop, ...rest } = project;
        const v0 = {
          ...rest,
          schemaVersion: 0,
          tempo: { bpm },
          loopStart: loop.startTick,
          loopEnd: loop.endTick,
          loopEnabled: loop.enabled,
        };
        await inject(project.id, 'primary', {
          id: project.id,
          revision: 4,
          savedAt: 'x',
          data: v0,
        });
        expect(await repo().load(project.id)).toEqual({
          status: 'ok',
          project,
          revision: 4,
          migratedFrom: 0,
          recoveredFromBackup: false,
        });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// AssetRepository
// ---------------------------------------------------------------------------

export function runAssetRepositoryContract(
  name: string,
  factory: () => MaybePromise<Harness<AssetRepository>>,
): void {
  describe(`AssetRepository contract: ${name}`, () => {
    const harness = useHarness(factory);
    const repo = () => harness().repository;

    it('round-trips bytes and metadata', async () => {
      const record = makeAsset('ast_a', fakeAudioBytes(5000, 3));
      await repo().put(record);
      const loaded = await repo().get(record.meta.id);
      expect(loaded?.meta).toEqual(record.meta);
      expect(loaded?.bytes).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(loaded!.bytes).equals(Buffer.from(record.bytes))).toBe(true);
      expect(await repo().getMeta(record.meta.id)).toEqual(record.meta);
      expect(await repo().has(record.meta.id)).toBe(true);
    });

    it('reports missing assets', async () => {
      const id = asAssetId('ast_missing');
      expect(await repo().get(id)).toBeUndefined();
      expect(await repo().getMeta(id)).toBeUndefined();
      expect(await repo().has(id)).toBe(false);
      expect(await repo().listIds()).toEqual([]);
    });

    it('lists ids in sorted order', async () => {
      for (const id of ['ast_c', 'ast_a', 'ast_b'])
        await repo().put(makeAsset(id, fakeAudioBytes(10)));
      expect(await repo().listIds()).toEqual(['ast_a', 'ast_b', 'ast_c']);
    });

    it('copies on write and on read', async () => {
      const bytes = fakeAudioBytes(100, 9);
      const original = bytes.slice();
      const record = makeAsset('ast_copy', bytes);
      await repo().put(record);
      bytes.fill(0);
      const first = await repo().get(record.meta.id);
      first!.bytes.fill(1);
      const second = await repo().get(record.meta.id);
      expect(Buffer.from(second!.bytes).equals(Buffer.from(original))).toBe(true);
    });

    it('stores exactly the bytes of a view into a larger buffer', async () => {
      const backing = fakeAudioBytes(1000, 4);
      const view = backing.subarray(100, 300);
      await repo().put(makeAsset('ast_view', view));
      const loaded = await repo().get(asAssetId('ast_view'));
      expect(loaded!.bytes.byteLength).toBe(200);
      expect(loaded!.bytes.buffer.byteLength).toBe(200);
      expect(Buffer.from(loaded!.bytes).equals(Buffer.from(view))).toBe(true);
    });

    it('replaces an asset stored under the same id', async () => {
      await repo().put(makeAsset('ast_x', fakeAudioBytes(10, 1)));
      const replacement = makeAsset('ast_x', fakeAudioBytes(20, 2), { name: 'replacement.wav' });
      await repo().put(replacement);
      expect((await repo().get(asAssetId('ast_x')))?.meta).toEqual(replacement.meta);
      expect(await repo().listIds()).toEqual(['ast_x']);
    });

    it('deletes assets (idempotently)', async () => {
      await repo().put(makeAsset('ast_del', fakeAudioBytes(10)));
      await repo().delete(asAssetId('ast_del'));
      expect(await repo().has(asAssetId('ast_del'))).toBe(false);
      expect(await repo().get(asAssetId('ast_del'))).toBeUndefined();
      await expect(repo().delete(asAssetId('ast_del'))).resolves.toBeUndefined();
    });

    it('rejects records whose metadata is invalid or disagrees with the bytes', async () => {
      const record = makeAsset('ast_bad', fakeAudioBytes(10));
      await expect(
        repo().put({ ...record, meta: { ...record.meta, byteLength: 11 } }),
      ).rejects.toMatchObject({
        name: 'InvalidRecordError',
      });
      await expect(
        repo().put({ ...record, meta: { ...record.meta, contentHash: 'nope' } }),
      ).rejects.toMatchObject({
        name: 'InvalidRecordError',
      });
      expect(await repo().has(record.meta.id)).toBe(false);
    });

    it('round-trips a 1 MiB asset', async () => {
      const record = makeAsset('ast_big', fakeAudioBytes(1024 * 1024, 21));
      await repo().put(record);
      const loaded = await repo().get(record.meta.id);
      expect(Buffer.from(loaded!.bytes).equals(Buffer.from(record.bytes))).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// DerivedDataCache
// ---------------------------------------------------------------------------

export function runDerivedCacheContract(
  name: string,
  factory: () => MaybePromise<Harness<DerivedDataCache>>,
): void {
  describe(`DerivedDataCache contract: ${name}`, () => {
    const harness = useHarness(factory);
    const cache = () => harness().repository;

    it('returns undefined for missing keys', async () => {
      expect(await cache().get('peaks:missing:1:-')).toBeUndefined();
    });

    it('stores structured-cloneable values including typed arrays', async () => {
      const value = {
        peaks: new Float32Array([0.1, -0.5, 1]),
        bytes: new Uint8Array([1, 2, 3]),
        nested: { list: [1, 'two', null, true], when: new Date(0) },
        map: new Map([['a', 1]]),
      };
      await cache().put('peaks:abc:1:-', value);
      const loaded = await cache().get<typeof value>('peaks:abc:1:-');
      expect(loaded).toEqual(value);
      expect(loaded?.peaks).toBeInstanceOf(Float32Array);
      expect(loaded?.map).toBeInstanceOf(Map);
      await cache().put('scalar', 42);
      expect(await cache().get('scalar')).toBe(42);
    });

    it('copies on write and on read', async () => {
      const value = { data: new Float32Array([1, 2, 3]) };
      await cache().put('k', value);
      value.data[0] = 99;
      const first = await cache().get<typeof value>('k');
      first!.data[1] = 99;
      expect(Array.from((await cache().get<typeof value>('k'))!.data)).toEqual([1, 2, 3]);
    });

    it('overwrites and deletes', async () => {
      await cache().put('k', 1);
      await cache().put('k', 2);
      expect(await cache().get('k')).toBe(2);
      await cache().delete('k');
      expect(await cache().get('k')).toBeUndefined();
      await expect(cache().delete('k')).resolves.toBeUndefined();
    });

    it('deletes exactly the keys starting with a prefix', async () => {
      const keys = [
        'peaks:aaa:1:-',
        'peaks:aaa:2:-',
        'peaks:aab:1:-',
        'peaksX',
        'pitch:aaa:1:-',
        'a￿',
        'a￿z',
        'b',
      ];
      for (const key of keys) await cache().put(key, key);
      await cache().deleteByPrefix('peaks:aaa:');
      await cache().deleteByPrefix('a￿');
      const remaining: string[] = [];
      for (const key of keys) if ((await cache().get(key)) !== undefined) remaining.push(key);
      expect(remaining).toEqual(['peaks:aab:1:-', 'peaksX', 'pitch:aaa:1:-', 'b']);
      await cache().deleteByPrefix('');
      for (const key of keys) expect(await cache().get(key)).toBeUndefined();
    });

    it('rejects values that cannot be cloned', async () => {
      await expect(cache().put('fn', { f: () => 1 })).rejects.toThrow();
      expect(await cache().get('fn')).toBeUndefined();
    });
  });
}

// ---------------------------------------------------------------------------
// SettingsRepository
// ---------------------------------------------------------------------------

export function runSettingsRepositoryContract(
  name: string,
  factory: () => MaybePromise<Harness<SettingsRepository>>,
): void {
  describe(`SettingsRepository contract: ${name}`, () => {
    const harness = useHarness(factory);
    const settings = () => harness().repository;

    it('gets, sets, overwrites and deletes values', async () => {
      expect(await settings().get('theme')).toBeUndefined();
      await settings().set('theme', 'dark');
      expect(await settings().get('theme')).toBe('dark');
      await settings().set('theme', 'light');
      expect(await settings().get('theme')).toBe('light');
      await settings().delete('theme');
      expect(await settings().get('theme')).toBeUndefined();
      await expect(settings().delete('theme')).resolves.toBeUndefined();
    });

    it('stores structured values as detached copies', async () => {
      const mappings = { global: [{ id: 'map_1', enabled: true }] };
      await settings().set('midi.globalMappings', mappings);
      mappings.global[0]!.enabled = false;
      const loaded = await settings().get<typeof mappings>('midi.globalMappings');
      expect(loaded).toEqual({ global: [{ id: 'map_1', enabled: true }] });
      loaded!.global.pop();
      expect(await settings().get('midi.globalMappings')).toEqual({
        global: [{ id: 'map_1', enabled: true }],
      });
    });
  });
}
