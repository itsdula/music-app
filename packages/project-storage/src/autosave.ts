/**
 * Debounced, conflict-aware autosave.
 *
 *  - `notifyChanged(project)` after every committed edit; saves happen `delayMs`
 *    after the last change (debounce), with the newest project winning.
 *  - At most one save is in flight; changes arriving meanwhile are saved after it.
 *  - Each saved copy gets `updatedAt = now()`; the caller's object is not touched.
 *  - Saves pass `expectedRevision` (the revision this session last loaded or saved)
 *    so a concurrent writer (another tab) produces `conflict` instead of being
 *    silently overwritten. Saving then pauses until `acceptRevision()`.
 *  - Failed saves are retried with exponential backoff (`retryBaseMs · 2^(n-1)`,
 *    capped) up to `maxRetries` times, then the status becomes `error`. Validation
 *    and quota errors are not retried. The unsaved project is kept, so a later
 *    change or `flush()` tries again.
 *
 * All timing goes through the injected scheduler, so tests use a fake clock.
 */
import type { Project } from '@studio/domain';
import { InvalidRecordError, ProjectValidationError, StorageQuotaError } from './errors';
import type { ProjectRepository, SaveResult } from './repositories';

export type AutosaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

export interface AutosaveRetryInfo {
  /** Number of failed attempts so far. */
  readonly failedAttempts: number;
  /** Delay before the next attempt. */
  readonly delayMs: number;
  readonly lastError: unknown;
}

export type AutosaveStatus =
  /** Nothing to save yet. */
  | { readonly state: 'idle' }
  /** Unsaved changes waiting for the debounce (or for a retry, when `retry` is set). */
  | { readonly state: 'pending'; readonly retry?: AutosaveRetryInfo }
  /** A save is in flight; `attempt` starts at 1. */
  | { readonly state: 'saving'; readonly attempt: number }
  /** Everything notified so far is stored. */
  | {
      readonly state: 'saved';
      readonly revision: number;
      readonly savedAt: string;
      /** The `updatedAt` stamped on the stored copy. */
      readonly updatedAt: string;
    }
  /** Saving failed and will not be retried until the next change or `flush()`. */
  | {
      readonly state: 'error';
      readonly error: unknown;
      readonly attempts: number;
      /** False for errors retrying cannot fix (invalid project, quota exhausted). */
      readonly retryable: boolean;
    }
  /** The stored revision moved underneath this session; saving is paused. */
  | {
      readonly state: 'conflict';
      readonly expectedRevision: number | undefined;
      readonly storedRevision: number;
    };

export interface AutosaveScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AutosaveOptions {
  readonly repository: ProjectRepository;
  /** Quiet period after the last change before saving. */
  readonly delayMs: number;
  readonly scheduler: AutosaveScheduler;
  /** ISO timestamp source used to stamp `updatedAt`. */
  readonly now: () => string;
  readonly onStatus?: (status: AutosaveStatus) => void;
  /** Retries after the first failed attempt (default 3). */
  readonly maxRetries?: number;
  /** Base of the exponential backoff (default `delayMs`, at least 1 ms). */
  readonly retryBaseMs?: number;
  /** Backoff cap (default 30 000 ms). */
  readonly maxBackoffMs?: number;
  /**
   * Revision of the project as loaded (`ProjectLoadResult.revision`), or 0 for a
   * project that has never been saved. When omitted the first save is
   * unconditional (no `expectedRevision`) — avoid this for loaded projects.
   */
  readonly initialRevision?: number;
}

const isRetryable = (error: unknown) =>
  !(
    error instanceof ProjectValidationError ||
    error instanceof InvalidRecordError ||
    error instanceof StorageQuotaError ||
    (error instanceof Error && error.name === 'StorageQuotaError')
  );

type Outcome = 'saved' | 'conflict' | 'failed';

export class AutosaveCoordinator {
  private readonly repository: ProjectRepository;
  private readonly delayMs: number;
  private readonly scheduler: AutosaveScheduler;
  private readonly now: () => string;
  private readonly onStatus: ((status: AutosaveStatus) => void) | undefined;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly maxBackoffMs: number;

  private status: AutosaveStatus = { state: 'idle' };
  /** Newest project not yet handed to the repository. */
  private latest: Project | undefined;
  private timer: { readonly handle: unknown; readonly kind: 'debounce' | 'retry' } | undefined;
  private inFlight: Promise<Outcome> | undefined;
  private revision: number | undefined;
  private failedAttempts = 0;
  private disposed = false;

  constructor(options: AutosaveOptions) {
    if (!(Number.isFinite(options.delayMs) && options.delayMs >= 0)) {
      throw new RangeError('delayMs must be a non-negative finite number');
    }
    const maxRetries = options.maxRetries ?? 3;
    if (!(Number.isInteger(maxRetries) && maxRetries >= 0)) {
      throw new RangeError('maxRetries must be a non-negative integer');
    }
    this.repository = options.repository;
    this.delayMs = options.delayMs;
    this.scheduler = options.scheduler;
    this.now = options.now;
    this.onStatus = options.onStatus;
    this.maxRetries = maxRetries;
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? options.delayMs);
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.revision = options.initialRevision;
  }

  getStatus(): AutosaveStatus {
    return this.status;
  }

  /** The revision this coordinator expects to be stored (last loaded or saved). */
  getRevision(): number | undefined {
    return this.revision;
  }

  /** Schedules a save of `project` (debounced; the newest project wins). */
  notifyChanged(project: Project): void {
    if (this.disposed) return;
    this.latest = project;
    if (this.status.state === 'conflict') return;
    if (this.timer?.kind === 'retry') return; // the pending retry will save the newest project
    if (this.status.state === 'error') this.failedAttempts = 0;
    this.schedule('debounce', this.delayMs);
    if (!this.inFlight) this.setStatus({ state: 'pending' });
  }

  /**
   * Saves pending changes now and waits for in-flight work. Resolves (never rejects)
   * once everything is stored or an attempt failed/conflicted; inspect
   * `getStatus()` afterwards. A failed attempt keeps its normal retry schedule.
   */
  async flush(): Promise<void> {
    while (!this.disposed) {
      if (this.inFlight) {
        if ((await this.inFlight) !== 'saved') return;
        continue;
      }
      if (this.latest === undefined || this.status.state === 'conflict') return;
      this.cancelTimer();
      if (this.status.state === 'error') this.failedAttempts = 0;
      this.startSave();
    }
  }

  /**
   * Adopts `revision` as the stored revision and resumes saving. Use after a
   * conflict once the user has decided (e.g. "keep mine" → pass the stored revision
   * from the conflict status to overwrite it).
   */
  acceptRevision(revision: number): void {
    if (this.disposed) return;
    this.revision = revision;
    if (this.status.state !== 'conflict') return;
    if (this.latest !== undefined) {
      this.schedule('debounce', this.delayMs);
      this.setStatus({ state: 'pending' });
    } else {
      this.setStatus({ state: 'idle' });
    }
  }

  /** Stops all timers and drops unsaved changes (call `flush()` first to keep them). */
  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.latest = undefined;
  }

  // -------------------------------------------------------------------------

  private setStatus(status: AutosaveStatus): void {
    const previous = this.status;
    this.status = status;
    if (this.disposed) return;
    if (
      status.state === 'pending' &&
      previous.state === 'pending' &&
      !status.retry &&
      !previous.retry
    ) {
      return; // repeated edits while pending: nothing new to report
    }
    this.onStatus?.(status);
  }

  private schedule(kind: 'debounce' | 'retry', ms: number): void {
    this.cancelTimer();
    const handle = this.scheduler.setTimeout(() => {
      if (this.timer?.handle !== handle) return;
      this.timer = undefined;
      this.startSave();
    }, ms);
    this.timer = { handle, kind };
  }

  private cancelTimer(): void {
    if (this.timer) this.scheduler.clearTimeout(this.timer.handle);
    this.timer = undefined;
  }

  /** Starts a save of `latest` unless one is in flight (its completion picks `latest` up). */
  private startSave(): void {
    if (this.disposed || this.inFlight || this.latest === undefined) return;
    if (this.status.state === 'conflict') return;
    const project = this.latest;
    this.latest = undefined;
    const attempt = this.failedAttempts + 1;
    this.setStatus({ state: 'saving', attempt });
    const copy: Project = { ...project, updatedAt: this.now() };
    const expected = this.revision;
    const promise = this.save(copy, expected).then(
      (result) => this.onSaveResult(project, copy, expected, result),
      (error: unknown) => this.onSaveError(project, error),
    );
    this.inFlight = promise;
    void promise.finally(() => {
      if (this.inFlight === promise) this.inFlight = undefined;
      this.continueAfterSave();
    });
  }

  private async save(copy: Project, expected: number | undefined): Promise<SaveResult> {
    return this.repository.save(copy, expected === undefined ? {} : { expectedRevision: expected });
  }

  private onSaveResult(
    project: Project,
    copy: Project,
    expected: number | undefined,
    result: SaveResult,
  ): Outcome {
    if (result.status === 'conflict') {
      this.latest ??= project;
      this.failedAttempts = 0;
      this.cancelTimer();
      this.setStatus({
        state: 'conflict',
        expectedRevision: expected,
        storedRevision: result.storedRevision,
      });
      return 'conflict';
    }
    this.revision = result.revision;
    this.failedAttempts = 0;
    if (this.latest === undefined) {
      this.setStatus({
        state: 'saved',
        revision: result.revision,
        savedAt: result.savedAt,
        updatedAt: copy.updatedAt,
      });
    }
    return 'saved';
  }

  private onSaveError(project: Project, error: unknown): Outcome {
    this.latest ??= project;
    this.failedAttempts += 1;
    const retryable = isRetryable(error);
    if (!retryable || this.failedAttempts > this.maxRetries) {
      const attempts = this.failedAttempts;
      this.failedAttempts = 0;
      this.cancelTimer();
      this.setStatus({ state: 'error', error, attempts, retryable });
      return 'failed';
    }
    const delayMs = Math.min(this.maxBackoffMs, this.retryBaseMs * 2 ** (this.failedAttempts - 1));
    this.schedule('retry', delayMs);
    this.setStatus({
      state: 'pending',
      retry: { failedAttempts: this.failedAttempts, delayMs, lastError: error },
    });
    return 'failed';
  }

  /** After a successful save: save changes that arrived meanwhile once their debounce has passed. */
  private continueAfterSave(): void {
    if (this.disposed || this.inFlight || this.latest === undefined) return;
    if (this.status.state !== 'saving') return; // conflict, error or retry scheduled
    if (this.timer) this.setStatus({ state: 'pending' });
    else this.startSave();
  }
}
