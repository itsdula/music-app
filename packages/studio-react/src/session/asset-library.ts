/**
 * Asset intake and caches. Owns: decoding imported files, storing bytes in the
 * AssetRepository, in-memory decoded PCM (also the engine's `AssetPcmSource`), and peak
 * pyramids for waveform drawing (memory + derived cache keyed by content hash).
 */
import type { AssetPcmSource } from '@studio/audio-contracts';
import {
  buildPeakPyramid,
  encodeWav,
  pcmFrames,
  readPeaks,
  type PcmAudio,
  type PeakPyramid,
} from '@studio/audio-dsp';
import type { AssetId, AssetRef, AssetSource, IdFactory, Project } from '@studio/domain';
import type { PickedFile, PlatformServices } from '@studio/platform-contracts';
import { derivedCacheKey } from '@studio/project-storage';

const PEAKS_VERSION = 'v1';

export interface ImportedAsset {
  readonly asset: AssetRef;
  readonly pcm: PcmAudio;
  /** True when an identical asset already existed in the project and was reused. */
  readonly reused: boolean;
}

export class AssetImportError extends Error {
  constructor(
    message: string,
    readonly fileName: string,
  ) {
    super(message);
    this.name = 'AssetImportError';
  }
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export class AssetLibrary implements AssetPcmSource {
  private readonly pcm = new Map<AssetId, PcmAudio>();
  private readonly loading = new Map<AssetId, Promise<PcmAudio>>();
  private readonly pyramids = new Map<AssetId, PeakPyramid>();
  private readonly pyramidJobs = new Set<AssetId>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly platform: PlatformServices,
    private readonly getProject: () => Project,
    private readonly ids: IdFactory,
  ) {}

  /** AssetPcmSource: decoded PCM for an asset (memory → repository → decode). */
  load(assetId: AssetId): Promise<PcmAudio> {
    const cached = this.pcm.get(assetId);
    if (cached) return Promise.resolve(cached);
    const inFlight = this.loading.get(assetId);
    if (inFlight) return inFlight;
    const job = (async () => {
      const record = await this.platform.assetRepository.get(assetId);
      if (!record) throw new Error(`Asset ${assetId} is missing from storage`);
      const pcm = await this.platform.audioDecoder.decode(record.bytes, {
        mimeType: record.meta.mimeType,
        fileName: record.meta.name,
      });
      this.pcm.set(assetId, pcm);
      this.ensurePeaks(assetId, pcm, record.meta.contentHash);
      return pcm;
    })();
    this.loading.set(assetId, job);
    job.finally(() => this.loading.delete(assetId)).catch(() => undefined);
    return job;
  }

  getLoadedPcm(assetId: AssetId): PcmAudio | undefined {
    return this.pcm.get(assetId);
  }

  async importFile(file: PickedFile): Promise<ImportedAsset> {
    if (!this.platform.audioDecoder.canDecode(file.mimeType, file.name)) {
      throw new AssetImportError(
        `“${file.name}” is not an audio format this browser can decode.`,
        file.name,
      );
    }
    const contentHash = await this.platform.hasher.sha256(file.bytes);
    const existing = Object.values(this.getProject().assets).find(
      (a) => a.contentHash === contentHash,
    );
    if (existing) return { asset: existing, pcm: await this.load(existing.id), reused: true };
    let pcm: PcmAudio;
    try {
      pcm = await this.platform.audioDecoder.decode(file.bytes, {
        mimeType: file.mimeType,
        fileName: file.name,
      });
    } catch (error) {
      throw new AssetImportError(
        `Could not decode “${file.name}”: ${error instanceof Error ? error.message : String(error)}`,
        file.name,
      );
    }
    const asset = this.describe(
      stripExtension(file.name),
      file.mimeType,
      pcm,
      contentHash,
      file.bytes.byteLength,
      'import',
    );
    await this.platform.assetRepository.put({ meta: asset, bytes: file.bytes });
    this.pcm.set(asset.id, pcm);
    this.ensurePeaks(asset.id, pcm, contentHash);
    return { asset, pcm, reused: false };
  }

  /** Stores PCM produced inside Studio (recordings, renders) as a 32-bit float WAV asset. */
  async addPcm(pcm: PcmAudio, name: string, source: AssetSource): Promise<AssetRef> {
    const bytes = encodeWav(pcm, { bitDepth: 32 });
    const contentHash = await this.platform.hasher.sha256(bytes);
    const asset = this.describe(name, 'audio/wav', pcm, contentHash, bytes.byteLength, source);
    await this.platform.assetRepository.put({ meta: asset, bytes });
    this.pcm.set(asset.id, pcm);
    this.ensurePeaks(asset.id, pcm, contentHash);
    return asset;
  }

  /** Interleaved [min, max] peaks for drawing, or null while not yet available. */
  readPeaks(
    assetId: AssetId,
    startFrame: number,
    endFrame: number,
    columns: number,
  ): Float32Array | null {
    const pyramid = this.pyramids.get(assetId);
    if (pyramid) return readPeaks(pyramid, startFrame, endFrame, columns);
    if (!this.loading.has(assetId) && !this.pcm.has(assetId) && this.getProject().assets[assetId]) {
      this.load(assetId).catch((error: unknown) =>
        this.platform.logger.warn('Asset load failed', error),
      );
    }
    return null;
  }

  /** Notified when new peaks become available (canvas redraw trigger). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Decodes every asset referenced by the project (e.g. after opening it). */
  async preload(project: Project): Promise<void> {
    await Promise.allSettled(Object.keys(project.assets).map((id) => this.load(id as AssetId)));
  }

  clear(): void {
    this.pcm.clear();
    this.pyramids.clear();
  }

  private describe(
    name: string,
    mimeType: string,
    pcm: PcmAudio,
    contentHash: string,
    byteLength: number,
    source: AssetSource,
  ): AssetRef {
    return {
      id: this.ids.create('asset'),
      name,
      kind: 'audio',
      mimeType,
      sampleRate: pcm.sampleRate,
      channels: pcm.channels.length,
      frames: pcmFrames(pcm),
      contentHash,
      byteLength,
      source,
      createdAt: this.platform.now(),
    };
  }

  private ensurePeaks(assetId: AssetId, pcm: PcmAudio, contentHash: string): void {
    if (this.pyramids.has(assetId) || this.pyramidJobs.has(assetId)) return;
    this.pyramidJobs.add(assetId);
    const key = derivedCacheKey({
      kind: 'peaks',
      contentHash,
      algorithmVersion: PEAKS_VERSION,
      paramsHash: '-',
    });
    void (async () => {
      try {
        let pyramid = await this.platform.derivedCache.get<PeakPyramid>(key);
        if (!pyramid) {
          pyramid = buildPeakPyramid(pcm);
          await this.platform.derivedCache.put(key, pyramid).catch(() => undefined);
        }
        this.pyramids.set(assetId, pyramid);
        for (const listener of this.listeners) listener();
      } catch (error) {
        this.platform.logger.warn('Peak computation failed', error);
      } finally {
        this.pyramidJobs.delete(assetId);
      }
    })();
  }
}
