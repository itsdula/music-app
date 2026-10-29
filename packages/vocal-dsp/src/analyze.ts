import { downmixToMono, pcmDurationSeconds, validatePcm, type PcmAudio } from '@studio/audio-dsp';
import { runSteps, scaleSteps, type StageHooks, type Steps } from './internal/steps';
import { keyCandidatesFromSegments } from './key';
import { classifyNonPitched } from './nonpitched';
import { resolveVocalAnalysisParams } from './params';
import { trackPitchSteps } from './pitch/pyin';
import { segmentNotes } from './segmentation';
import { type VocalAnalysis, type VocalAnalysisParams } from './types';
import { VOCAL_ALGORITHM_VERSION } from './version';

/** Throws a RangeError for PCM that violates the planar layout invariants. */
export function assertValidPcm(source: PcmAudio): void {
  const problem = validatePcm(source);
  if (problem !== null) throw new RangeError(`invalid PCM: ${problem}`);
}

export function* analyzeVocalSteps(
  source: PcmAudio,
  params?: Partial<VocalAnalysisParams>,
): Steps<VocalAnalysis> {
  assertValidPcm(source);
  const resolved = resolveVocalAnalysisParams(params);
  const mono = downmixToMono(source);
  const sampleRate = source.sampleRate;
  const pitchTrack = yield* scaleSteps(trackPitchSteps(mono, sampleRate, resolved), 0, 0.9);
  const nonPitched = classifyNonPitched(mono, sampleRate, pitchTrack, resolved);
  yield 0.93;
  const segments = segmentNotes(pitchTrack, resolved);
  yield 0.98;
  const keyCandidates = keyCandidatesFromSegments(segments);
  return {
    algorithmVersion: VOCAL_ALGORITHM_VERSION,
    params: resolved,
    durationSeconds: pcmDurationSeconds(source),
    pitchTrack,
    segments,
    nonPitched,
    keyCandidates,
  };
}

/**
 * Full monophonic vocal analysis: pitch track, non-pitched regions, notes (with
 * vibrato/drift) and key candidates. Synchronous and deterministic; throws
 * `VocalJobCancelledError` when `hooks.shouldCancel` returns true at a chunk boundary.
 */
export function analyzeVocal(
  source: PcmAudio,
  params?: Partial<VocalAnalysisParams>,
  hooks?: StageHooks,
): VocalAnalysis {
  return runSteps(analyzeVocalSteps(source, params), hooks);
}
