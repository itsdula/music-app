/**
 * Persistence ports. Implementations: in-memory (this package, for tests and the
 * fallback host), IndexedDB (@studio/platform-browser), and later Electron/Tauri
 * file-system adapters. Binary audio never travels inside project JSON.
 */
import type { AssetId, AssetRef, Project, ProjectId } from '@studio/domain';

export interface ProjectSummary {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly trackCount: number;
  readonly revision: number;
}

export type ProjectLoadResult =
  | {
      readonly status: 'ok';
      readonly project: Project;
      readonly revision: number;
      /** Schema version the stored data had before migration (equal to current if none). */
      readonly migratedFrom: number;
      /** True when the primary record was invalid and the previous good revision was used. */
      readonly recoveredFromBackup: boolean;
    }
  | { readonly status: 'not-found' }
  | { readonly status: 'corrupt'; readonly errors: readonly string[] };

export interface SaveOptions {
  /** Optimistic concurrency: reject when the stored revision differs. */
  readonly expectedRevision?: number;
}

export type SaveResult =
  | { readonly status: 'saved'; readonly revision: number; readonly savedAt: string }
  | { readonly status: 'conflict'; readonly storedRevision: number };

export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  load(id: ProjectId): Promise<ProjectLoadResult>;
  /** Atomic: either the new revision is fully stored (and the previous kept as backup) or nothing changes. */
  save(project: Project, options?: SaveOptions): Promise<SaveResult>;
  delete(id: ProjectId): Promise<void>;
}

export interface AssetRecord {
  readonly meta: AssetRef;
  /** Encoded file bytes (e.g. WAV/MP3) exactly as imported or recorded. */
  readonly bytes: Uint8Array;
}

export interface AssetRepository {
  put(record: AssetRecord): Promise<void>;
  get(id: AssetId): Promise<AssetRecord | undefined>;
  getMeta(id: AssetId): Promise<AssetRef | undefined>;
  has(id: AssetId): Promise<boolean>;
  delete(id: AssetId): Promise<void>;
  listIds(): Promise<AssetId[]>;
}

/**
 * Cache for derived, recomputable data (waveform peaks, pitch analyses, vocal renders).
 * Keys must encode every input that affects the value (content hash + algorithm version
 * + parameters) so invalidation is deterministic; entries may be evicted at any time.
 */
export interface DerivedDataCache {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
}

/** Small key/value store for host-global settings (preferences, global MIDI mappings). */
export interface SettingsRepository {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}
