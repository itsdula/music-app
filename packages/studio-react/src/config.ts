import type { PlatformServices } from '@studio/platform-contracts';

/** Capabilities that can be switched off by hosts or while a feature is incomplete. */
export interface StudioFeatureFlags {
  readonly vocalEditor: boolean;
  readonly vocalCorrection: boolean;
  readonly recording: boolean;
  readonly midi: boolean;
  /** Sends MIDI clock to controllers (experimental, unverified on hardware). */
  readonly midiClockOut: boolean;
  /** Writing programs to controller hardware: unsupported until a documented protocol is verified. */
  readonly hardwareProgramEditing: false;
}

export const DEFAULT_FEATURE_FLAGS: StudioFeatureFlags = {
  vocalEditor: true,
  vocalCorrection: true,
  recording: true,
  midi: true,
  midiClockOut: false,
  hardwareProgramEditing: false,
};

export interface StudioConfig {
  readonly features: StudioFeatureFlags;
  /** Open this project on start (otherwise the most recent, or a new demo project). */
  readonly initialProjectId?: string;
  /** Undo entries kept in memory. */
  readonly undoLimit: number;
  /** Debounce before autosaving after the last edit, in ms. */
  readonly autosaveDelayMs: number;
}

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  features: DEFAULT_FEATURE_FLAGS,
  undoLimit: 200,
  autosaveDelayMs: 1200,
};

export type PlatformProvider =
  PlatformServices | (() => PlatformServices | Promise<PlatformServices>);

export interface StudioProps {
  /** Host services; defaults to browser implementations (IndexedDB, Web MIDI, Web Audio). */
  readonly platform?: PlatformProvider;
  readonly config?: Partial<Omit<StudioConfig, 'features'>> & {
    readonly features?: Partial<StudioFeatureFlags>;
  };
  readonly className?: string;
  readonly style?: React.CSSProperties;
}

export function resolveStudioConfig(partial: StudioProps['config']): StudioConfig {
  return {
    ...DEFAULT_STUDIO_CONFIG,
    ...partial,
    features: { ...DEFAULT_FEATURE_FLAGS, ...partial?.features, hardwareProgramEditing: false },
  };
}
