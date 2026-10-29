/**
 * The contract every Studio host implements. The React UI depends only on these
 * interfaces; hosts inject implementations:
 *   - browser:  @studio/platform-browser (IndexedDB, Web MIDI, Web Audio, <input type=file>)
 *   - Electron: renderer reuses most browser services; file dialogs/fs via a typed preload IPC
 *   - Tauri:    audio/MIDI/file adapters backed by Rust commands and events
 */
import type { AudioBackendFactory } from '@studio/audio-contracts';
import type { PcmAudio } from '@studio/audio-dsp';
import type { MidiAccessPort } from '@studio/midi-core';
import type {
  AssetRepository,
  DerivedDataCache,
  ProjectRepository,
  SettingsRepository,
} from '@studio/project-storage';
import type { VocalProcessor } from '@studio/vocal-dsp';
import type { AssistantTransport } from './assistant';

export type HostKind = 'browser' | 'electron' | 'tauri' | 'test';

export interface PickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface OpenFileOptions {
  readonly accept: readonly string[]; // MIME types or extensions, e.g. ['audio/*', '.wav']
  readonly multiple: boolean;
}

export interface SaveFileOptions {
  readonly suggestedName: string;
  readonly mimeType: string;
}

export interface FileDialogs {
  openFiles(options: OpenFileOptions): Promise<PickedFile[]>;
  /** Saves bytes to a user-chosen location (download fallback in browsers). Resolves false if cancelled. */
  saveFile(bytes: Uint8Array, options: SaveFileOptions): Promise<boolean>;
}

export type PermissionName = 'microphone' | 'midi' | 'midi-sysex' | 'persistent-storage';
export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported' | 'unknown';

export interface PermissionsService {
  query(name: PermissionName): Promise<PermissionState>;
  /** Requests where the platform allows an explicit request (e.g. persistent storage). */
  request(name: PermissionName): Promise<PermissionState>;
}

export interface HostCapabilities {
  readonly webMidi: boolean;
  readonly audioWorklet: boolean;
  readonly offlineAudioContext: boolean;
  readonly getUserMedia: boolean;
  readonly fileSystemAccess: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly indexedDb: boolean;
}

export interface DeviceInfo {
  readonly hostKind: HostKind;
  readonly platform: string;
  readonly userAgent: string;
  readonly capabilities: HostCapabilities;
  /** Optional: true on touch-first devices (layout hints only). */
  readonly coarsePointer: boolean;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** Decodes encoded audio file bytes (WAV/MP3/…) into PCM; codec support is host-dependent. */
export interface AudioDecoder {
  canDecode(mimeType: string, fileName: string): boolean;
  decode(
    bytes: Uint8Array,
    hint: { readonly mimeType: string; readonly fileName: string },
  ): Promise<PcmAudio>;
}

export interface Hasher {
  /** Lower-case hex SHA-256 of the bytes. */
  sha256(bytes: Uint8Array): Promise<string>;
}

export interface PlatformServices {
  readonly hostKind: HostKind;
  readonly audioBackendFactory: AudioBackendFactory;
  readonly createVocalProcessor: () => VocalProcessor;
  readonly midiAccess: MidiAccessPort;
  readonly projectRepository: ProjectRepository;
  readonly assetRepository: AssetRepository;
  readonly derivedCache: DerivedDataCache;
  readonly settingsRepository: SettingsRepository;
  readonly fileDialogs: FileDialogs;
  readonly permissions: PermissionsService;
  readonly deviceInfo: DeviceInfo;
  readonly logger: Logger;
  readonly audioDecoder: AudioDecoder;
  readonly hasher: Hasher;
  /** Unique id suffix source (e.g. crypto.randomUUID). */
  readonly randomId: () => string;
  /** ISO timestamp source; injectable for deterministic tests. */
  readonly now: () => string;
  /** AI assistant route; absent when the host has none (the chat panel then explains why). */
  readonly assistant?: AssistantTransport;
  /** Releases host resources (MIDI access, DB connections). */
  dispose(): Promise<void>;
}
