/**
 * Storage-agnostic revision/backup/recovery logic shared by every ProjectRepository
 * implementation (memory, IndexedDB, future file-system adapters). Adapters only
 * read and write {@link StoredProjectRecord}s atomically; the decisions about
 * conflicts, which revision becomes the backup and how loads recover live here so
 * all hosts behave identically.
 */
import { CURRENT_SCHEMA_VERSION, type Project, type ProjectId } from '@studio/domain';
import { ProjectValidationError } from './errors';
import { isJsonRecord } from './migrations';
import { parseProject, type ParsedProject } from './parse';
import type { ProjectLoadResult, ProjectSummary, SaveResult } from './repositories';

/** One stored revision of a project. `data` is untrusted until parsed. */
export interface StoredProjectRecord {
  readonly id: string;
  readonly revision: number;
  readonly savedAt: string;
  readonly data: unknown;
}

const isValidRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;

/**
 * Validates a stored record (envelope and payload). Records may come from any
 * source — older app versions, other tabs, disk corruption — so nothing is assumed.
 */
export function readStoredRecord(
  id: string,
  record: unknown,
): { ok: true; parsed: ParsedProject; revision: number } | { ok: false; errors: string[] } {
  if (!isJsonRecord(record)) return { ok: false, errors: ['record is not an object'] };
  if (record['id'] !== id) return { ok: false, errors: ['record id does not match its key'] };
  if (!isValidRevision(record['revision'])) {
    return { ok: false, errors: ['record revision is not a positive integer'] };
  }
  const result = parseProject(record['data']);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
    };
  }
  if (result.value.project.id !== id) {
    return { ok: false, errors: ['project id does not match the record key'] };
  }
  return { ok: true, parsed: result.value, revision: record['revision'] };
}

/**
 * The revision a save must name in `expectedRevision`: the primary's revision when
 * its envelope is readable (even if its payload is corrupt), else the backup's, else 0.
 */
export function headRevision(primary: unknown, backup: unknown): number {
  if (isJsonRecord(primary) && isValidRevision(primary['revision'])) return primary['revision'];
  if (isJsonRecord(backup) && isValidRevision(backup['revision'])) return backup['revision'];
  return 0;
}

/** Load decision: primary if valid, else backup (flagged as recovered), else corrupt. */
export function resolveProjectLoad(
  id: ProjectId,
  primary: unknown,
  backup: unknown,
): ProjectLoadResult {
  if (primary === undefined && backup === undefined) return { status: 'not-found' };

  const errors: string[] = [];
  if (primary !== undefined) {
    const read = readStoredRecord(id, primary);
    if (read.ok) {
      return {
        status: 'ok',
        project: read.parsed.project,
        revision: read.revision,
        migratedFrom: read.parsed.migratedFrom,
        recoveredFromBackup: false,
      };
    }
    errors.push(...read.errors.map((e) => `primary: ${e}`));
  } else {
    errors.push('primary: missing');
  }

  if (backup !== undefined) {
    const read = readStoredRecord(id, backup);
    if (read.ok) {
      return {
        status: 'ok',
        project: read.parsed.project,
        // The head revision, so the next save (expectedRevision = this) replaces the bad primary.
        revision: headRevision(primary, backup),
        migratedFrom: read.parsed.migratedFrom,
        recoveredFromBackup: true,
      };
    }
    errors.push(...read.errors.map((e) => `backup: ${e}`));
  } else {
    errors.push('backup: missing');
  }
  return { status: 'corrupt', errors };
}

export function summarizeProject(project: Project, revision: number): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    trackCount: project.trackOrder.length,
    revision,
  };
}

export type ProjectSavePlan =
  | {
      readonly status: 'write';
      readonly primary: StoredProjectRecord;
      /** The record to keep in the backup slot (unchanged when the old primary was unusable). */
      readonly backup: StoredProjectRecord | undefined;
      readonly summary: ProjectSummary;
      readonly result: Extract<SaveResult, { status: 'saved' }>;
    }
  | { readonly status: 'conflict'; readonly result: Extract<SaveResult, { status: 'conflict' }> };

/** Throws {@link ProjectValidationError} unless `project` is a valid current-version project. */
export function validateProjectForSave(project: Project): Project {
  if (project.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new ProjectValidationError('version', [
      {
        path: 'schemaVersion',
        message: `only schema ${CURRENT_SCHEMA_VERSION} projects can be saved (got ${String(project.schemaVersion)})`,
      },
    ]);
  }
  const parsed = parseProject(project);
  if (!parsed.ok) throw parsed.error;
  // The parsed copy is detached from the caller's object graph.
  return parsed.value.project;
}

/**
 * Save decision. Must be evaluated inside the adapter's atomic unit (transaction)
 * together with the reads of `existingPrimary`/`existingBackup` and the writes.
 *
 * The previous primary becomes the backup only if it still parses: it is re-validated
 * on every save (rather than trusting an in-memory note that it was good) because
 * corruption can happen underneath a live session.
 */
export function planProjectSave(input: {
  readonly project: Project;
  readonly expectedRevision: number | undefined;
  readonly existingPrimary: unknown;
  readonly existingBackup: unknown;
  readonly savedAt: string;
}): ProjectSavePlan {
  const project = validateProjectForSave(input.project);
  const stored = headRevision(input.existingPrimary, input.existingBackup);
  if (input.expectedRevision !== undefined && input.expectedRevision !== stored) {
    return { status: 'conflict', result: { status: 'conflict', storedRevision: stored } };
  }

  const revision = stored + 1;
  const primary: StoredProjectRecord = {
    id: project.id,
    revision,
    savedAt: input.savedAt,
    data: project,
  };
  const previous = input.existingPrimary;
  const previousIsGood = previous !== undefined && readStoredRecord(project.id, previous).ok;
  // Never let a corrupt primary overwrite the last good backup.
  const backup = previousIsGood
    ? (previous as StoredProjectRecord)
    : (input.existingBackup as StoredProjectRecord | undefined);

  return {
    status: 'write',
    primary,
    backup,
    summary: summarizeProject(project, revision),
    result: { status: 'saved', revision, savedAt: input.savedAt },
  };
}
