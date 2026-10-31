/**
 * Browser implementation of PlatformServices. Electron renderers can reuse this wholesale
 * and override `fileDialogs` with a preload-IPC adapter; Tauri replaces audio, MIDI and
 * files with Rust-backed adapters (see docs/architecture.md §11).
 */
import { createWebAudioBackendFactory } from '@studio/audio-web';
import type {
  HostKind,
  KeyValueStore,
  LogLevel,
  PlatformServices,
} from '@studio/platform-contracts';
import { createWorkerVocalProcessor } from '@studio/vocal-dsp';
import { createBrowserAudioDecoder } from './audio-decoder';
import { createBrowserDeviceInfo } from './device-info';
import { createBrowserFileDialogs } from './files';
import { vocalWorkerSource } from './generated/inline-bundles';
import { createWebCryptoHasher } from './hashing';
import { BrowserLogger } from './logger';
import { createWebMidiAccessPort } from './midi';
import { createBrowserPermissions } from './permissions';
import { createIndexedDbStorage, createLocalStorageKeyValueStore } from './storage';
import { createInlineWorker } from './workers/inline-worker';

export interface BrowserPlatformOptions {
  /** IndexedDB database name (separate names isolate test runs or multiple Studios). */
  readonly dbName?: string;
  readonly logLevel?: LogLevel;
  /**
   * Lowest level the logger also prints to the console (default `warn`). Dev builds lower
   * it so tooling that captures the console (the Electron dev monitor) sees info/debug.
   */
  readonly consoleLevel?: LogLevel;
  readonly hostKind?: HostKind;
  /**
   * UI preferences store: `createLocalStorageKeyValueStore()` (the default) in browsers,
   * `createBridgedKeyValueStore(...)` over the preload bridge in Electron. The platform
   * owns it: `dispose()` flushes it and calls its own `dispose()` when it has one.
   */
  readonly preferences?: KeyValueStore & { dispose?(): void };
}

export function createBrowserPlatform(options: BrowserPlatformOptions = {}): PlatformServices {
  const logger = new BrowserLogger(options.logLevel ?? 'info', 500, options.consoleLevel ?? 'warn');
  const storage = createIndexedDbStorage({ dbName: options.dbName ?? 'studio' });
  const midiAccess = createWebMidiAccessPort();
  const hostKind = options.hostKind ?? 'browser';
  const preferences = options.preferences ?? createLocalStorageKeyValueStore({ logger });
  return {
    hostKind,
    audioBackendFactory: createWebAudioBackendFactory(),
    createVocalProcessor: () =>
      createWorkerVocalProcessor(() => createInlineWorker(vocalWorkerSource, 'studio-vocal')),
    midiAccess,
    projectRepository: storage.projects,
    assetRepository: storage.assets,
    derivedCache: storage.derived,
    settingsRepository: storage.settings,
    preferences,
    fileDialogs: createBrowserFileDialogs(),
    permissions: createBrowserPermissions(),
    deviceInfo: createBrowserDeviceInfo(hostKind),
    logger,
    audioDecoder: createBrowserAudioDecoder(),
    hasher: createWebCryptoHasher(),
    randomId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    dispose() {
      midiAccess.close();
      storage.close();
      const flushed = preferences.flush();
      preferences.dispose?.();
      return flushed;
    },
  };
}
