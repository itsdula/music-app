import type { Project } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  AutosaveCoordinator,
  ProjectValidationError,
  StorageQuotaError,
  createMemoryProjectRepository,
  type AutosaveOptions,
  type AutosaveStatus,
  type ProjectRepository,
  type SaveOptions,
  type SaveResult,
} from '../src';
import { emptyProject } from './fixtures';

/** Deterministic fake clock: timers run only when the test advances time. */
class FakeScheduler {
  now = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.timers.delete(handle as number);
  };

  get pending(): number {
    return this.timers.size;
  }

  nextDelay(): number | undefined {
    const ats = [...this.timers.values()].map((t) => t.at - this.now);
    return ats.length ? Math.min(...ats) : undefined;
  }

  /** Advances the clock, firing due timers in order and letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, t]) => t.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

/** Lets pending promise callbacks run (no timers involved). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Repository whose saves complete only when the test says so. */
class ControlledRepository implements ProjectRepository {
  calls: { project: Project; options: SaveOptions | undefined; result: Deferred<SaveResult> }[] =
    [];
  list = () => Promise.resolve([]);
  load = () => Promise.resolve({ status: 'not-found' as const });
  delete = () => Promise.resolve();
  save(project: Project, options?: SaveOptions): Promise<SaveResult> {
    const result = deferred<SaveResult>();
    this.calls.push({ project, options, result });
    return result.promise;
  }
  get last() {
    return this.calls[this.calls.length - 1]!;
  }
}

let clock = 0;
const now = () => `2026-03-01T00:00:${String(clock++ % 60).padStart(2, '0')}.000Z`;

function setup(overrides: Partial<AutosaveOptions> = {}) {
  const scheduler = new FakeScheduler();
  const repository = new ControlledRepository();
  const statuses: AutosaveStatus[] = [];
  const coordinator = new AutosaveCoordinator({
    repository,
    delayMs: 1000,
    scheduler,
    now,
    onStatus: (s) => statuses.push(s),
    ...overrides,
  });
  const states = () => statuses.map((s) => s.state);
  return { scheduler, repository, coordinator, statuses, states };
}

const projectNamed = (name: string): Project => ({ ...emptyProject(), name });
const saved = (revision: number): SaveResult => ({
  status: 'saved',
  revision,
  savedAt: `saved-${revision}`,
});

describe('AutosaveCoordinator: debounce and coalescing', () => {
  it('saves once, delayMs after the last change, with the latest project', async () => {
    const { scheduler, repository, coordinator, states } = setup();
    expect(coordinator.getStatus()).toEqual({ state: 'idle' });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(600);
    coordinator.notifyChanged(projectNamed('b'));
    await scheduler.advance(600);
    coordinator.notifyChanged(projectNamed('c'));
    await scheduler.advance(999);
    expect(repository.calls).toHaveLength(0);
    expect(coordinator.getStatus().state).toBe('pending');
    await scheduler.advance(1);
    expect(repository.calls).toHaveLength(1);
    expect(repository.last.project.name).toBe('c');
    repository.last.result.resolve(saved(1));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({
      state: 'saved',
      revision: 1,
      savedAt: 'saved-1',
    });
    // Repeated "pending" notifications are collapsed.
    expect(states()).toEqual(['pending', 'saving', 'saved']);
  });

  it('stamps updatedAt on the saved copy without touching the caller object', async () => {
    const { scheduler, repository, coordinator } = setup({ now: () => '2030-01-01T00:00:00.000Z' });
    const project = projectNamed('a');
    coordinator.notifyChanged(project);
    await scheduler.advance(1000);
    expect(repository.last.project.updatedAt).toBe('2030-01-01T00:00:00.000Z');
    expect(project.updatedAt).not.toBe('2030-01-01T00:00:00.000Z');
    repository.last.result.resolve(saved(1));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({ updatedAt: '2030-01-01T00:00:00.000Z' });
  });
});

describe('AutosaveCoordinator: single in-flight save', () => {
  it('never runs two saves at once and saves the newest project afterwards', async () => {
    const { scheduler, repository, coordinator, states } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    expect(repository.calls).toHaveLength(1);

    coordinator.notifyChanged(projectNamed('b'));
    coordinator.notifyChanged(projectNamed('c'));
    await scheduler.advance(5000); // debounce elapses while 'a' is still saving
    expect(repository.calls).toHaveLength(1);
    expect(coordinator.getStatus().state).toBe('saving');

    repository.calls[0]!.result.resolve(saved(1));
    await settle();
    expect(repository.calls).toHaveLength(2);
    expect(repository.last.project.name).toBe('c');
    expect(repository.last.options).toEqual({ expectedRevision: 1 });
    repository.last.result.resolve(saved(2));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({ state: 'saved', revision: 2 });
    expect(states()).toEqual(['pending', 'saving', 'saving', 'saved']);
  });

  it('waits for the debounce of changes made during a save', async () => {
    const { scheduler, repository, coordinator } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    coordinator.notifyChanged(projectNamed('b'));
    repository.last.result.resolve(saved(1));
    await settle();
    expect(repository.calls).toHaveLength(1);
    expect(coordinator.getStatus().state).toBe('pending');
    await scheduler.advance(1000);
    expect(repository.calls).toHaveLength(2);
    expect(repository.last.project.name).toBe('b');
  });

  it('tracks revisions for expectedRevision, starting from initialRevision', async () => {
    const { scheduler, repository, coordinator } = setup({ initialRevision: 7 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    expect(repository.last.options).toEqual({ expectedRevision: 7 });
    repository.last.result.resolve(saved(8));
    await settle();
    expect(coordinator.getRevision()).toBe(8);
  });

  it('omits expectedRevision when the revision is unknown', async () => {
    const { scheduler, repository, coordinator } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    expect(repository.last.options).toEqual({});
  });
});

describe('AutosaveCoordinator: failures', () => {
  it('retries with exponential backoff, then reports error', async () => {
    const { scheduler, repository, coordinator, statuses } = setup({
      maxRetries: 2,
      retryBaseMs: 500,
    });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.reject(new Error('disk on fire'));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({
      state: 'pending',
      retry: { failedAttempts: 1, delayMs: 500 },
    });
    expect(scheduler.nextDelay()).toBe(500);

    await scheduler.advance(500);
    expect(repository.calls).toHaveLength(2);
    expect(coordinator.getStatus()).toEqual({ state: 'saving', attempt: 2 });
    repository.last.result.reject(new Error('still on fire'));
    await settle();
    expect(scheduler.nextDelay()).toBe(1000);

    await scheduler.advance(1000);
    expect(repository.calls).toHaveLength(3);
    repository.last.result.reject(new Error('gone'));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({ state: 'error', attempts: 3, retryable: true });
    expect((coordinator.getStatus() as { error: Error }).error.message).toBe('gone');
    expect(scheduler.pending).toBe(0);
    expect(statuses.map((s) => s.state)).toEqual([
      'pending',
      'saving',
      'pending',
      'saving',
      'pending',
      'saving',
      'error',
    ]);
  });

  it('caps the backoff at maxBackoffMs', async () => {
    const { scheduler, repository, coordinator } = setup({
      maxRetries: 10,
      retryBaseMs: 1000,
      maxBackoffMs: 3000,
    });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    const delays: (number | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      repository.last.result.reject(new Error('x'));
      await settle();
      delays.push(scheduler.nextDelay());
      await scheduler.advance(scheduler.nextDelay()!);
    }
    expect(delays).toEqual([1000, 2000, 3000, 3000]);
  });

  it('saves the newest project on retry and recovers', async () => {
    const { scheduler, repository, coordinator } = setup({ retryBaseMs: 200 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.reject(new Error('flaky'));
    await settle();
    coordinator.notifyChanged(projectNamed('b')); // does not reset the retry timer
    expect(scheduler.nextDelay()).toBe(200);
    await scheduler.advance(200);
    expect(repository.last.project.name).toBe('b');
    repository.last.result.resolve(saved(1));
    await settle();
    expect(coordinator.getStatus()).toMatchObject({ state: 'saved', revision: 1 });
  });

  it.each([
    ['validation', new ProjectValidationError('schema', [{ path: 'bpm', message: 'bad' }])],
    ['quota', new StorageQuotaError()],
  ])('does not retry %s errors', async (_label, error) => {
    const { scheduler, repository, coordinator } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.reject(error);
    await settle();
    expect(coordinator.getStatus()).toMatchObject({
      state: 'error',
      attempts: 1,
      retryable: false,
      error,
    });
    expect(scheduler.pending).toBe(0);
  });

  it('tries again after an error when the project changes', async () => {
    const { scheduler, repository, coordinator } = setup({ maxRetries: 0 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.reject(new Error('x'));
    await settle();
    expect(coordinator.getStatus().state).toBe('error');
    coordinator.notifyChanged(projectNamed('b'));
    expect(coordinator.getStatus().state).toBe('pending');
    await scheduler.advance(1000);
    expect(repository.calls).toHaveLength(2);
    expect(repository.last.result).toBeDefined();
    repository.last.result.resolve(saved(1));
    await settle();
    expect(coordinator.getStatus().state).toBe('saved');
  });
});

describe('AutosaveCoordinator: conflicts', () => {
  it('reports conflict, pauses saving and resumes after acceptRevision', async () => {
    const { scheduler, repository, coordinator } = setup({ initialRevision: 3 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.resolve({ status: 'conflict', storedRevision: 5 });
    await settle();
    expect(coordinator.getStatus()).toEqual({
      state: 'conflict',
      expectedRevision: 3,
      storedRevision: 5,
    });

    coordinator.notifyChanged(projectNamed('b'));
    await scheduler.advance(10_000);
    await coordinator.flush();
    expect(repository.calls).toHaveLength(1); // no silent overwrite
    expect(coordinator.getStatus().state).toBe('conflict');

    coordinator.acceptRevision(5); // user chose "keep mine"
    expect(coordinator.getStatus().state).toBe('pending');
    await scheduler.advance(1000);
    expect(repository.calls).toHaveLength(2);
    expect(repository.last.project.name).toBe('b');
    expect(repository.last.options).toEqual({ expectedRevision: 5 });
  });

  it('keeps the conflicting project for a retry after acceptRevision', async () => {
    const { scheduler, repository, coordinator } = setup({ initialRevision: 1 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.resolve({ status: 'conflict', storedRevision: 2 });
    await settle();
    coordinator.acceptRevision(2);
    await scheduler.advance(1000);
    expect(repository.last.project.name).toBe('a');
  });

  it('goes idle on acceptRevision when nothing is pending', () => {
    const { coordinator } = setup();
    coordinator.acceptRevision(4);
    expect(coordinator.getRevision()).toBe(4);
    expect(coordinator.getStatus().state).toBe('idle');
  });

  it('detects a concurrent writer through a real repository', async () => {
    const shared = createMemoryProjectRepository();
    await shared.save(projectNamed('initial'));
    const scheduler = new FakeScheduler();
    const coordinator = new AutosaveCoordinator({
      repository: shared,
      delayMs: 10,
      scheduler,
      now,
      initialRevision: 1,
    });
    await shared.save(projectNamed('other tab'), { expectedRevision: 1 });
    coordinator.notifyChanged(projectNamed('mine'));
    await scheduler.advance(10);
    await coordinator.flush();
    expect(coordinator.getStatus()).toEqual({
      state: 'conflict',
      expectedRevision: 1,
      storedRevision: 2,
    });
    const loaded = await shared.load(emptyProject().id);
    expect(loaded.status === 'ok' && loaded.project.name).toBe('other tab');
  });
});

describe('AutosaveCoordinator: flush and dispose', () => {
  it('flush saves immediately and resolves when everything is stored', async () => {
    const { scheduler, repository, coordinator } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    const flushed = coordinator.flush();
    await settle();
    expect(repository.calls).toHaveLength(1);
    expect(scheduler.pending).toBe(0);
    coordinator.notifyChanged(projectNamed('b')); // arrives during the flush
    repository.last.result.resolve(saved(1));
    await settle();
    expect(repository.calls).toHaveLength(2);
    repository.last.result.resolve(saved(2));
    await flushed;
    expect(coordinator.getStatus()).toMatchObject({ state: 'saved', revision: 2 });
  });

  it('flush with nothing pending resolves immediately', async () => {
    const { coordinator, repository } = setup();
    await coordinator.flush();
    expect(repository.calls).toHaveLength(0);
  });

  it('flush resolves after a failed attempt and leaves the retry scheduled', async () => {
    const { scheduler, repository, coordinator } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    const flushed = coordinator.flush();
    await settle();
    repository.last.result.reject(new Error('x'));
    await flushed;
    expect(coordinator.getStatus()).toMatchObject({
      state: 'pending',
      retry: { failedAttempts: 1 },
    });
    expect(scheduler.pending).toBe(1);
  });

  it('flush after an error makes a fresh attempt', async () => {
    const { scheduler, repository, coordinator } = setup({ maxRetries: 0 });
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    repository.last.result.reject(new Error('x'));
    await settle();
    expect(coordinator.getStatus().state).toBe('error');
    const flushed = coordinator.flush();
    await settle();
    expect(coordinator.getStatus()).toEqual({ state: 'saving', attempt: 1 });
    repository.last.result.resolve(saved(1));
    await flushed;
    expect(coordinator.getStatus().state).toBe('saved');
  });

  it('dispose cancels timers, drops pending changes and silences status', async () => {
    const { scheduler, repository, coordinator, statuses } = setup();
    coordinator.notifyChanged(projectNamed('a'));
    await scheduler.advance(1000);
    coordinator.notifyChanged(projectNamed('b'));
    const count = statuses.length;
    coordinator.dispose();
    expect(scheduler.pending).toBe(0);
    repository.last.result.resolve(saved(1));
    await scheduler.advance(10_000);
    coordinator.notifyChanged(projectNamed('c'));
    await coordinator.flush();
    expect(repository.calls).toHaveLength(1);
    expect(statuses).toHaveLength(count);
  });

  it('validates its options', () => {
    const base = { repository: new ControlledRepository(), scheduler: new FakeScheduler(), now };
    expect(() => new AutosaveCoordinator({ ...base, delayMs: -1 })).toThrow(RangeError);
    expect(() => new AutosaveCoordinator({ ...base, delayMs: 10, maxRetries: 1.5 })).toThrow(
      RangeError,
    );
  });
});
