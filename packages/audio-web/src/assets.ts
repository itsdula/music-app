/**
 * Asset buffer cache: decoded PCM from the host's AssetPcmSource converted to
 * AudioBuffers (at the asset's native sample rate — AudioBufferSourceNode resamples on
 * playback), plus per-asset overrides (vocal correction previews).
 *
 * AudioBuffers are not bound to a context, so the same cache serves the realtime
 * context and offline renders.
 */
import type { AssetPcmSource, AudioEngineEvent, EngineLogger } from '@studio/audio-contracts';
import { pcmFrames, validatePcm, type PcmAudio } from '@studio/audio-dsp';
import type { AssetId } from '@studio/domain';
import { describeError } from './errors';

/** Copies planar PCM into a new AudioBuffer (≥ 1 frame; Web Audio forbids empty buffers). */
export function pcmToAudioBuffer(pcm: PcmAudio): AudioBuffer {
  const problem = validatePcm(pcm);
  if (problem) throw new Error(`Invalid PCM: ${problem}`);
  const buffer = new AudioBuffer({
    length: Math.max(1, pcmFrames(pcm)),
    numberOfChannels: pcm.channels.length,
    sampleRate: pcm.sampleRate,
  });
  pcm.channels.forEach((channel, c) => buffer.getChannelData(c).set(channel));
  return buffer;
}

/** Copies an AudioBuffer into planar PCM (new arrays). */
export function audioBufferToPcm(buffer: AudioBuffer): PcmAudio {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
  return { sampleRate: buffer.sampleRate, channels };
}

type Entry =
  | { readonly status: 'loading'; readonly promise: Promise<AudioBuffer | null> }
  | { readonly status: 'ready'; readonly buffer: AudioBuffer }
  | { readonly status: 'error'; readonly message: string };

export class AssetBufferStore {
  private readonly entries = new Map<AssetId, Entry>();
  private readonly overrides = new Map<AssetId, AudioBuffer>();

  constructor(
    private readonly source: AssetPcmSource,
    private readonly emit: (event: AudioEngineEvent) => void,
    private readonly logger: EngineLogger,
  ) {}

  /** Buffer used for playback: the override when set, else the loaded asset. */
  get(assetId: AssetId): AudioBuffer | undefined {
    const override = this.overrides.get(assetId);
    if (override) return override;
    const entry = this.entries.get(assetId);
    return entry?.status === 'ready' ? entry.buffer : undefined;
  }

  status(assetId: AssetId): Entry['status'] | 'unknown' {
    return this.entries.get(assetId)?.status ?? 'unknown';
  }

  /**
   * Loads an asset once (concurrent callers share the request). Resolves to null on
   * failure; failures are reported through `asset` events, never thrown. A failed asset
   * is retried on the next call.
   */
  ensure(assetId: AssetId): Promise<AudioBuffer | null> {
    const entry = this.entries.get(assetId);
    if (entry?.status === 'ready') return Promise.resolve(entry.buffer);
    if (entry?.status === 'loading') return entry.promise;
    this.emit({ type: 'asset', assetId, status: 'loading' });
    const promise = this.source
      .load(assetId)
      .then((pcm) => {
        const buffer = pcmToAudioBuffer(pcm);
        this.entries.set(assetId, { status: 'ready', buffer });
        this.emit({ type: 'asset', assetId, status: 'ready' });
        return buffer;
      })
      .catch((error: unknown) => {
        const message = describeError(error);
        this.entries.set(assetId, { status: 'error', message });
        this.logger.warn('asset load failed', { assetId, message });
        this.emit({ type: 'asset', assetId, status: 'error', message });
        this.emit({
          type: 'error',
          error: {
            code: 'asset-missing',
            message: `Asset ${assetId} could not be loaded`,
            detail: message,
          },
        });
        return null;
      });
    this.entries.set(assetId, { status: 'loading', promise });
    return promise;
  }

  /** Sets (or clears with null) the override buffer for an asset. */
  setOverride(assetId: AssetId, pcm: PcmAudio | null): void {
    if (pcm === null) this.overrides.delete(assetId);
    else this.overrides.set(assetId, pcmToAudioBuffer(pcm));
  }

  hasOverride(assetId: AssetId): boolean {
    return this.overrides.has(assetId);
  }

  remove(assetId: AssetId): void {
    this.entries.delete(assetId);
  }

  clear(): void {
    this.entries.clear();
    this.overrides.clear();
  }
}
