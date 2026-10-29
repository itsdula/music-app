import { type VocalNoteId, type VocalNoteSegment } from '@studio/domain';
import { analyzeExpressionOfFrames, voicedFramesIn } from './expression';
import { type PitchTrack } from './types';

/**
 * Builds a segment for [startSeconds, endSeconds) with centre, confidence, vibrato and
 * drift re-estimated from the pitch track. `fallbackMidi` is used when the range holds
 * no voiced frame (confidence is then 0).
 *
 * confidence = mean voiced probability of the voiced frames × voiced fraction of the range.
 */
export function describeSegment(
  track: PitchTrack,
  id: VocalNoteId,
  startSeconds: number,
  endSeconds: number,
  fallbackMidi: number,
): VocalNoteSegment {
  const frames = voicedFramesIn(track, startSeconds, endSeconds);
  const expression = analyzeExpressionOfFrames(frames, startSeconds, endSeconds);
  let probability = 0;
  for (let i = 0; i < frames.probability.length; i++) probability += frames.probability[i]!;
  const voiced = frames.times.length;
  const confidence =
    voiced > 0 && frames.totalFrames > 0
      ? (probability / voiced) * (voiced / frames.totalFrames)
      : 0;
  const hasPitch = Number.isFinite(expression.centreMidi);
  return {
    id,
    startSeconds,
    endSeconds,
    detectedMidi: hasPitch ? expression.centreMidi : fallbackMidi,
    confidence: Math.min(1, Math.max(0, confidence)),
    vibratoDepthCents: expression.vibratoDepthCents,
    vibratoRateHz: expression.vibratoRateHz,
    driftCents: expression.driftCents,
  };
}

/**
 * Splits a note at `atSeconds` (strictly inside it). Both halves are re-estimated from
 * the pitch track; a half without voiced frames keeps the original centre and gets
 * confidence 0.
 */
export function splitSegment(
  track: PitchTrack,
  segment: VocalNoteSegment,
  atSeconds: number,
  ids: readonly [VocalNoteId, VocalNoteId],
): readonly [VocalNoteSegment, VocalNoteSegment] {
  if (!(atSeconds > segment.startSeconds && atSeconds < segment.endSeconds)) {
    throw new RangeError(
      `split point ${atSeconds}s is outside segment ${segment.startSeconds}..${segment.endSeconds}s`,
    );
  }
  if (ids[0] === ids[1]) throw new RangeError('split segments need two distinct ids');
  return [
    describeSegment(track, ids[0], segment.startSeconds, atSeconds, segment.detectedMidi),
    describeSegment(track, ids[1], atSeconds, segment.endSeconds, segment.detectedMidi),
  ];
}

/** Merges two notes (in either order) into one spanning both, re-estimated from the track. */
export function mergeSegments(
  track: PitchTrack,
  a: VocalNoteSegment,
  b: VocalNoteSegment,
  id: VocalNoteId,
): VocalNoteSegment {
  const startSeconds = Math.min(a.startSeconds, b.startSeconds);
  const endSeconds = Math.max(a.endSeconds, b.endSeconds);
  const durationA = a.endSeconds - a.startSeconds;
  const durationB = b.endSeconds - b.startSeconds;
  const fallback =
    durationA + durationB > 0
      ? (a.detectedMidi * durationA + b.detectedMidi * durationB) / (durationA + durationB)
      : a.detectedMidi;
  return describeSegment(track, id, startSeconds, endSeconds, fallback);
}
