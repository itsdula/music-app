/**
 * Keeps the AudioEngine in sync with the project: every history change is diffed by
 * reference (`diffProjects`) and applied in order. Calls are serialized so an async
 * backend (e.g. IPC) always sees changes in the order they happened.
 */
import type { AudioEngine } from '@studio/audio-contracts';
import type { CommandHistory } from '@studio/commands';
import type { Project } from '@studio/domain';
import { diffProjects } from '@studio/engine-core';
import type { Logger } from '@studio/platform-contracts';

export class EngineBridge {
  private applied: Project;
  private queue: Promise<void> = Promise.resolve();
  private detachHistory: (() => void) | null = null;

  constructor(
    private readonly engine: AudioEngine,
    private readonly history: CommandHistory,
    private readonly logger: Logger,
  ) {
    this.applied = history.present;
  }

  /** Loads the current project into the engine and starts following history changes. */
  async attach(): Promise<void> {
    this.detachHistory?.();
    this.applied = this.history.present;
    await this.engine.loadProject({ project: this.applied });
    this.detachHistory = this.history.subscribe(({ reason, present }) => {
      if (reason === 'reset') {
        this.enqueue(async () => {
          this.applied = present;
          await this.engine.loadProject({ project: present });
        });
        return;
      }
      this.sync(present);
    });
  }

  /** Applies the diff between the last applied project and `next`. */
  sync(next: Project): void {
    this.enqueue(async () => {
      const changes = diffProjects(this.applied, next);
      this.applied = next;
      if (changes.length > 0) await this.engine.applyChanges(changes);
    });
  }

  /** Resolves when all queued engine updates have been applied. */
  flush(): Promise<void> {
    return this.queue;
  }

  detach(): void {
    this.detachHistory?.();
    this.detachHistory = null;
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.logger.error('Engine update failed', error);
    });
  }
}
