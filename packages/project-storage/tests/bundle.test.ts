import { readFileSync } from 'node:fs';
import { asAssetId } from '@studio/domain';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BundleError,
  DEFAULT_BUNDLE_LIMITS,
  assetBundlePath,
  assetFileExtension,
  checkBundlePath,
  exportProjectBundle,
  importProjectBundle,
  serializeProject,
  stableStringify,
  type BundleErrorCode,
  type BundleLimits,
  type BundleManifest,
} from '../src';
import {
  buildRichProject,
  emptyProject,
  fakeAudioBytes,
  makeAsset,
  sha256,
  sha256Hex,
} from './fixtures';

const deps = { sha256 };

type Files = Record<string, Uint8Array>;

async function richBundle() {
  const fixture = buildRichProject();
  const bytes = await exportProjectBundle(fixture, deps);
  return { ...fixture, bytes };
}

const unzip = (bytes: Uint8Array): Files => unzipSync(bytes);
const readManifest = (files: Files) =>
  JSON.parse(strFromU8(files['manifest.json']!)) as BundleManifest;

/** Re-zips `files`, regenerating manifest entries from the actual content unless told otherwise. */
function rezip(
  files: Files,
  options: { manifest?: (m: BundleManifest) => unknown; keepManifest?: boolean } = {},
) {
  const out: Files = { ...files };
  if (!options.keepManifest) {
    const base = readManifest(files);
    const entries = Object.keys(files)
      .filter((p) => p !== 'manifest.json')
      .map((path) => ({ path, size: files[path]!.byteLength, sha256: sha256Hex(files[path]!) }));
    const manifest = { ...base, entries };
    out['manifest.json'] = strToU8(
      stableStringify(options.manifest ? options.manifest(manifest) : manifest),
    );
  }
  return zipSync(out, { mtime: new Date(1980, 0, 1, 12) });
}

async function expectBundleError(
  bytes: Uint8Array,
  code: BundleErrorCode,
  limits?: Partial<BundleLimits>,
  message?: RegExp,
) {
  const result = await importProjectBundle(bytes, deps, limits);
  expect(result.ok).toBe(false);
  if (result.ok) return undefined;
  expect(result.error).toBeInstanceOf(BundleError);
  expect({ code: result.error.code, message: result.error.message }).toMatchObject({ code });
  if (message) expect(result.error.message).toMatch(message);
  return result.error;
}

/** Locates the central-directory header of `name` (fflate reads names and sizes from there). */
function centralHeaderOffset(zip: Uint8Array, name: string): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const target = strToU8(name);
  for (let i = 0; i + 46 < zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(i + 28, true);
    const candidate = zip.subarray(i + 46, i + 46 + nameLength);
    if (nameLength === target.length && candidate.every((b, k) => b === target[k])) return i;
  }
  throw new Error(`central header for ${name} not found`);
}

describe('exportProjectBundle', () => {
  it('writes manifest.json, project.json and one file per referenced asset', async () => {
    const { project, bytes } = await richBundle();
    const files = unzip(bytes);
    expect(Object.keys(files)).toEqual([
      'manifest.json',
      'project.json',
      'assets/ast_kick.wav',
      'assets/ast_loop.ogg',
      'assets/ast_vocal.mp3',
    ]);
    const manifest = readManifest(files);
    expect(manifest).toMatchObject({
      format: 'studio.bundle',
      formatVersion: 1,
      schemaVersion: 1,
      createdAt: project.updatedAt,
    });
    expect(manifest.entries.map((e) => e.path)).toEqual(Object.keys(files).slice(1));
    for (const entry of manifest.entries) {
      expect(entry.size).toBe(files[entry.path]!.byteLength);
      expect(entry.sha256).toBe(sha256Hex(files[entry.path]!));
    }
    expect(strFromU8(files['project.json']!)).toBe(serializeProject(project));
  });

  it('includes only assets referenced by the project', async () => {
    const fixture = buildRichProject();
    const stray = makeAsset('ast_stray', fakeAudioBytes(64, 99));
    const bytes = await exportProjectBundle(
      { ...fixture, assets: [...fixture.assets, stray] },
      deps,
    );
    expect(Object.keys(unzip(bytes))).not.toContain('assets/ast_stray.wav');
  });

  it('is deterministic for identical input (independent of asset order)', async () => {
    const fixture = buildRichProject();
    const a = await exportProjectBundle(fixture, deps);
    const b = await exportProjectBundle(
      { ...fixture, assets: [...fixture.assets].reverse() },
      deps,
    );
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('refuses to export a project whose referenced asset is missing', async () => {
    const fixture = buildRichProject();
    await expect(
      exportProjectBundle({ ...fixture, assets: fixture.assets.slice(1) }, deps),
    ).rejects.toMatchObject({
      code: 'missing-entry',
    });
  });

  it('refuses to export assets whose bytes do not match their metadata', async () => {
    const fixture = buildRichProject();
    const [first, ...rest] = fixture.assets;
    const tampered = first!.bytes.slice();
    tampered[0] = tampered[0]! ^ 0xff;
    await expect(
      exportProjectBundle({ ...fixture, assets: [{ ...first!, bytes: tampered }, ...rest] }, deps),
    ).rejects.toMatchObject({ code: 'asset-mismatch' });
    await expect(
      exportProjectBundle(
        { ...fixture, assets: [{ ...first!, bytes: tampered.subarray(1) }, ...rest] },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'asset-mismatch' });
  });

  it('refuses to export an invalid project', async () => {
    const project = { ...emptyProject(), bpm: 1 };
    await expect(exportProjectBundle({ project, assets: [] }, deps)).rejects.toMatchObject({
      name: 'ProjectValidationError',
    });
  });
});

describe('importProjectBundle: round trip', () => {
  it('restores the project and binary assets exactly', async () => {
    const { project, assets, bytes } = await richBundle();
    const result = await importProjectBundle(bytes, deps);
    if (!result.ok) throw result.error;
    expect(result.value.project).toEqual(project);
    const byId = new Map(assets.map((a) => [a.meta.id, a]));
    expect(result.value.assets.map((a) => a.meta.id)).toEqual([
      'ast_kick',
      'ast_loop',
      'ast_vocal',
    ]);
    for (const asset of result.value.assets) {
      const original = byId.get(asset.meta.id)!;
      expect(asset.meta).toEqual(original.meta);
      expect(Buffer.from(asset.bytes).equals(Buffer.from(original.bytes))).toBe(true);
    }
  });

  it('round-trips a project without assets', async () => {
    const project = emptyProject();
    const result = await importProjectBundle(
      await exportProjectBundle({ project, assets: [] }, deps),
      deps,
    );
    expect(result.ok && result.value).toEqual({ project, assets: [] });
  });

  it('migrates an older project.json and checks it against manifest.schemaVersion', async () => {
    const v0 = readFileSync(new URL('./fixtures/project-v0.json', import.meta.url));
    const v0Doc = JSON.parse(v0.toString('utf8')) as {
      assets: Record<string, { byteLength: number }>;
    };
    // Recreate the asset the fixture references (its hash is of 1024 zero bytes).
    const assetBytes = new Uint8Array(v0Doc.assets['ast_drumloop']!.byteLength);
    const files: Files = {
      'manifest.json': strToU8(
        stableStringify({
          format: 'studio.bundle',
          formatVersion: 1,
          schemaVersion: 0,
          createdAt: 'x',
          entries: [],
        }),
      ),
      'project.json': new Uint8Array(v0),
      'assets/ast_drumloop.wav': assetBytes,
    };
    const result = await importProjectBundle(rezip(files), deps);
    if (!result.ok) throw result.error;
    expect(result.value.project.bpm).toBe(92);
    expect(result.value.assets).toHaveLength(1);

    const mismatched = rezip(files, { manifest: (m) => ({ ...m, schemaVersion: 1 }) });
    await expectBundleError(
      mismatched,
      'invalid-manifest',
      undefined,
      /schemaVersion 1 does not match/,
    );
  });
});

describe('importProjectBundle: integrity failures', () => {
  it('rejects a tampered project.json (checksum mismatch)', async () => {
    const files = unzip((await richBundle()).bytes);
    const text = strFromU8(files['project.json']!).replace('Rich ✓ project', 'Rich ✗ project');
    files['project.json'] = strToU8(text);
    const error = await expectBundleError(
      rezip(files, { keepManifest: true }),
      'checksum-mismatch',
    );
    expect(error?.path).toBe('project.json');
  });

  it('rejects a tampered asset of the same size (checksum mismatch)', async () => {
    const files = unzip((await richBundle()).bytes);
    const asset = files['assets/ast_kick.wav']!;
    asset[100] = asset[100]! ^ 1;
    await expectBundleError(rezip(files, { keepManifest: true }), 'checksum-mismatch');
  });

  it('rejects entries whose size differs from the manifest', async () => {
    const files = unzip((await richBundle()).bytes);
    files['assets/ast_kick.wav'] = files['assets/ast_kick.wav']!.subarray(1);
    await expectBundleError(rezip(files, { keepManifest: true }), 'size-mismatch');
  });

  it('rejects a bundle missing a referenced asset', async () => {
    const files = unzip((await richBundle()).bytes);
    delete files['assets/ast_vocal.mp3'];
    // Manifest regenerated without it: caught by the project → asset check.
    await expectBundleError(rezip(files), 'missing-entry', undefined, /ast_vocal is referenced/);
    // Manifest still lists it: caught by the manifest → archive check.
    await expectBundleError(
      rezip(files, { keepManifest: true }),
      'missing-entry',
      undefined,
      /missing from the archive/,
    );
  });

  it('rejects files that are not listed in the manifest', async () => {
    const files = unzip((await richBundle()).bytes);
    const manifestOnly = rezip(files);
    const extra = unzip(manifestOnly);
    extra['assets/ast_extra.wav'] = new Uint8Array(4);
    await expectBundleError(
      rezip(extra, { keepManifest: true }),
      'unexpected-entry',
      undefined,
      /not listed/,
    );
  });

  it('rejects listed assets that the project does not reference', async () => {
    const files = unzip((await richBundle()).bytes);
    files['assets/ast_extra.wav'] = new Uint8Array(4);
    await expectBundleError(
      rezip(files),
      'unexpected-entry',
      undefined,
      /not an asset of this project/,
    );
  });

  it('rejects entries outside the bundle layout', async () => {
    const files = unzip((await richBundle()).bytes);
    files['notes.txt'] = strToU8('hello');
    await expectBundleError(rezip(files), 'unexpected-entry');
    const nested = unzip((await richBundle()).bytes);
    nested['assets/sub/x.wav'] = new Uint8Array(1);
    await expectBundleError(rezip(nested), 'unexpected-entry');
  });

  it.each([
    ['../x'],
    ['/abs'],
    ['a\\b'],
    ['assets/../project.json'],
    ['C:/x'],
    ['assets//x.wav'],
    ['dir/'],
  ])('rejects the unsafe archive path %s', async (path) => {
    const files = unzip((await richBundle()).bytes);
    files[path] = new Uint8Array(1);
    const error = await expectBundleError(rezip(files, { keepManifest: true }), 'unsafe-path');
    expect(error?.path).toBe(path);
  });

  it('rejects unsafe paths listed in the manifest', async () => {
    const files = unzip((await richBundle()).bytes);
    const bytes = rezip(files, {
      manifest: (m) => ({
        ...m,
        entries: [...m.entries, { path: '../evil', size: 0, sha256: 'a'.repeat(64) }],
      }),
    });
    await expectBundleError(bytes, 'unsafe-path');
  });

  it('rejects duplicate manifest entries', async () => {
    const files = unzip((await richBundle()).bytes);
    const bytes = rezip(files, {
      manifest: (m) => ({ ...m, entries: [...m.entries, m.entries[0]] }),
    });
    await expectBundleError(bytes, 'duplicate-entry');
  });

  it('rejects duplicate archive entries', async () => {
    const files = unzip((await richBundle()).bytes);
    files['assets/ast_kicl.wav'] = files['assets/ast_kick.wav']!.slice();
    const zip = rezip(files);
    const offset = centralHeaderOffset(zip, 'assets/ast_kicl.wav');
    zip.set(strToU8('assets/ast_kick.wav'), offset + 46);
    await expectBundleError(zip, 'duplicate-entry');
  });

  it('rejects invalid JSON in project.json and manifest.json', async () => {
    const files = unzip((await richBundle()).bytes);
    files['project.json'] = strToU8('{"id": "prj_rich",');
    await expectBundleError(
      rezip(files),
      'invalid-json',
      undefined,
      /project\.json is not valid JSON/,
    );
    const broken = unzip((await richBundle()).bytes);
    broken['manifest.json'] = strToU8('not json');
    await expectBundleError(
      rezip(broken, { keepManifest: true }),
      'invalid-json',
      undefined,
      /manifest\.json/,
    );
  });

  it('rejects malformed manifests and foreign or newer formats', async () => {
    const files = unzip((await richBundle()).bytes);
    await expectBundleError(
      rezip(files, { manifest: ({ entries: _e, ...m }) => m }),
      'invalid-manifest',
    );
    await expectBundleError(
      rezip(files, {
        manifest: (m) => ({ ...m, entries: m.entries.map((e) => ({ ...e, size: -1 })) }),
      }),
      'invalid-manifest',
    );
    await expectBundleError(
      rezip(files, { manifest: (m) => ({ ...m, format: 'other.zip' }) }),
      'unsupported-format',
    );
    await expectBundleError(
      rezip(files, { manifest: (m) => ({ ...m, formatVersion: 2 }) }),
      'unsupported-format',
      undefined,
      /newer than supported/,
    );
    await expectBundleError(rezip(files, { manifest: () => [1, 2] }), 'invalid-manifest');
    delete files['manifest.json'];
    await expectBundleError(zipSync(files), 'missing-entry', undefined, /no manifest/);
  });

  it('rejects a bundle without project.json', async () => {
    const files = unzip((await richBundle()).bytes);
    delete files['project.json'];
    await expectBundleError(rezip(files), 'missing-entry', undefined, /no project\.json/);
  });

  it('rejects asset metadata inconsistent with the bundled bytes', async () => {
    const files = unzip((await richBundle()).bytes);
    const project = JSON.parse(strFromU8(files['project.json']!)) as {
      assets: Record<string, { byteLength: number; contentHash: string }>;
    };
    project.assets['ast_kick']!.byteLength += 1;
    files['project.json'] = strToU8(stableStringify(project));
    await expectBundleError(rezip(files), 'asset-mismatch', undefined, /metadata says 2049/);

    const other = unzip((await richBundle()).bytes);
    const project2 = JSON.parse(strFromU8(other['project.json']!)) as typeof project;
    project2.assets['ast_kick']!.contentHash = 'b'.repeat(64);
    other['project.json'] = strToU8(stableStringify(project2));
    await expectBundleError(rezip(other), 'asset-mismatch', undefined, /contentHash/);
  });

  it('rejects an invalid project with validation issues attached', async () => {
    const files = unzip((await richBundle()).bytes);
    const project = JSON.parse(strFromU8(files['project.json']!)) as { bpm: number };
    project.bpm = 1000;
    files['project.json'] = strToU8(stableStringify(project));
    const error = await expectBundleError(rezip(files), 'invalid-project');
    expect(error?.issues.map((i) => i.path)).toContain('bpm');
  });

  it('rejects bytes that are not a zip archive', async () => {
    await expectBundleError(new Uint8Array(0), 'invalid-archive');
    await expectBundleError(fakeAudioBytes(512), 'invalid-archive');
    await expectBundleError('PK' as unknown as Uint8Array, 'invalid-archive');
  });

  it('rejects unsupported compression methods', async () => {
    const zip = (await richBundle()).bytes.slice();
    const offset = centralHeaderOffset(zip, 'project.json');
    new DataView(zip.buffer).setUint16(offset + 10, 14, true); // LZMA
    await expectBundleError(zip, 'invalid-archive', undefined, /unsupported compression 14/);
  });
});

describe('importProjectBundle: limits', () => {
  it('has the documented defaults', () => {
    expect(DEFAULT_BUNDLE_LIMITS.maxTotalUncompressedBytes).toBe(2 * 1024 ** 3);
  });

  it('rejects entries larger than maxEntryBytes', async () => {
    const big = makeAsset('ast_big', fakeAudioBytes(8192, 5));
    const project = { ...emptyProject(), assets: { [big.meta.id]: big.meta } };
    const bytes = await exportProjectBundle({ project, assets: [big] }, deps);
    expect((await importProjectBundle(bytes, deps, { maxEntryBytes: 8192 })).ok).toBe(true);
    await expectBundleError(
      bytes,
      'limit-exceeded',
      { maxEntryBytes: 8191 },
      /assets\/ast_big\.wav/,
    );
  });

  it('rejects bundles expanding beyond maxTotalUncompressedBytes', async () => {
    const { bytes } = await richBundle();
    await expectBundleError(
      bytes,
      'limit-exceeded',
      { maxTotalUncompressedBytes: 6000 },
      /expands to more than/,
    );
  });

  it('rejects JSON entries larger than maxJsonBytes', async () => {
    const { bytes } = await richBundle();
    await expectBundleError(bytes, 'limit-exceeded', { maxJsonBytes: 1000 }, /JSON entry/);
  });

  it('rejects bundles with too many entries', async () => {
    const { bytes } = await richBundle();
    await expectBundleError(bytes, 'limit-exceeded', { maxEntries: 4 }, /more than 4 entries/);
  });

  it('does not trust declared sizes: a huge declared size is rejected before inflating', async () => {
    const zip = (await richBundle()).bytes.slice();
    const offset = centralHeaderOffset(zip, 'assets/ast_kick.wav');
    new DataView(zip.buffer).setUint32(offset + 24, 0xfffffff0, true); // uncompressed size
    await expectBundleError(zip, 'limit-exceeded');
  });

  it('does not trust declared sizes: an understated size cannot smuggle extra data (zip bomb)', async () => {
    const project = emptyProject();
    const bomb = new Uint8Array(8 * 1024 * 1024); // compresses to a few KiB
    const files: Files = {
      'manifest.json': strToU8(
        stableStringify({
          format: 'studio.bundle',
          formatVersion: 1,
          schemaVersion: 1,
          createdAt: 'x',
          entries: [],
        }),
      ),
      'project.json': strToU8(serializeProject(project)),
      'assets/ast_bomb.wav': bomb,
    };
    const zip = rezip(files);
    expect(zip.byteLength).toBeLessThan(100_000);
    const offset = centralHeaderOffset(zip, 'assets/ast_bomb.wav');
    new DataView(zip.buffer).setUint32(offset + 24, 1024, true); // claims 1 KiB
    // Within limits as declared; extraction is capped at the declared size, so the
    // manifest size check fails instead of 8 MiB being materialized.
    await expectBundleError(zip, 'size-mismatch', { maxEntryBytes: 4096 });
  });
});

describe('paths and extensions', () => {
  it('accepts layout paths and rejects unsafe ones', () => {
    expect(checkBundlePath('assets/ast_1.wav')).toBeUndefined();
    expect(checkBundlePath('')).toMatch(/empty/);
    expect(checkBundlePath('a'.repeat(256))).toMatch(/longer/);
    expect(checkBundlePath('a\u0000b')).toMatch(/control/);
    expect(checkBundlePath('./a')).toMatch(/relative/);
  });

  it('maps MIME types to extensions', () => {
    expect(assetFileExtension('audio/wav')).toBe('wav');
    expect(assetFileExtension('Audio/WebM; codecs=opus')).toBe('webm');
    expect(assetFileExtension('application/x-unknown')).toBe('bin');
    expect(assetBundlePath({ id: asAssetId('ast_1'), mimeType: 'audio/mpeg' })).toBe(
      'assets/ast_1.mp3',
    );
  });
});
