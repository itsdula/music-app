import { asProjectId } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  DataCloneError,
  StorageQuotaError,
  cloneStructured,
  createMemoryAssetRepository,
  createMemoryProjectRepository,
  derivedCacheKey,
  derivedCachePrefix,
  headRevision,
  parseDerivedCacheKey,
  readStoredRecord,
} from '../src';
import { emptyProject, fakeAudioBytes, makeAsset } from './fixtures';

describe('memory repositories: host-specific options', () => {
  it('uses the injected clock for savedAt', async () => {
    const repo = createMemoryProjectRepository({ now: () => '2031-05-05T05:05:05.000Z' });
    expect(await repo.save(emptyProject())).toEqual({
      status: 'saved',
      revision: 1,
      savedAt: '2031-05-05T05:05:05.000Z',
    });
  });

  it('simulates a storage quota for assets (replacements count only once)', async () => {
    const repo = createMemoryAssetRepository({ quotaBytes: 1000 });
    await repo.put(makeAsset('ast_a', fakeAudioBytes(600, 1)));
    await repo.put(makeAsset('ast_a', fakeAudioBytes(900, 2))); // replaces: 900 total
    await expect(repo.put(makeAsset('ast_b', fakeAudioBytes(200, 3)))).rejects.toBeInstanceOf(
      StorageQuotaError,
    );
    expect(await repo.listIds()).toEqual(['ast_a']);
    await repo.put(makeAsset('ast_b', fakeAudioBytes(100, 3)));
    expect(await repo.listIds()).toEqual(['ast_a', 'ast_b']);
  });

  it('rejects asset records without Uint8Array bytes', async () => {
    const repo = createMemoryAssetRepository();
    const record = makeAsset('ast_a', fakeAudioBytes(4));
    await expect(
      repo.put({ ...record, bytes: [1, 2, 3, 4] as unknown as Uint8Array }),
    ).rejects.toMatchObject({ name: 'InvalidRecordError' });
  });
});

describe('stored record helpers', () => {
  it('derives the head revision from whichever envelope is readable', () => {
    expect(headRevision({ revision: 3 }, { revision: 2 })).toBe(3);
    expect(headRevision({ revision: 'x' }, { revision: 2 })).toBe(2);
    expect(headRevision(undefined, undefined)).toBe(0);
    expect(headRevision({ revision: 0 }, null)).toBe(0);
  });

  it('rejects malformed envelopes with a reason', () => {
    const id = 'prj_1';
    expect(readStoredRecord(id, null)).toEqual({ ok: false, errors: ['record is not an object'] });
    expect(readStoredRecord(id, { id, revision: 1.5, data: {} })).toEqual({
      ok: false,
      errors: ['record revision is not a positive integer'],
    });
    const project = emptyProject();
    expect(
      readStoredRecord(id, { id, revision: 1, savedAt: 'x', data: { ...project, id: 'prj_2' } }),
    ).toEqual({ ok: false, errors: ['project id does not match the record key'] });
    const loaded = readStoredRecord(id, { id, revision: 1, savedAt: 'x', data: project });
    expect(loaded.ok).toBe(true);
    expect(asProjectId(id)).toBe(project.id);
  });
});

describe('cloneStructured', () => {
  it('deep-copies plain data, typed arrays, buffers, dates, maps and sets', () => {
    const buffer = new ArrayBuffer(8);
    const shared = new Uint8Array(buffer, 2, 4);
    const value = {
      n: 1,
      s: 'x',
      nil: null,
      list: [1, { deep: true }],
      f32: new Float32Array([1.5, 2.5]),
      i16: new Int16Array([-1, 2]),
      view: new DataView(buffer, 1, 3),
      shared,
      sameBufferAgain: new Uint8Array(buffer),
      buffer,
      date: new Date(1234),
      map: new Map<string, unknown>([['k', { v: 1 }]]),
      set: new Set([1, 2]),
    };
    const copy = cloneStructured(value);
    expect(copy).toEqual(value);
    expect(copy.f32).not.toBe(value.f32);
    expect(copy.list[1]).not.toBe(value.list[1]);
    expect(copy.view).toBeInstanceOf(DataView);
    expect(copy.view.byteOffset).toBe(1);
    expect(copy.shared.byteOffset).toBe(2);
    // Views over one buffer keep sharing one (copied) buffer, as structured clone does.
    expect(copy.shared.buffer).toBe(copy.sameBufferAgain.buffer);
    expect(copy.shared.buffer).toBe(copy.buffer);
    expect(copy.buffer).not.toBe(buffer);
    expect(copy.date.getTime()).toBe(1234);
    expect(copy.map.get('k')).toEqual({ v: 1 });
  });

  it('preserves cycles and drops prototypes like structured clone', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const node: { self?: unknown; point: Point } = { point: new Point(1, 2) };
    node.self = node;
    const copy = cloneStructured(node);
    expect(copy.self).toBe(copy);
    expect(copy.point).toEqual({ x: 1, y: 2 });
    expect(copy.point).not.toBeInstanceOf(Point);
  });

  it('rejects functions and symbols', () => {
    expect(() => cloneStructured({ f: () => 1 })).toThrow(DataCloneError);
    expect(() => cloneStructured([Symbol('s')])).toThrow(DataCloneError);
  });
});

describe('derived cache keys', () => {
  const hash = 'a'.repeat(64);

  it('builds and parses <kind>:<contentHash>:<algorithmVersion>:<paramsHash>', () => {
    const key = derivedCacheKey({
      kind: 'peaks',
      contentHash: hash,
      algorithmVersion: '2',
      paramsHash: '-',
    });
    expect(key).toBe(`peaks:${hash}:2:-`);
    expect(parseDerivedCacheKey(key)).toEqual({
      kind: 'peaks',
      contentHash: hash,
      algorithmVersion: '2',
      paramsHash: '-',
    });
  });

  it('builds prefixes for sweeping by kind or by source', () => {
    expect(derivedCachePrefix('pitch')).toBe('pitch:');
    expect(derivedCachePrefix('pitch', hash)).toBe(`pitch:${hash}:`);
  });

  it('rejects segments that would break the key structure', () => {
    expect(() =>
      derivedCacheKey({ kind: 'a:b', contentHash: hash, algorithmVersion: '1', paramsHash: '-' }),
    ).toThrow(RangeError);
    expect(() => derivedCachePrefix('')).toThrow(RangeError);
    expect(parseDerivedCacheKey('peaks:only-two')).toBeUndefined();
    expect(parseDerivedCacheKey('a:b:c:d e')).toBeUndefined();
  });
});
