/**
 * Portable project bundles (`.studio` files): a ZIP archive holding the project
 * JSON, every referenced audio asset and a manifest with sizes and SHA-256 digests.
 *
 *   manifest.json          format id, versions, createdAt, entries[{path,size,sha256}]
 *   project.json           serializeProject(project) — stable JSON
 *   assets/<assetId>.<ext> encoded asset bytes exactly as stored
 *
 * Imported bundles are untrusted: every limit is enforced from the archive's
 * directory *before* anything is decompressed, nothing in the manifest is believed
 * without being checked against the actual bytes, and the project passes the full
 * `parseProject` pipeline. See docs/persistence.md §Bundles for the specification.
 */
import { err, ok, type AssetId, type AssetRef, type Project, type Result } from '@studio/domain';
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import { z } from 'zod';
import type { ValidationIssue } from './errors';
import { isJsonRecord } from './migrations';
import { parseProject, zodIssuesToValidationIssues } from './parse';
import { validateProjectForSave } from './project-records';
import type { AssetRecord } from './repositories';
import { ENTITY_ID_PATTERN, SCHEMA_LIMITS, SHA256_HEX_PATTERN } from './schema';
import { serializeProject, stableStringify } from './serialize';

export const BUNDLE_FORMAT = 'studio.bundle';
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_FILE_EXTENSION = '.studio';
export const BUNDLE_MIME_TYPE = 'application/vnd.studio.bundle+zip';

export const MANIFEST_PATH = 'manifest.json';
export const PROJECT_PATH = 'project.json';

const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;

export interface BundleLimits {
  /** Sum of all entries' uncompressed sizes. */
  readonly maxTotalUncompressedBytes: number;
  /** Number of archive entries (manifest + project + assets). */
  readonly maxEntries: number;
  /** Uncompressed size of any single entry. */
  readonly maxEntryBytes: number;
  /** Uncompressed size of each JSON entry (manifest.json, project.json). */
  readonly maxJsonBytes: number;
}

export const DEFAULT_BUNDLE_LIMITS: BundleLimits = {
  maxTotalUncompressedBytes: 2 * GiB,
  maxEntries: SCHEMA_LIMITS.assets + 2,
  maxEntryBytes: 2 * GiB,
  maxJsonBytes: 64 * MiB,
};

export type BundleErrorCode =
  | 'invalid-archive'
  | 'limit-exceeded'
  | 'unsafe-path'
  | 'duplicate-entry'
  | 'unexpected-entry'
  | 'missing-entry'
  | 'size-mismatch'
  | 'checksum-mismatch'
  | 'invalid-json'
  | 'invalid-manifest'
  | 'unsupported-format'
  | 'invalid-project'
  | 'asset-mismatch';

export class BundleError extends Error {
  override readonly name = 'BundleError';
  readonly code: BundleErrorCode;
  /** Archive path the problem concerns, when there is one. */
  readonly path: string | undefined;
  /** Validation details for `invalid-manifest` / `invalid-project`. */
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: BundleErrorCode,
    message: string,
    details: { readonly path?: string; readonly issues?: readonly ValidationIssue[] } = {},
  ) {
    super(message);
    this.code = code;
    this.path = details.path;
    this.issues = details.issues ?? [];
  }
}

export interface BundleDeps {
  /** Lower-case hex SHA-256 (e.g. `PlatformServices.hasher.sha256`). */
  readonly sha256: (bytes: Uint8Array) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const MAX_PATH_LENGTH = 255;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const ASSET_PATH = new RegExp(
  `^assets/(${ENTITY_ID_PATTERN.source.slice(1, -1)})\\.([a-z0-9]{1,8})$`,
);

/** Returns why `path` is unsafe as an archive member name, or undefined when it is safe. */
export function checkBundlePath(path: string): string | undefined {
  if (path.length === 0) return 'empty path';
  if (path.length > MAX_PATH_LENGTH) return `path longer than ${MAX_PATH_LENGTH} characters`;
  if (path.includes('\\')) return 'backslashes are not allowed';
  if (path.startsWith('/')) return 'absolute paths are not allowed';
  if (/^[A-Za-z]:/.test(path)) return 'drive-letter paths are not allowed';
  if (CONTROL_CHARS.test(path)) return 'control characters are not allowed';
  for (const segment of path.split('/')) {
    if (segment === '') return 'empty path segments (or directory entries) are not allowed';
    if (segment === '.' || segment === '..') return 'relative path segments are not allowed';
  }
  return undefined;
}

const isLayoutPath = (path: string) =>
  path === MANIFEST_PATH || path === PROJECT_PATH || ASSET_PATH.test(path);

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/vnd.wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/aiff': 'aiff',
  'audio/x-aiff': 'aiff',
};

/** Already-compressed formats are stored; PCM formats are deflated. */
const DEFLATE_EXTENSIONS = new Set(['wav', 'aiff', 'bin']);

/** File extension used for an asset inside a bundle (`bin` for unknown MIME types). */
export function assetFileExtension(mimeType: string): string {
  const essence = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_EXTENSIONS[essence] ?? 'bin';
}

export function assetBundlePath(meta: Pick<AssetRef, 'id' | 'mimeType'>): string {
  return `assets/${meta.id}.${assetFileExtension(meta.mimeType)}`;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export interface BundleManifestEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface BundleManifest {
  readonly format: typeof BUNDLE_FORMAT;
  readonly formatVersion: number;
  /** Schema version of project.json as written. */
  readonly schemaVersion: number;
  /** The project's `updatedAt` (keeps output deterministic). */
  readonly createdAt: string;
  /** Every archive member except manifest.json, in archive order. */
  readonly entries: readonly BundleManifestEntry[];
}

const ManifestSchema = z.strictObject({
  format: z.literal(BUNDLE_FORMAT),
  formatVersion: z.literal(BUNDLE_FORMAT_VERSION),
  schemaVersion: z.int().min(0),
  createdAt: z.string().max(64),
  entries: z
    .array(
      z.strictObject({
        path: z.string().min(1).max(MAX_PATH_LENGTH),
        size: z.int().min(0),
        sha256: z.string().regex(SHA256_HEX_PATTERN, 'must be a lower-case hex SHA-256 digest'),
      }),
    )
    .max(SCHEMA_LIMITS.assets + 1),
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Fixed modification time for every archive member, built from local-time fields
 * because ZIP stores local DOS time: the output is identical in every time zone.
 */
const ZIP_MTIME = new Date(1980, 0, 1, 12, 0, 0);

async function hashHex(deps: BundleDeps, bytes: Uint8Array): Promise<string> {
  return (await deps.sha256(bytes)).toLowerCase();
}

/**
 * Builds a `.studio` bundle. Includes exactly the assets listed in `project.assets`
 * (extra records are ignored) and verifies each against its metadata first.
 * Throws {@link BundleError} (`missing-entry`, `asset-mismatch`) or
 * `ProjectValidationError` when the input could not produce an importable bundle.
 * Output is deterministic for identical input.
 */
export async function exportProjectBundle(
  input: { readonly project: Project; readonly assets: readonly AssetRecord[] },
  deps: BundleDeps,
): Promise<Uint8Array> {
  const project = validateProjectForSave(input.project);
  const records = new Map<string, AssetRecord>();
  for (const record of input.assets) records.set(record.meta.id, record);

  const projectBytes = strToU8(serializeProject(project));
  const files: { path: string; bytes: Uint8Array; sha256: string; level: 0 | 6 }[] = [
    {
      path: PROJECT_PATH,
      bytes: projectBytes,
      sha256: await hashHex(deps, projectBytes),
      level: 6,
    },
  ];
  for (const id of Object.keys(project.assets).sort()) {
    const ref = project.assets[id as AssetId]!;
    const record = records.get(id);
    const path = assetBundlePath(ref);
    if (!record)
      throw new BundleError('missing-entry', `asset ${id} is referenced but was not provided`, {
        path,
      });
    if (record.bytes.byteLength !== ref.byteLength) {
      throw new BundleError(
        'asset-mismatch',
        `asset ${id} has ${record.bytes.byteLength} bytes but its metadata says ${ref.byteLength}`,
        { path },
      );
    }
    const digest = await hashHex(deps, record.bytes);
    if (digest !== ref.contentHash) {
      throw new BundleError('asset-mismatch', `asset ${id} bytes do not match its contentHash`, {
        path,
      });
    }
    const ext = assetFileExtension(ref.mimeType);
    files.push({
      path,
      bytes: record.bytes,
      sha256: digest,
      level: DEFLATE_EXTENSIONS.has(ext) ? 6 : 0,
    });
  }

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    schemaVersion: project.schemaVersion,
    createdAt: project.updatedAt,
    entries: files.map((f) => ({ path: f.path, size: f.bytes.byteLength, sha256: f.sha256 })),
  };

  const zippable: Zippable = {
    [MANIFEST_PATH]: [strToU8(stableStringify(manifest)), { level: 6 }],
  };
  for (const file of files) zippable[file.path] = [file.bytes, { level: file.level }];
  return zipSync(zippable, { mtime: ZIP_MTIME });
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** Thrown from inside fflate's entry filter to stop extraction immediately. */
class AbortExtraction extends Error {
  constructor(readonly error: BundleError) {
    super(error.message);
  }
}

function extract(bytes: Uint8Array, limits: BundleLimits): Result<Unzipped, BundleError> {
  const seen = new Set<string>();
  let total = 0;
  const abort = (code: BundleErrorCode, message: string, path?: string): never => {
    throw new AbortExtraction(new BundleError(code, message, path === undefined ? {} : { path }));
  };
  try {
    const files = unzipSync(bytes, {
      filter(info) {
        const path = info.name;
        if (seen.size >= limits.maxEntries) {
          abort('limit-exceeded', `bundle has more than ${limits.maxEntries} entries`);
        }
        const unsafe = checkBundlePath(path);
        if (unsafe !== undefined)
          abort('unsafe-path', `unsafe entry path "${path}": ${unsafe}`, path);
        if (seen.has(path)) abort('duplicate-entry', `duplicate entry "${path}"`, path);
        seen.add(path);
        if (!isLayoutPath(path)) abort('unexpected-entry', `unexpected entry "${path}"`, path);
        if (info.compression !== 0 && info.compression !== 8) {
          abort(
            'invalid-archive',
            `entry "${path}" uses unsupported compression ${info.compression}`,
            path,
          );
        }
        // Stored entries are copied as-is (compressed size); deflated entries are
        // inflated into a buffer of exactly the declared size, so these bounds hold.
        const size = info.compression === 0 ? info.size : info.originalSize;
        if (size > limits.maxEntryBytes) {
          abort(
            'limit-exceeded',
            `entry "${path}" is larger than ${limits.maxEntryBytes} bytes`,
            path,
          );
        }
        if (path.endsWith('.json') && size > limits.maxJsonBytes) {
          abort(
            'limit-exceeded',
            `JSON entry "${path}" is larger than ${limits.maxJsonBytes} bytes`,
            path,
          );
        }
        total += size;
        if (total > limits.maxTotalUncompressedBytes) {
          abort(
            'limit-exceeded',
            `bundle expands to more than ${limits.maxTotalUncompressedBytes} bytes`,
            path,
          );
        }
        return true;
      },
    });
    return ok(files);
  } catch (error) {
    if (error instanceof AbortExtraction) return err(error.error);
    const detail = error instanceof Error ? error.message : String(error);
    return err(new BundleError('invalid-archive', `not a valid bundle archive: ${detail}`));
  }
}

function decodeJson(bytes: Uint8Array, path: string): Result<unknown, BundleError> {
  try {
    return ok(JSON.parse(strFromU8(bytes)) as unknown);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err(new BundleError('invalid-json', `${path} is not valid JSON: ${detail}`, { path }));
  }
}

function readManifest(raw: unknown): Result<BundleManifest, BundleError> {
  if (isJsonRecord(raw)) {
    if (raw['format'] !== BUNDLE_FORMAT) {
      return err(
        new BundleError(
          'unsupported-format',
          `not a Studio bundle (format ${JSON.stringify(raw['format'])})`,
          {
            path: MANIFEST_PATH,
          },
        ),
      );
    }
    const version = raw['formatVersion'];
    if (
      typeof version === 'number' &&
      Number.isInteger(version) &&
      version > BUNDLE_FORMAT_VERSION
    ) {
      return err(
        new BundleError(
          'unsupported-format',
          `bundle format version ${version} is newer than supported (${BUNDLE_FORMAT_VERSION}); update Studio to open it`,
          { path: MANIFEST_PATH },
        ),
      );
    }
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return err(
      new BundleError('invalid-manifest', 'manifest.json is malformed', {
        path: MANIFEST_PATH,
        issues: zodIssuesToValidationIssues(parsed.error.issues),
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * Validates and unpacks a `.studio` bundle. Validation order: archive directory
 * (entry count, paths, duplicates, layout, declared sizes vs limits) → extraction →
 * manifest (JSON, format, schema) → manifest/archive agreement (every entry present,
 * nothing unlisted, sizes) → SHA-256 of every entry → project.json through
 * `parseProject` → assets against their metadata.
 */
export async function importProjectBundle(
  bytes: Uint8Array,
  deps: BundleDeps,
  limits: Partial<BundleLimits> = {},
): Promise<Result<{ project: Project; assets: AssetRecord[] }, BundleError>> {
  const effective: BundleLimits = { ...DEFAULT_BUNDLE_LIMITS, ...limits };
  if (!(bytes instanceof Uint8Array)) {
    return err(new BundleError('invalid-archive', 'bundle must be a Uint8Array'));
  }

  const extracted = extract(bytes, effective);
  if (!extracted.ok) return err(extracted.error);
  const files = new Map(Object.entries(extracted.value));

  const manifestBytes = files.get(MANIFEST_PATH);
  if (!manifestBytes) {
    return err(
      new BundleError('missing-entry', 'bundle has no manifest.json', { path: MANIFEST_PATH }),
    );
  }
  const manifestJson = decodeJson(manifestBytes, MANIFEST_PATH);
  if (!manifestJson.ok) return err(manifestJson.error);
  const manifestResult = readManifest(manifestJson.value);
  if (!manifestResult.ok) return err(manifestResult.error);
  const manifest = manifestResult.value;

  // Manifest ↔ archive agreement (cheap checks before hashing anything).
  const listed = new Map<string, BundleManifestEntry>();
  for (const entry of manifest.entries) {
    const unsafe = checkBundlePath(entry.path);
    if (unsafe !== undefined) {
      return err(
        new BundleError('unsafe-path', `manifest lists unsafe path "${entry.path}": ${unsafe}`, {
          path: entry.path,
        }),
      );
    }
    if (entry.path === MANIFEST_PATH || listed.has(entry.path)) {
      return err(
        new BundleError('duplicate-entry', `manifest lists "${entry.path}" more than once`, {
          path: entry.path,
        }),
      );
    }
    listed.set(entry.path, entry);
    const actual = files.get(entry.path);
    if (!actual) {
      return err(
        new BundleError(
          'missing-entry',
          `manifest entry "${entry.path}" is missing from the archive`,
          { path: entry.path },
        ),
      );
    }
    if (actual.byteLength !== entry.size) {
      return err(
        new BundleError(
          'size-mismatch',
          `"${entry.path}" is ${actual.byteLength} bytes but the manifest says ${entry.size}`,
          { path: entry.path },
        ),
      );
    }
  }
  for (const path of files.keys()) {
    if (path !== MANIFEST_PATH && !listed.has(path)) {
      return err(
        new BundleError(
          'unexpected-entry',
          `archive entry "${path}" is not listed in the manifest`,
          { path },
        ),
      );
    }
  }
  if (!listed.has(PROJECT_PATH)) {
    return err(
      new BundleError('missing-entry', 'bundle has no project.json', { path: PROJECT_PATH }),
    );
  }

  for (const entry of manifest.entries) {
    const digest = await hashHex(deps, files.get(entry.path)!);
    if (digest !== entry.sha256) {
      return err(
        new BundleError(
          'checksum-mismatch',
          `SHA-256 of "${entry.path}" does not match the manifest`,
          { path: entry.path },
        ),
      );
    }
  }

  const projectJson = decodeJson(files.get(PROJECT_PATH)!, PROJECT_PATH);
  if (!projectJson.ok) return err(projectJson.error);
  const parsed = parseProject(projectJson.value);
  if (!parsed.ok) {
    return err(
      new BundleError(
        'invalid-project',
        `project.json is not a valid project: ${parsed.error.message}`,
        {
          path: PROJECT_PATH,
          issues: parsed.error.issues,
        },
      ),
    );
  }
  const { project, migratedFrom } = parsed.value;
  if (migratedFrom !== manifest.schemaVersion) {
    return err(
      new BundleError(
        'invalid-manifest',
        `manifest schemaVersion ${manifest.schemaVersion} does not match project.json (${migratedFrom})`,
        { path: MANIFEST_PATH },
      ),
    );
  }

  const assets: AssetRecord[] = [];
  const expectedAssetPaths = new Set<string>();
  for (const id of Object.keys(project.assets).sort()) {
    const meta = project.assets[id as AssetId]!;
    const path = assetBundlePath(meta);
    expectedAssetPaths.add(path);
    const entry = listed.get(path);
    if (!entry) {
      return err(
        new BundleError('missing-entry', `asset ${id} is referenced by the project but missing`, {
          path,
        }),
      );
    }
    if (entry.size !== meta.byteLength) {
      return err(
        new BundleError(
          'asset-mismatch',
          `asset ${id} is ${entry.size} bytes but its metadata says ${meta.byteLength}`,
          {
            path,
          },
        ),
      );
    }
    if (entry.sha256 !== meta.contentHash) {
      return err(
        new BundleError('asset-mismatch', `asset ${id} bytes do not match its contentHash`, {
          path,
        }),
      );
    }
    assets.push({ meta, bytes: files.get(path)! });
  }
  for (const path of listed.keys()) {
    if (path !== PROJECT_PATH && !expectedAssetPaths.has(path)) {
      return err(
        new BundleError('unexpected-entry', `"${path}" is not an asset of this project`, { path }),
      );
    }
  }

  return ok({ project, assets });
}
