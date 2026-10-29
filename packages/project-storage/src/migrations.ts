/**
 * Schema-version migrations for stored project documents.
 *
 * Each migration upgrades a document from exactly one version to the next. Migrations
 * operate on untyped JSON (the older shapes have no TypeScript types any more), must
 * not mutate their input, and must validate the fields they read so that a malformed
 * old document fails with a precise error instead of producing garbage. The final
 * shape is validated by `ProjectSchema` afterwards, so migrations do not need to
 * re-check fields they pass through untouched.
 *
 * See docs/persistence.md §Migrations for the procedure to add a version.
 */
import { CURRENT_SCHEMA_VERSION, err, ok, type Result } from '@studio/domain';
import { ProjectValidationError, type ValidationIssue } from './errors';

export type JsonRecord = Record<string, unknown>;

export interface ProjectMigration {
  /** Version this migration reads; it produces `fromVersion + 1`. */
  readonly fromVersion: number;
  readonly description: string;
  /** Returns the upgraded document (with `schemaVersion` set to `fromVersion + 1`) or issues. */
  migrate(data: JsonRecord): Result<JsonRecord, readonly ValidationIssue[]>;
}

export const isJsonRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * v0 → v1. Schema v0 is the pre-release draft format:
 *   - tempo stored as `tempo: { bpm }` (v1: top-level `bpm`)
 *   - loop stored as top-level `loopStart`, `loopEnd`, `loopEnabled` (v1: `loop: { startTick, endTick, enabled }`)
 * Everything else is identical to v1.
 */
export const migrateV0ToV1: ProjectMigration = {
  fromVersion: 0,
  description: 'Move tempo.bpm to bpm and loopStart/loopEnd/loopEnabled into loop',
  migrate(data) {
    const issues: ValidationIssue[] = [];
    const tempo = data['tempo'];
    let bpm: number | undefined;
    if (!isJsonRecord(tempo)) {
      issues.push({ path: 'tempo', message: 'v0 document must have a tempo object' });
    } else if (!isFiniteNumber(tempo['bpm'])) {
      issues.push({ path: 'tempo.bpm', message: 'must be a finite number' });
    } else {
      bpm = tempo['bpm'];
    }
    const loopStart = data['loopStart'];
    const loopEnd = data['loopEnd'];
    const loopEnabled = data['loopEnabled'];
    if (!isFiniteNumber(loopStart))
      issues.push({ path: 'loopStart', message: 'must be a finite number' });
    if (!isFiniteNumber(loopEnd))
      issues.push({ path: 'loopEnd', message: 'must be a finite number' });
    if (typeof loopEnabled !== 'boolean')
      issues.push({ path: 'loopEnabled', message: 'must be a boolean' });
    for (const key of ['bpm', 'loop'] as const) {
      if (key in data)
        issues.push({ path: key, message: `unexpected v1 field "${key}" in a v0 document` });
    }
    if (issues.length > 0 || bpm === undefined) return err(issues);

    const { tempo: _tempo, loopStart: _s, loopEnd: _e, loopEnabled: _en, ...rest } = data;
    return ok({
      ...rest,
      schemaVersion: 1,
      bpm,
      loop: { enabled: loopEnabled, startTick: loopStart, endTick: loopEnd },
    });
  },
};

/** Ordered registry: `MIGRATIONS[i].fromVersion === i`, ending at `CURRENT_SCHEMA_VERSION - 1`. */
export const MIGRATIONS: readonly ProjectMigration[] = [migrateV0ToV1];

const versionError = (message: string) =>
  new ProjectValidationError('version', [{ path: 'schemaVersion', message }]);

/**
 * Upgrades `raw` to `targetVersion` using `migrations`. Exposed separately from
 * {@link migrateProjectData} so the pipeline can be tested with synthetic registries.
 */
export function migrateWith(
  raw: unknown,
  migrations: readonly ProjectMigration[],
  targetVersion: number,
): Result<{ data: unknown; fromVersion: number }, ProjectValidationError> {
  if (!isJsonRecord(raw)) {
    return err(
      new ProjectValidationError('schema', [
        { path: '', message: 'project must be a JSON object' },
      ]),
    );
  }
  const version = raw['schemaVersion'];
  if (version === undefined) return err(versionError('missing schemaVersion'));
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    return err(versionError('schemaVersion must be a non-negative integer'));
  }
  if (version > targetVersion) {
    return err(
      versionError(
        `project was saved by a newer version of Studio (schema ${version}); this version supports up to ${targetVersion}. Update Studio to open it.`,
      ),
    );
  }

  let data: JsonRecord = raw;
  for (let v = version; v < targetVersion; v++) {
    const migration = migrations.find((m) => m.fromVersion === v);
    if (!migration) return err(versionError(`no migration registered from schema ${v}`));
    const result = migration.migrate(data);
    if (!result.ok) {
      return err(
        new ProjectValidationError(
          'migration',
          result.error.map((i) => ({ path: i.path, message: `v${v}→v${v + 1}: ${i.message}` })),
        ),
      );
    }
    if (result.value['schemaVersion'] !== v + 1) {
      return err(
        new ProjectValidationError('migration', [
          { path: 'schemaVersion', message: `migration from v${v} did not produce v${v + 1}` },
        ]),
      );
    }
    data = result.value;
  }
  return ok({ data, fromVersion: version });
}

/** Upgrades a stored project document to `CURRENT_SCHEMA_VERSION` (without validating the result). */
export function migrateProjectData(
  raw: unknown,
): Result<{ data: unknown; fromVersion: number }, ProjectValidationError> {
  return migrateWith(raw, MIGRATIONS, CURRENT_SCHEMA_VERSION);
}
