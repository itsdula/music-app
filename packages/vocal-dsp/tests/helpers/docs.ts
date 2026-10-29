import {
  asAssetId,
  DEFAULT_VOCAL_CORRECTION,
  DEFAULT_VOCAL_NOTE_EDIT,
  type VocalCorrectionSettings,
  type VocalEditDoc,
  type VocalNoteEdit,
  type VocalNoteId,
  type VocalNoteSegment,
} from '@studio/domain';
import { type PcmAudio } from '@studio/audio-dsp';
import { type VocalAnalysis } from '../../src/index';

/** Builds an edit document for an analysis (segments copied from the analysis by default). */
export function editDoc(
  analysis: Pick<VocalAnalysis, 'segments' | 'algorithmVersion' | 'keyCandidates'>,
  options: {
    readonly edits?: Readonly<Record<string, Partial<VocalNoteEdit>>>;
    readonly correction?: Partial<VocalCorrectionSettings>;
    readonly segments?: readonly VocalNoteSegment[];
    readonly enabled?: boolean;
  } = {},
): VocalEditDoc {
  const noteEdits: Record<VocalNoteId, VocalNoteEdit> = {};
  for (const [id, edit] of Object.entries(options.edits ?? {})) {
    noteEdits[id as VocalNoteId] = { ...DEFAULT_VOCAL_NOTE_EDIT, ...edit };
  }
  return {
    assetId: asAssetId('ast_test'),
    analysisKey: 'test',
    algorithmVersion: analysis.algorithmVersion,
    segments: options.segments ?? analysis.segments,
    noteEdits,
    correction: { ...DEFAULT_VOCAL_CORRECTION, ...options.correction },
    enabled: options.enabled ?? true,
    keyCandidates: analysis.keyCandidates,
  };
}

export function copyPcm(pcm: PcmAudio): PcmAudio {
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice()) };
}

/** Peak absolute difference between two buffers over [from, to), in dBFS (−Infinity if equal). */
export function maxDifferenceDb(a: Float32Array, b: Float32Array, from = 0, to = a.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max === 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(max);
}

export function rmsDb(x: Float32Array, from = 0, to = x.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i]! * x[i]!;
  return 10 * Math.log10(sum / Math.max(1, to - from) + 1e-30);
}

export function bytesEqual(a: ArrayBufferView, b: ArrayBufferView): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** Re-analysed pitch error (cents) against a constant target over frames in [from, to] s. */
export function centsErrors(
  f0Hz: Float32Array,
  hopSeconds: number,
  targetHz: number,
  fromSeconds: number,
  toSeconds: number,
): number[] {
  const errors: number[] = [];
  for (let i = 0; i < f0Hz.length; i++) {
    const t = i * hopSeconds;
    if (t < fromSeconds || t > toSeconds) continue;
    const hz = f0Hz[i]!;
    if (hz > 0) errors.push(Math.abs(1200 * Math.log2(hz / targetHz)));
  }
  return errors.sort((a, b) => a - b);
}

export function medianOf(sorted: readonly number[]): number {
  return sorted.length === 0 ? Number.NaN : sorted[sorted.length >> 1]!;
}
