/**
 * Typed errors shared by every persistence implementation (memory, IndexedDB and
 * future file-system adapters), so callers can branch on the failure kind without
 * knowing which host they run in.
 */

export interface ValidationIssue {
  /** Dotted path into the offending document (`tracks.trk_1.mixer.pan`); empty for the root. */
  readonly path: string;
  readonly message: string;
}

/** Which stage of `parseProject` rejected the input. */
export type ProjectValidationStage = 'json' | 'version' | 'migration' | 'schema' | 'invariants';

export class ProjectValidationError extends Error {
  override readonly name = 'ProjectValidationError';
  readonly stage: ProjectValidationStage;
  readonly issues: readonly ValidationIssue[];

  constructor(stage: ProjectValidationStage, issues: readonly ValidationIssue[]) {
    super(formatIssues(stage, issues));
    this.stage = stage;
    this.issues = issues;
  }
}

function formatIssues(stage: ProjectValidationStage, issues: readonly ValidationIssue[]): string {
  const shown = issues.slice(0, 5).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  const more = issues.length > shown.length ? ` (+${issues.length - shown.length} more)` : '';
  return `Invalid project (${stage}): ${shown.join('; ')}${more}`;
}

/** The host refused a write because the storage quota is exhausted. Retrying will not help. */
export class StorageQuotaError extends Error {
  override readonly name = 'StorageQuotaError';

  constructor(message = 'Storage quota exceeded', cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
  }
}

/** A stored record could not be read back in a usable form. */
export class StorageCorruptionError extends Error {
  override readonly name = 'StorageCorruptionError';
  readonly key: string;

  constructor(key: string, message: string) {
    super(`Corrupt stored record ${key}: ${message}`);
    this.key = key;
  }
}

/** A record handed to a repository is malformed (programming error at the call site). */
export class InvalidRecordError extends Error {
  override readonly name = 'InvalidRecordError';
}
