/**
 * Microphone input shared by monitoring and recording: one getUserMedia stream per
 * (device, channel count), reference-counted, with browser voice processing disabled
 * (echo cancellation, noise suppression and AGC alter the signal and add latency).
 */
import { microphoneError } from '../errors';

export interface AudioInputHandle {
  readonly stream: MediaStream;
  readonly source: MediaStreamAudioSourceNode;
  readonly label: string;
  readonly channelCount: number;
  /** Input latency reported by the track settings (seconds), when available. */
  readonly latencySeconds: number | null;
}

interface Entry {
  readonly handle: AudioInputHandle;
  users: number;
}

export class InputManager {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry>>();

  constructor(private readonly ctx: AudioContext) {}

  private key(deviceId: string | undefined, channelCount: number): string {
    return `${deviceId ?? 'default'}|${channelCount}`;
  }

  /** Opens (or shares) an input; throws AudioEngineError microphone-denied/-unavailable. */
  async acquire(deviceId: string | undefined, channelCount: 1 | 2): Promise<AudioInputHandle> {
    const key = this.key(deviceId, channelCount);
    const existing = this.entries.get(key);
    if (existing) {
      existing.users++;
      return existing.handle;
    }
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.open(deviceId, channelCount);
      this.pending.set(key, promise);
    }
    try {
      const entry = await promise;
      entry.users++;
      this.entries.set(key, entry);
      return entry.handle;
    } finally {
      this.pending.delete(key);
    }
  }

  private async open(deviceId: string | undefined, channelCount: 1 | 2): Promise<Entry> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw microphoneError(
        Object.assign(new Error('getUserMedia is not available'), { name: 'NotFoundError' }),
      );
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          channelCount: { ideal: channelCount },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (error) {
      throw microphoneError(error);
    }
    const track = stream.getAudioTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      throw microphoneError(
        Object.assign(new Error('stream has no audio track'), { name: 'NotFoundError' }),
      );
    }
    const settings = track.getSettings() as MediaTrackSettings & { latency?: number };
    const source = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream });
    return {
      users: 0,
      handle: {
        stream,
        source,
        label: track.label || 'Audio input',
        channelCount: settings.channelCount ?? channelCount,
        latencySeconds: typeof settings.latency === 'number' ? settings.latency : null,
      },
    };
  }

  release(handle: AudioInputHandle): void {
    for (const [key, entry] of this.entries) {
      if (entry.handle !== handle) continue;
      entry.users--;
      if (entry.users <= 0) {
        this.entries.delete(key);
        handle.source.disconnect();
        for (const track of handle.stream.getTracks()) track.stop();
      }
      return;
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      entry.handle.source.disconnect();
      for (const track of entry.handle.stream.getTracks()) track.stop();
    }
    this.entries.clear();
  }
}
