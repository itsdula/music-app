/**
 * The single entry point for turning untrusted data (stored records, imported
 * bundles, pasted JSON) into a `Project`: migrate → schema → domain invariants.
 */
import { checkProjectInvariants, err, ok, type Project, type Result } from '@studio/domain';
import type { z } from 'zod';
import { ProjectValidationError, type ValidationIssue } from './errors';
import { migrateProjectData } from './migrations';
import { ProjectSchema } from './schema';

/** At most this many issues are reported; enough to diagnose without flooding the UI. */
const MAX_ISSUES = 50;

export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.map((segment) => String(segment)).join('.');
}

export function zodIssuesToValidationIssues(
  issues: readonly z.core.$ZodIssue[],
): ValidationIssue[] {
  return issues
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message }));
}

export interface ParsedProject {
  readonly project: Project;
  /** Schema version of the input before migration. */
  readonly migratedFrom: number;
}

export function parseProject(input: unknown): Result<ParsedProject, ProjectValidationError> {
  const migrated = migrateProjectData(input);
  if (!migrated.ok) return migrated;

  const parsed = ProjectSchema.safeParse(migrated.value.data);
  if (!parsed.success) {
    return err(
      new ProjectValidationError('schema', zodIssuesToValidationIssues(parsed.error.issues)),
    );
  }
  // The schema output is structurally identical to `Project` except for ID brands
  // (enforced at compile time in schema.ts), so this cast only re-applies brands.
  const project = parsed.data as unknown as Project;
  const violations = checkProjectInvariants(project);
  if (violations.length > 0) {
    return err(new ProjectValidationError('invariants', violations.slice(0, MAX_ISSUES)));
  }
  return ok({ project, migratedFrom: migrated.value.fromVersion });
}

/** `JSON.parse` + {@link parseProject}, reporting malformed JSON as a validation error. */
export function parseProjectJson(text: string): Result<ParsedProject, ProjectValidationError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'malformed JSON';
    return err(
      new ProjectValidationError('json', [{ path: '', message: `invalid JSON: ${message}` }]),
    );
  }
  return parseProject(raw);
}
