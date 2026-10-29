/**
 * Vocal analysis/correction jobs for the vocal editor: runs analysis in the platform's
 * VocalProcessor (a Worker in browsers), caches results by content hash + algorithm
 * version, creates the non-destructive edit document, and keeps a preview render of the
 * current edits playing through `AudioEngine.setAssetOverride` (A/B = override on/off).
 */
import type { AudioEngine } from '@studio/audio-contracts';
import { encodeWav, type PcmAudio } from '@studio/audio-dsp';
import type { CommandHistory } from '@studio/commands';
import {
  DEFAULT_VOCAL_CORRECTION,
  type AssetId,
  type Project,
  type VocalEditDoc,
} from '@studio/domain';
import type { PlatformServices } from '@studio/platform-contracts';
import { derivedCacheKey } from '@studio/project-storage';
import {
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  VOCAL_ALGORITHM_VERSION,
  VocalJobCancelledError,
  type VocalAnalysis,
  type VocalProcessor,
} from '@studio/vocal-dsp';
import {
  IDLE_VOCAL_STATE,
  createVocalStore,
  type VocalAssetState,
  type VocalStore,
} from '../state/vocal-store';
import type { AssetLibrary } from './asset-library';
import { safeFileName } from './export-controller';

const PREVIEW_DEBOUNCE_MS = 250;

function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function copyPcm(pcm: PcmAudio): PcmAudio {
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice()) };
}

export class VocalController {
  readonly store: VocalStore = createVocalStore();
  private processor: VocalProcessor | null = null;
  private readonly analyses = new Map<AssetId, VocalAnalysis>();
  private readonly aborts = new Map<AssetId, AbortController>();
  private readonly previewTimers = new Map<AssetId, ReturnType<typeof setTimeout>>();
  private readonly previewVersions = new Map<AssetId, number>();
  private readonly detach: () => void;
  private lastDocs: Project['vocalEdits'];

  constructor(
    private readonly platform: PlatformServices,
    private readonly history: CommandHistory,
    private readonly engine: AudioEngine,
    private readonly assets: AssetLibrary,
  ) {
    this.lastDocs = history.present.vocalEdits;
    this.detach = history.subscribe(({ present }) => this.onProjectChange(present));
  }

  private getProcessor(): VocalProcessor {
    if (!this.processor) this.processor = this.platform.createVocalProcessor();
    return this.processor;
  }

  private patch(assetId: AssetId, patch: Partial<VocalAssetState>): void {
    this.store.setState((s) => ({
      assets: { ...s.assets, [assetId]: { ...(s.assets[assetId] ?? IDLE_VOCAL_STATE), ...patch } },
    }));
  }

  getAnalysis(assetId: AssetId): VocalAnalysis | undefined {
    return this.analyses.get(assetId);
  }

  get capabilities() {
    return this.getProcessor().capabilities;
  }

  /** Analyses (or loads cached analysis for) an asset and ensures an edit document exists. */
  async analyze(assetId: AssetId): Promise<VocalAnalysis | null> {
    const asset = this.history.present.assets[assetId];
    if (!asset) return null;
    this.aborts.get(assetId)?.abort();
    const abort = new AbortController();
    this.aborts.set(assetId, abort);
    this.patch(assetId, { phase: 'analyzing', progress: 0, error: null });
    const params = DEFAULT_VOCAL_ANALYSIS_PARAMS;
    const key = derivedCacheKey({
      kind: 'vocal-analysis',
      contentHash: asset.contentHash,
      algorithmVersion: VOCAL_ALGORITHM_VERSION.replace(/[^A-Za-z0-9_.+-]/g, '_'),
      paramsHash: hashString(JSON.stringify(params)),
    });
    try {
      let analysis = await this.platform.derivedCache.get<VocalAnalysis>(key);
      if (!analysis) {
        const pcm = await this.assets.load(assetId);
        analysis = await this.getProcessor().analyze(copyPcm(pcm), params, {
          signal: abort.signal,
          onProgress: (progress) => this.patch(assetId, { progress }),
        });
        await this.platform.derivedCache.put(key, analysis).catch(() => undefined);
      }
      if (abort.signal.aborted) return null;
      this.analyses.set(assetId, analysis);
      const version = (this.store.getState().assets[assetId]?.analysisVersion ?? 0) + 1;
      this.patch(assetId, { phase: 'ready', progress: 1, analysisVersion: version });
      this.ensureDoc(assetId, analysis, key);
      return analysis;
    } catch (error) {
      if (error instanceof VocalJobCancelledError || abort.signal.aborted) {
        this.patch(assetId, { phase: 'idle', progress: 0 });
        return null;
      }
      this.patch(assetId, {
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      if (this.aborts.get(assetId) === abort) this.aborts.delete(assetId);
    }
  }

  cancel(assetId: AssetId): void {
    this.aborts.get(assetId)?.abort();
  }

  private ensureDoc(assetId: AssetId, analysis: VocalAnalysis, analysisKey: string): void {
    const existing = this.history.present.vocalEdits[assetId];
    if (existing && existing.analysisKey === analysisKey) return;
    const doc: VocalEditDoc = {
      assetId,
      analysisKey,
      algorithmVersion: analysis.algorithmVersion,
      segments: analysis.segments,
      noteEdits: {},
      correction: { ...DEFAULT_VOCAL_CORRECTION, key: analysis.keyCandidates[0]?.key ?? null },
      enabled: true,
      keyCandidates: analysis.keyCandidates,
    };
    this.history.execute({ type: 'vocal.setDoc', doc }, { label: 'Analyze Vocal' });
  }

  private onProjectChange(project: Project): void {
    const docs = project.vocalEdits;
    if (docs === this.lastDocs) return;
    const previous = this.lastDocs;
    this.lastDocs = docs;
    for (const [assetId, doc] of Object.entries(docs) as Array<[AssetId, VocalEditDoc]>) {
      if (previous[assetId] !== doc) this.schedulePreview(assetId);
    }
    for (const assetId of Object.keys(previous) as AssetId[]) {
      if (!docs[assetId]) void this.engine.setAssetOverride(assetId, null);
    }
  }

  /** Debounced preview render of the current edits (latest edit wins). */
  schedulePreview(assetId: AssetId): void {
    const existing = this.previewTimers.get(assetId);
    if (existing) clearTimeout(existing);
    this.previewTimers.set(
      assetId,
      setTimeout(() => {
        this.previewTimers.delete(assetId);
        void this.renderPreview(assetId);
      }, PREVIEW_DEBOUNCE_MS),
    );
  }

  private async renderPreview(assetId: AssetId): Promise<void> {
    const doc = this.history.present.vocalEdits[assetId];
    const analysis = this.analyses.get(assetId);
    if (!doc || !doc.enabled || !analysis) {
      await this.engine.setAssetOverride(assetId, null);
      return;
    }
    const version = (this.previewVersions.get(assetId) ?? 0) + 1;
    this.previewVersions.set(assetId, version);
    this.patch(assetId, { rendering: true });
    try {
      const source = await this.assets.load(assetId);
      const rendered = await this.getProcessor().render({
        source: copyPcm(source),
        analysis,
        edits: doc,
        // The override is also what bounces play, and in JS 'final' costs the same as
        // 'preview' (docs/vocal-dsp.md §7), so render playback at final quality.
        quality: 'final',
      });
      if (this.previewVersions.get(assetId) !== version) return; // a newer edit superseded this render
      await this.engine.setAssetOverride(assetId, rendered);
      // A successful render clears a previous preview failure shown in the editor.
      if (this.store.getState().assets[assetId]?.error) this.patch(assetId, { error: null });
    } catch (error) {
      if (!(error instanceof VocalJobCancelledError)) {
        this.patch(assetId, { error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (this.previewVersions.get(assetId) === version) this.patch(assetId, { rendering: false });
    }
  }

  /** Final-quality render of the corrected vocal, saved as a WAV file. */
  async exportCorrected(assetId: AssetId): Promise<boolean> {
    const doc = this.history.present.vocalEdits[assetId];
    const analysis = this.analyses.get(assetId);
    const asset = this.history.present.assets[assetId];
    if (!doc || !analysis || !asset)
      throw new Error('Analyze the vocal before exporting the correction.');
    const source = await this.assets.load(assetId);
    const rendered = await this.getProcessor().render({
      source: copyPcm(source),
      analysis,
      edits: { ...doc, enabled: true },
      quality: 'final',
    });
    const bytes = encodeWav(rendered, { bitDepth: 24 });
    return this.platform.fileDialogs.saveFile(bytes, {
      suggestedName: `${safeFileName(asset.name)} (corrected).wav`,
      mimeType: 'audio/wav',
    });
  }

  dispose(): void {
    this.detach();
    for (const t of this.previewTimers.values()) clearTimeout(t);
    for (const a of this.aborts.values()) a.abort();
    this.processor?.dispose();
    this.processor = null;
  }
}
