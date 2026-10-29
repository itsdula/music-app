/**
 * Data contracts for monophonic vocal analysis and correction.
 *
 * Typed arrays (`Float32Array`) are used for per-frame series; they are transferable
 * across Worker boundaries and storable in IndexedDB via structured clone. They are
 * never placed in the persistent project model — only `VocalNoteSegment`s (small JSON)
 * are copied into `Project.vocalEdits` when the user accepts an analysis.
 */
import type { KeyCandidate, VocalEditDoc, VocalNoteSegment } from '@studio/domain';
import type { PcmAudio } from '@studio/audio-dsp';

export interface VocalAnalysisParams {
  /** Lowest/highest fundamental considered, Hz. */
  readonly minHz: number;
  readonly maxHz: number;
  /** Analysis window length and hop, in seconds (converted to samples at the source rate). */
  readonly frameSeconds: number;
  readonly hopSeconds: number;
  /** Frames whose voiced probability falls below this are unvoiced. 0..1 */
  readonly voicingThreshold: number;
  /** Frames quieter than this (dBFS RMS) are treated as silence. */
  readonly silenceThresholdDb: number;
  /** Minimum note duration kept by segmentation, seconds. */
  readonly minNoteSeconds: number;
}

export const DEFAULT_VOCAL_ANALYSIS_PARAMS: VocalAnalysisParams = {
  minHz: 65,
  maxHz: 1100,
  frameSeconds: 0.046,
  hopSeconds: 0.005,
  voicingThreshold: 0.5,
  silenceThresholdDb: -50,
  minNoteSeconds: 0.06,
};

/** Constant-hop pitch track. Frame i is centred at `firstFrameSeconds + i * hopSeconds`. */
export interface PitchTrack {
  readonly sampleRate: number;
  readonly hopSeconds: number;
  readonly firstFrameSeconds: number;
  readonly frameCount: number;
  /** Fundamental frequency per frame in Hz; 0 marks unvoiced frames. */
  readonly f0Hz: Float32Array;
  /** Probability that the frame is voiced, 0..1. */
  readonly voicedProbability: Float32Array;
  /** Frame RMS level in dBFS. */
  readonly rmsDb: Float32Array;
}

export type NonPitchedKind = 'silence' | 'unvoiced' | 'breath' | 'sibilant';

export interface NonPitchedRegion {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly kind: NonPitchedKind;
}

export interface VocalAnalysis {
  /** Changes whenever output could change for identical input (bump on algorithm/param changes). */
  readonly algorithmVersion: string;
  readonly params: VocalAnalysisParams;
  readonly durationSeconds: number;
  readonly pitchTrack: PitchTrack;
  readonly segments: readonly VocalNoteSegment[];
  readonly nonPitched: readonly NonPitchedRegion[];
  /** Ranked best-first; confidences sum to <= 1. */
  readonly keyCandidates: readonly KeyCandidate[];
}

export type VocalRenderQuality = 'preview' | 'final';

export interface VocalRenderRequest {
  readonly source: PcmAudio;
  readonly analysis: VocalAnalysis;
  readonly edits: VocalEditDoc;
  readonly quality: VocalRenderQuality;
}

export interface VocalProcessorCapabilities {
  /** Human-readable algorithm name, e.g. 'td-psola'. */
  readonly algorithm: string;
  readonly formantPreservation: boolean;
  readonly formantShift: boolean;
  readonly timeStretch: boolean;
}

export interface VocalJobOptions {
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (fraction: number) => void;
}

/** Structural subset of DOM AbortSignal (portable packages have no DOM typings). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export class VocalJobCancelledError extends Error {
  constructor() {
    super('Vocal processing job was cancelled');
    this.name = 'VocalJobCancelledError';
  }
}

/**
 * Port implemented in-process (`createInlineVocalProcessor`, this package), in a Web
 * Worker (@studio/audio-web) and, later, by a Rust/WASM module — callers never change.
 *
 * "Preview" is realised as a fast `render(..., quality: 'preview')` whose result the
 * session plays through `AudioEngine.setAssetOverride`; musical edits are identical for
 * preview and final renders, only processing quality settings may differ (documented in
 * docs/vocal-dsp.md).
 */
export interface VocalProcessor {
  readonly capabilities: VocalProcessorCapabilities;
  analyze(
    source: PcmAudio,
    params: VocalAnalysisParams,
    options?: VocalJobOptions,
  ): Promise<VocalAnalysis>;
  render(request: VocalRenderRequest, options?: VocalJobOptions): Promise<PcmAudio>;
  dispose(): void;
}
