import type { AudioBackendConfig, AudioBackendFactory, AudioEngine } from '@studio/audio-contracts';
import { WebAudioEngine, type WebAudioBackendOptions } from './engine';

/** Backend factory for the Web Audio engine (kind `'web-audio'`). */
export function createWebAudioBackendFactory(
  options: WebAudioBackendOptions = {},
): AudioBackendFactory {
  return {
    kind: 'web-audio',
    isSupported: () =>
      typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined',
    create: (config: AudioBackendConfig): AudioEngine => new WebAudioEngine(config, options),
  };
}
