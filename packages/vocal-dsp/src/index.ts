export * from './types';
export { VOCAL_ALGORITHM_VERSION } from './version';
export { resolveVocalAnalysisParams, frameLayout, type FrameLayout } from './params';
export { type StageHooks } from './internal/steps';
export { analyzeVocal } from './analyze';
export {
  trackPitch,
  PITCH_BIN_CENTS,
  MAX_TRANSITION_OCTAVES_PER_SECOND,
  VOICING_SWITCH_PROB,
  VOICING_CMNDF_MIDPOINT,
  VOICING_CMNDF_SLOPE,
} from './pitch/pyin';
export {
  classifyNonPitched,
  SIBILANT_MIN_HZ,
  SIBILANT_MIN_SECONDS,
  BREATH_MIN_SECONDS,
} from './nonpitched';
export { segmentNotes, peltChangePoints, SEGMENTATION_PARAMS } from './segmentation';
export { analyzeNoteExpression, EXPRESSION_PARAMS, type VocalNoteExpression } from './expression';
export {
  estimateKey,
  keyCandidatesFromSegments,
  estimateTuningOffset,
  pitchClassHistogram,
  scoreKeys,
  KEY_SOFTMAX_TEMPERATURE,
  KEY_MAX_CANDIDATES,
  type KeyNote,
  type KeyScore,
} from './key';
export {
  computeTargetPitchCurve,
  computePitchRatioCurve,
  autoTargetMidi,
  pitchTrackMidi,
  CORRECTION_PARAMS,
  IDENTITY_EPSILON_SEMITONES,
} from './correction';
export { detectPitchMarks, PITCH_MARK_PARAMS } from './render/pitch-marks';
export { renderPitchCorrection, PSOLA_PARAMS } from './render/psola';
export { splitSegment, mergeSegments } from './segment-edit';
export {
  createInlineVocalProcessor,
  VOCAL_PROCESSOR_CAPABILITIES,
  VocalProcessorDisposedError,
} from './processor';
export {
  handleVocalWorkerRequest,
  isVocalWorkerRequest,
  isVocalWorkerResponse,
  VOCAL_WORKER_PROTOCOL_VERSION,
  type VocalWorkerRequest,
  type VocalWorkerResponse,
  type VocalWorkerPost,
} from './worker-protocol';
export {
  createWorkerVocalProcessor,
  VocalWorkerError,
  type VocalWorkerLike,
  type WorkerVocalProcessorOptions,
} from './worker-processor';
