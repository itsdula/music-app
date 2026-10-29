import type { DeviceInfo, HostCapabilities, HostKind } from '@studio/platform-contracts';

export function detectHostCapabilities(win: Window & typeof globalThis = window): HostCapabilities {
  const nav = win.navigator;
  const AudioContextCtor = win.AudioContext as typeof AudioContext | undefined;
  return {
    webMidi: typeof (nav as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function',
    audioWorklet: Boolean(AudioContextCtor && 'audioWorklet' in AudioContextCtor.prototype),
    offlineAudioContext: typeof win.OfflineAudioContext === 'function',
    getUserMedia: typeof nav.mediaDevices?.getUserMedia === 'function',
    fileSystemAccess: typeof (win as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function',
    sharedArrayBuffer: typeof SharedArrayBuffer === 'function' && win.crossOriginIsolated === true,
    indexedDb: typeof win.indexedDB !== 'undefined',
  };
}

export function createBrowserDeviceInfo(hostKind: HostKind = 'browser', win: Window & typeof globalThis = window): DeviceInfo {
  const nav = win.navigator as Navigator & { userAgentData?: { platform?: string } };
  return {
    hostKind,
    platform: nav.userAgentData?.platform ?? nav.platform ?? 'unknown',
    userAgent: nav.userAgent,
    capabilities: detectHostCapabilities(win),
    coarsePointer: win.matchMedia?.('(pointer: coarse)').matches ?? false,
  };
}
