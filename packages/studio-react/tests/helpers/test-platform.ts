/**
 * PlatformServices for tests: memory repositories, fake engine and MIDI port, deterministic
 * ids/clock, WAV-only decoder. Lets the real session run in jsdom/Node.
 */
import { decodeWav } from '@studio/audio-dsp';
import type { PickedFile, PlatformServices } from '@studio/platform-contracts';
import {
  createMemoryAssetRepository,
  createMemoryDerivedCache,
  createMemoryProjectRepository,
  createMemorySettingsRepository,
} from '@studio/project-storage';
import { createInlineVocalProcessor } from '@studio/vocal-dsp';
import { FakeAudioEngine } from './fake-engine';
import { FakeMidiPort } from './fake-midi-port';

export interface TestPlatform extends PlatformServices {
  readonly engine: FakeAudioEngine;
  readonly midiPort: FakeMidiPort;
  readonly savedFiles: Array<{ name: string; bytes: Uint8Array }>;
  pickFiles: PickedFile[];
}

/** Tiny deterministic non-cryptographic hash (tests only). */
function fnv1a(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').repeat(8);
}

export function createTestPlatform(overrides: { projects?: ReturnType<typeof createMemoryProjectRepository> } = {}): TestPlatform {
  let counter = 0;
  let clock = Date.parse('2026-10-29T10:00:00.000Z');
  const engine = new FakeAudioEngine();
  const midiPort = new FakeMidiPort();
  const savedFiles: Array<{ name: string; bytes: Uint8Array }> = [];
  const platform: TestPlatform = {
    hostKind: 'test',
    engine,
    midiPort,
    savedFiles,
    pickFiles: [],
    audioBackendFactory: { kind: 'fake', isSupported: () => true, create: () => engine },
    // Same-thread processor: real analysis and rendering without a Worker.
    createVocalProcessor: () => createInlineVocalProcessor(),
    midiAccess: midiPort,
    projectRepository: overrides.projects ?? createMemoryProjectRepository({ now: () => new Date(clock).toISOString() }),
    assetRepository: createMemoryAssetRepository(),
    derivedCache: createMemoryDerivedCache(),
    settingsRepository: createMemorySettingsRepository(),
    fileDialogs: {
      openFiles: async () => platform.pickFiles,
      saveFile: async (bytes, options) => {
        savedFiles.push({ name: options.suggestedName, bytes });
        return true;
      },
    },
    permissions: { query: async () => 'prompt', request: async () => 'prompt' },
    deviceInfo: {
      hostKind: 'test',
      platform: 'test',
      userAgent: 'vitest',
      coarsePointer: false,
      capabilities: { webMidi: true, audioWorklet: false, offlineAudioContext: false, getUserMedia: false, fileSystemAccess: false, sharedArrayBuffer: false, indexedDb: false },
    },
    logger: { log: () => undefined, debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    audioDecoder: {
      canDecode: (mime, name) => mime === 'audio/wav' || name.toLowerCase().endsWith('.wav'),
      decode: async (bytes) => decodeWav(bytes),
    },
    hasher: { sha256: async (bytes) => fnv1a(bytes) },
    randomId: () => `t${++counter}`,
    now: () => new Date((clock += 1000)).toISOString(),
    dispose: async () => undefined,
  };
  return platform;
}
