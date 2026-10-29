import { DEFAULT_VOCAL_ANALYSIS_PARAMS, type VocalAnalysisParams } from './types';

/**
 * Merges a partial parameter set with the defaults and validates it.
 * Throws `RangeError` for values outside their documented domain.
 */
export function resolveVocalAnalysisParams(
  params?: Partial<VocalAnalysisParams>,
): VocalAnalysisParams {
  const resolved: VocalAnalysisParams = { ...DEFAULT_VOCAL_ANALYSIS_PARAMS, ...params };
  const finite = (name: keyof VocalAnalysisParams): void => {
    if (!Number.isFinite(resolved[name])) throw new RangeError(`${name} must be finite`);
  };
  (Object.keys(DEFAULT_VOCAL_ANALYSIS_PARAMS) as (keyof VocalAnalysisParams)[]).forEach(finite);
  if (resolved.minHz < 20) throw new RangeError('minHz must be >= 20');
  if (resolved.maxHz <= resolved.minHz * 1.5) {
    throw new RangeError('maxHz must exceed minHz by at least a fifth');
  }
  if (resolved.frameSeconds < 0.01 || resolved.frameSeconds > 0.2) {
    throw new RangeError('frameSeconds must be within 0.01..0.2');
  }
  if (resolved.hopSeconds < 0.001 || resolved.hopSeconds > resolved.frameSeconds) {
    throw new RangeError('hopSeconds must be within 0.001..frameSeconds');
  }
  if (resolved.voicingThreshold <= 0 || resolved.voicingThreshold >= 1) {
    throw new RangeError('voicingThreshold must be within (0, 1)');
  }
  if (resolved.minNoteSeconds < 0 || resolved.minNoteSeconds > 2) {
    throw new RangeError('minNoteSeconds must be within 0..2');
  }
  return resolved;
}

/** Sample-domain framing derived from the parameters at a given sample rate. */
export interface FrameLayout {
  readonly sampleRate: number;
  /** Integer hop in samples; `hopSeconds` below is the exact hop used. */
  readonly hopSamples: number;
  readonly hopSeconds: number;
  /** Analysis window N (samples), used for RMS and spectral features. */
  readonly frameSamples: number;
  /** Frame count for a signal of `length` samples: frames centred at 0, hop, 2·hop, … */
  frameCountFor(length: number): number;
}

export function frameLayout(sampleRate: number, params: VocalAnalysisParams): FrameLayout {
  const hopSamples = Math.max(1, Math.round(params.hopSeconds * sampleRate));
  const frameSamples = Math.max(16, Math.round(params.frameSeconds * sampleRate));
  return {
    sampleRate,
    hopSamples,
    hopSeconds: hopSamples / sampleRate,
    frameSamples,
    frameCountFor: (length: number) =>
      length <= 0 ? 0 : Math.floor((length - 1) / hopSamples) + 1,
  };
}
