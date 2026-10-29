/**
 * Project lifecycle: open/create, autosave with recovery, bundle import/export.
 */
import type { CommandHistory } from '@studio/commands';
import type { IdFactory, Project, ProjectId } from '@studio/domain';
import type { PickedFile, PlatformServices } from '@studio/platform-contracts';
import {
  AutosaveCoordinator,
  BUNDLE_FILE_EXTENSION,
  BUNDLE_MIME_TYPE,
  exportProjectBundle,
  importProjectBundle,
  type AssetRecord,
  type AutosaveStatus,
  type ProjectSummary,
} from '@studio/project-storage';
import type { ProjectStore, SaveStatus } from '../state/project-store';
import type { AssetLibrary } from './asset-library';
import { createDemoProject, createStarterProject } from './demo-project';
import { safeFileName } from './export-controller';

const LAST_PROJECT_KEY = 'studio.lastProjectId';

export interface OpenResult {
  readonly project: Project;
  readonly recoveredFromBackup: boolean;
  readonly migratedFrom: number | null;
  readonly createdNew: boolean;
}

export class ProjectController {
  private autosave: AutosaveCoordinator | null = null;
  private detachHistory: (() => void) | null = null;
  private notice: string | null = null;

  constructor(
    private readonly platform: PlatformServices,
    private readonly history: CommandHistory,
    private readonly projectStore: ProjectStore,
    private readonly assets: AssetLibrary,
    private readonly ids: IdFactory,
    private readonly autosaveDelayMs: number,
  ) {}

  private createAutosave(initialRevision: number): AutosaveCoordinator {
    return new AutosaveCoordinator({
      repository: this.platform.projectRepository,
      delayMs: this.autosaveDelayMs,
      initialRevision,
      scheduler: {
        setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
        clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      now: () => this.platform.now(),
      onStatus: (status: AutosaveStatus) => {
        this.projectStore.setState({
          saveStatus: status.state as SaveStatus,
          ...(status.state === 'saved' ? { lastSavedAt: status.savedAt } : {}),
        });
        if (status.state === 'error' && !status.retryable) {
          this.platform.logger.error('Autosave failed', status.error);
        }
      },
    });
  }

  /** Recovery/migration message to show once after opening, if any. */
  takeNotice(): string | null {
    const n = this.notice;
    this.notice = null;
    return n;
  }

  async openInitial(initialProjectId?: string): Promise<OpenResult> {
    const preferred =
      initialProjectId ?? (await this.platform.settingsRepository.get<string>(LAST_PROJECT_KEY));
    if (preferred) {
      const opened = await this.open(preferred as ProjectId).catch(() => null);
      if (opened) return opened;
    }
    const projects = await this.list();
    const recent = projects[0];
    if (recent) {
      const opened = await this.open(recent.id).catch(() => null);
      if (opened) return opened;
    }
    const project = createStarterProject(this.ids, this.platform.now());
    await this.adopt(project, true, 0);
    return { project, recoveredFromBackup: false, migratedFrom: null, createdNew: true };
  }

  async open(id: ProjectId): Promise<OpenResult> {
    const result = await this.platform.projectRepository.load(id);
    if (result.status !== 'ok') {
      throw new Error(
        result.status === 'not-found'
          ? 'Project not found.'
          : `Project data is damaged: ${result.errors.join('; ')}`,
      );
    }
    if (result.recoveredFromBackup) {
      this.notice =
        'The latest save of this project was damaged; the previous good version was restored.';
    } else if (result.migratedFrom < result.project.schemaVersion) {
      this.notice = `This project was upgraded from format v${result.migratedFrom}.`;
    }
    await this.adopt(result.project, false, result.revision);
    return {
      project: result.project,
      recoveredFromBackup: result.recoveredFromBackup,
      migratedFrom: result.migratedFrom,
      createdNew: false,
    };
  }

  async newProject(kind: 'empty' | 'demo'): Promise<Project> {
    await this.flush();
    const project =
      kind === 'demo'
        ? createDemoProject(this.ids, this.platform.now())
        : createStarterProject(this.ids, this.platform.now());
    await this.adopt(project, true, 0);
    return project;
  }

  list(): Promise<ProjectSummary[]> {
    return this.platform.projectRepository
      .list()
      .then((items) => [...items].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }

  /** Renames a stored project that is not open (the open one uses `rename`). */
  async renameStored(id: ProjectId, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (id === this.history.present.id) {
      this.rename(trimmed);
      return;
    }
    const result = await this.platform.projectRepository.load(id);
    if (result.status !== 'ok')
      throw new Error('This project could not be read, so it was not renamed.');
    const saved = await this.platform.projectRepository.save(
      { ...result.project, name: trimmed, updatedAt: this.platform.now() },
      { expectedRevision: result.revision },
    );
    if (saved.status !== 'saved')
      throw new Error('The project changed elsewhere; reload and try again.');
  }

  /** Saves a copy of a stored project under a new id and returns it (assets are shared). */
  async duplicate(id: ProjectId): Promise<ProjectSummary> {
    if (id === this.history.present.id) await this.flush();
    const result = await this.platform.projectRepository.load(id);
    if (result.status !== 'ok')
      throw new Error('This project could not be read, so it was not copied.');
    const now = this.platform.now();
    const copy: Project = {
      ...result.project,
      id: this.ids.create('project'),
      name: `${result.project.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.platform.projectRepository.save(copy);
    if (saved.status !== 'saved') throw new Error('The copy could not be saved.');
    return {
      id: copy.id,
      name: copy.name,
      createdAt: now,
      updatedAt: now,
      trackCount: copy.trackOrder.length,
      revision: saved.revision,
    };
  }

  async deleteProject(id: ProjectId): Promise<void> {
    if (id === this.history.present.id) throw new Error('Close the project before deleting it.');
    await this.platform.projectRepository.delete(id);
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed && trimmed !== this.history.present.name) {
      this.history.execute({ type: 'project.rename', name: trimmed }, { label: 'Rename Project' });
    }
  }

  async exportBundle(): Promise<boolean> {
    await this.flush();
    const project = this.history.present;
    const records: AssetRecord[] = [];
    for (const id of Object.keys(project.assets)) {
      const record = await this.platform.assetRepository.get(id as keyof typeof project.assets);
      if (record) records.push(record);
    }
    const bytes = await exportProjectBundle(
      { project, assets: records },
      { sha256: (b) => this.platform.hasher.sha256(b) },
    );
    return this.platform.fileDialogs.saveFile(bytes, {
      suggestedName: `${safeFileName(project.name)}${BUNDLE_FILE_EXTENSION}`,
      mimeType: BUNDLE_MIME_TYPE,
    });
  }

  async importBundle(file: PickedFile): Promise<Project> {
    const result = await importProjectBundle(file.bytes, {
      sha256: (b) => this.platform.hasher.sha256(b),
    });
    if (!result.ok) throw new Error(`This bundle could not be imported: ${result.error.message}`);
    for (const record of result.value.assets) await this.platform.assetRepository.put(record);
    // Imported projects get a fresh id so importing never overwrites an existing project.
    const project: Project = { ...result.value.project, id: this.ids.create('project') };
    await this.flush();
    await this.adopt(project, true, 0);
    return project;
  }

  async flush(): Promise<void> {
    await this.autosave?.flush();
  }

  dispose(): void {
    this.detachHistory?.();
    this.autosave?.dispose();
    this.autosave = null;
  }

  private async adopt(project: Project, saveImmediately: boolean, revision: number): Promise<void> {
    this.detachHistory?.();
    const previous = this.autosave;
    if (previous) {
      await previous.flush().catch(() => undefined);
      previous.dispose();
    }
    const autosave = this.createAutosave(revision);
    this.autosave = autosave;
    this.assets.clear();
    this.history.reset(project);
    await this.platform.settingsRepository.set(LAST_PROJECT_KEY, project.id);
    this.detachHistory = this.history.subscribe(({ reason, present }) => {
      if (reason !== 'reset') autosave.notifyChanged(present);
    });
    if (saveImmediately) {
      autosave.notifyChanged(project);
      await autosave.flush();
    } else {
      this.projectStore.setState({ saveStatus: 'saved' });
    }
    void this.assets.preload(project);
  }
}
