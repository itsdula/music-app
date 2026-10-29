import { asVocalNoteId, relativeKey, type KeyCandidate, type MusicalKey } from '@studio/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  estimateKey,
  estimateTuningOffset,
  keyCandidatesFromSegments,
  pitchClassHistogram,
  scoreKeys,
  KEY_MAX_CANDIDATES,
} from '../src/index';
import * as fx from '@studio/test-fixtures';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const label = (k: { tonic: number; scale: string }): string =>
  `${NAMES[k.tonic]}${k.scale === 'major' ? '' : 'm'}`;
const same = (a: MusicalKey, b: { tonic: number; scale: string }): boolean =>
  a.tonic === b.tonic && a.scale === b.scale;
const rankOf = (
  candidates: readonly KeyCandidate[],
  key: { tonic: number; scale: string },
): number => candidates.findIndex((c) => same(c.key, key));

describe('estimateKey on KNOWN_MELODIES', () => {
  const results = fx.KNOWN_MELODIES.map((m) => ({
    m,
    candidates: estimateKey(fx.melodyWeights(m.notes)),
  }));

  it('is top-1 correct on ≥ 80 % and top-3 on ≥ 95 % of the melodies', () => {
    let top1 = 0;
    let top3 = 0;
    for (const { m, candidates } of results) {
      const rank = rankOf(candidates, m.key);
      if (rank === 0) top1++;
      if (rank >= 0 && rank < 3) top3++;
      console.log(
        `${rank === 0 ? 'top1' : rank > 0 && rank < 3 ? 'top3' : 'MISS'} ${m.name.padEnd(36)} ${label(m.key).padEnd(4)} → ` +
          candidates
            .slice(0, 3)
            .map((c) => `${label(c.key)} ${c.confidence.toFixed(2)}`)
            .join(', '),
      );
    }
    const n = results.length;
    console.log(
      `key estimation: top-1 ${top1}/${n} (${((100 * top1) / n).toFixed(1)} %), top-3 ${top3}/${n} (${((100 * top3) / n).toFixed(1)} %)`,
    );
    expect(top1 / n).toBeGreaterThanOrEqual(0.8);
    expect(top3 / n).toBeGreaterThanOrEqual(0.95);
  });

  it('returns ranked candidates with confidences summing to ≤ 1', () => {
    for (const { candidates } of results) {
      expect(candidates.length).toBeLessThanOrEqual(KEY_MAX_CANDIDATES);
      expect(candidates.length).toBeGreaterThan(0);
      const total = candidates.reduce((s, c) => s + c.confidence, 0);
      expect(total).toBeLessThanOrEqual(1 + 1e-12);
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i]!.confidence).toBeLessThanOrEqual(candidates[i - 1]!.confidence);
      }
    }
  });

  it('surfaces the relative major/minor where the melody is ambiguous', () => {
    // Jingle Bells dwells on the third (B) and Mary on E–D–C: genuinely ambiguous between
    // relative keys, so both must be offered with comparable confidence. Auld Lang Syne is
    // pentatonic but clearly tonal (ends on F); its relative must still be listed.
    const cases: [string, number][] = [
      ['Jingle Bells (chorus)', 0.25],
      ['Mary Had a Little Lamb', 0.25],
      ['Auld Lang Syne', 0],
    ];
    for (const [name, minRatio] of cases) {
      const { m, candidates } = results.find((r) => r.m.name === name)!;
      const relative = relativeKey(m.key)!;
      const rank = rankOf(candidates, relative);
      expect(rank, name).toBeGreaterThan(0);
      expect(rank, name).toBeLessThan(3);
      const ratio = candidates[rank]!.confidence / candidates[0]!.confidence;
      console.log(
        `${name}: relative ${label(relative)} at rank ${rank + 1}, confidence ratio ${ratio.toFixed(2)}`,
      );
      expect(ratio, name).toBeGreaterThan(minRatio);
    }
  });

  it('is transposition invariant', () => {
    for (const { m, candidates } of results.slice(0, 8)) {
      for (const shift of [1, 5, 11]) {
        const moved = estimateKey(fx.melodyWeights(m.notes, shift));
        const top = candidates[0]!.key;
        expect(label(moved[0]!.key)).toBe(
          label({ tonic: (top.tonic + shift) % 12, scale: top.scale }),
        );
        expect(moved[0]!.confidence).toBeCloseTo(candidates[0]!.confidence, 12);
      }
    }
  });

  it('gives modal melodies their parent-key family', () => {
    for (const m of fx.MODAL_MELODIES) {
      const candidates = estimateKey(fx.melodyWeights(m.notes));
      console.log(
        `${m.name} (${m.mode}): ${candidates
          .slice(0, 3)
          .map((c) => `${label(c.key)} ${c.confidence.toFixed(2)}`)
          .join(', ')}`,
      );
      expect(rankOf(candidates, m.key)).toBeGreaterThanOrEqual(0);
      expect(rankOf(candidates, m.key)).toBeLessThan(3);
    }
  });
});

describe('estimateKey details', () => {
  it('estimates and removes a global tuning offset', () => {
    const notes = fx
      .melodyWeights(fx.KNOWN_MELODIES[0]!.notes)
      .map((n) => ({ ...n, midi: n.midi + 0.3 }));
    expect(estimateTuningOffset(notes)).toBeCloseTo(0.3, 6);
    expect(estimateTuningOffset([{ midi: 60, weight: 1 }])).toBe(0);
    expect(estimateTuningOffset([])).toBe(0);
    expect(label(estimateKey(notes)[0]!.key)).toBe('C');
    const histogram = pitchClassHistogram(notes);
    expect(histogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(histogram[1]).toBe(0);
  });

  it('shrinks confidences when evidence is thin and handles empty input', () => {
    expect(estimateKey([])).toEqual([]);
    expect(
      estimateKey([
        { midi: 60, weight: 0 },
        { midi: Number.NaN, weight: 1 },
      ]),
    ).toEqual([]);
    const thin = estimateKey([
      { midi: 60, weight: 1 },
      { midi: 64, weight: 1 },
      { midi: 67, weight: 1 },
    ]);
    const total = thin.reduce((s, c) => s + c.confidence, 0);
    expect(total).toBeLessThan(0.2);
  });

  it('scores all 24 keys', () => {
    const scores = scoreKeys(pitchClassHistogram(fx.melodyWeights(fx.KNOWN_MELODIES[1]!.notes)));
    expect(scores).toHaveLength(24);
    expect(scores[0]).toMatchObject({ tonic: 0, scale: 'major' });
    expect(scores[1]).toMatchObject({ tonic: 0, scale: 'naturalMinor' });
    expect(scoreKeys(new Array<number>(12).fill(0)).every((s) => Number.isFinite(s.score))).toBe(
      true,
    );
  });

  it('derives candidates from note segments, ignoring very short ones', () => {
    const notes = fx.melodyToTimedNotes(
      fx.KNOWN_MELODIES.find((m) => m.name === 'Für Elise (opening)')!.notes,
      { bpm: 100 },
    );
    const segments = notes.map((n, i) => ({
      id: asVocalNoteId(`vn_${i}`),
      startSeconds: n.startSeconds,
      endSeconds: n.startSeconds + n.durationSeconds,
      detectedMidi: n.midi + 0.12,
      confidence: 0.9,
      vibratoDepthCents: 0,
      vibratoRateHz: 0,
      driftCents: 0,
    }));
    expect(keyCandidatesFromSegments(segments)[0]!.key).toEqual({
      tonic: 9,
      scale: 'naturalMinor',
    });
    const tiny = segments.map((s) => ({ ...s, endSeconds: s.startSeconds + 0.05 }));
    expect(keyCandidatesFromSegments(tiny)).toEqual([]);
  });
});
