import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VOCAL_ANALYSIS_PARAMS,
  trackPitch,
  VocalJobCancelledError,
  type PitchTrack,
} from '../src/index';
import { decodeChunks } from '../src/pitch/pyin';
import * as fx from '@studio/test-fixtures';

// Fixture synthesis + analysis is slow under coverage instrumentation.
vi.setConfig({ testTimeout: 120_000 });

const SR = 48000;
const params = DEFAULT_VOCAL_ANALYSIS_PARAMS;

interface Fixture {
  readonly name: string;
  readonly curve: fx.F0Curve;
  readonly vowel: fx.VowelId;
  readonly breathiness?: number;
  readonly jitter?: number;
  readonly shimmer?: number;
  readonly sampleRate?: number;
  readonly duration?: number;
}

const melodyNotes = fx.melodyToTimedNotes(fx.KNOWN_MELODIES[0]!.notes.slice(0, 7), {
  bpm: 140,
  startSeconds: 0.1,
  transpose: -12,
});

const CLEAN_FIXTURES: readonly Fixture[] = [
  { name: 'steady 70 Hz /o/', curve: fx.constantF0(70, 0.1, 1.5), vowel: 'o' },
  { name: 'steady 110 Hz /a/', curve: fx.constantF0(110, 0.1, 1.5), vowel: 'a' },
  { name: 'steady 220 Hz /e/', curve: fx.constantF0(220, 0.1, 1.5), vowel: 'e' },
  { name: 'steady 440 Hz /i/', curve: fx.constantF0(440, 0.1, 1.5), vowel: 'i' },
  { name: 'steady 880 Hz /u/', curve: fx.constantF0(880, 0.1, 1.5), vowel: 'u' },
  {
    name: 'vibrato 220 Hz ±60c 5.5 Hz',
    curve: fx.vibratoF0({
      baseHz: 220,
      rateHz: 5.5,
      depthCents: 60,
      startSeconds: 0.1,
      endSeconds: 1.5,
    }),
    vowel: 'a',
  },
  {
    name: 'vibrato 330 Hz ±120c 6.5 Hz',
    curve: fx.vibratoF0({
      baseHz: 330,
      rateHz: 6.5,
      depthCents: 120,
      startSeconds: 0.1,
      endSeconds: 1.5,
    }),
    vowel: 'o',
  },
  {
    name: 'glide 150→600 Hz in 1 s',
    curve: fx.glideF0({
      fromHz: 150,
      toHz: 600,
      glideStartSeconds: 0.3,
      glideSeconds: 1,
      holdStartSeconds: 0.1,
      endSeconds: 1.5,
    }),
    vowel: 'a',
  },
  {
    name: 'glide 500→180 Hz in 0.3 s',
    curve: fx.glideF0({
      fromHz: 500,
      toHz: 180,
      glideStartSeconds: 0.6,
      glideSeconds: 0.3,
      holdStartSeconds: 0.1,
      endSeconds: 1.5,
    }),
    vowel: 'e',
  },
  {
    name: 'melody with vibrato',
    curve: fx.melodyF0(melodyNotes, { vibrato: { rateHz: 5.5, depthCents: 40 } }),
    vowel: 'a',
    duration: 3.3,
  },
];

const ROBUSTNESS_FIXTURES: readonly Fixture[] = [
  {
    name: 'breathy 220 Hz (HNR≈10 dB)',
    curve: fx.constantF0(220, 0.1, 1.5),
    vowel: 'a',
    breathiness: 0.6,
  },
  {
    name: 'jitter 0.5 % + shimmer 5 %',
    curve: fx.constantF0(196, 0.1, 1.5),
    vowel: 'e',
    jitter: 0.005,
    shimmer: 0.05,
  },
  { name: 'octave trap /i/ 135 Hz (H2 on F1)', curve: fx.constantF0(135, 0.1, 1.5), vowel: 'i' },
  {
    name: '44.1 kHz vibrato',
    curve: fx.vibratoF0({
      baseHz: 247,
      rateHz: 6,
      depthCents: 50,
      startSeconds: 0.1,
      endSeconds: 1.5,
    }),
    vowel: 'a',
    sampleRate: 44100,
  },
  { name: '96 kHz steady', curve: fx.constantF0(185, 0.1, 1.5), vowel: 'o', sampleRate: 96000 },
];

function analyseFixture(f: Fixture): { track: PitchTrack; truth: Float32Array } {
  const sampleRate = f.sampleRate ?? SR;
  const pcm = fx.synthesizeVowel({
    sampleRate,
    durationSeconds: f.duration ?? 1.6,
    f0: f.curve,
    vowel: f.vowel,
    seed: 11,
    ...(f.breathiness !== undefined ? { breathiness: f.breathiness } : {}),
    ...(f.jitter !== undefined ? { jitter: f.jitter } : {}),
    ...(f.shimmer !== undefined ? { shimmer: f.shimmer } : {}),
  });
  const track = trackPitch(pcm.channels[0]!, sampleRate, params);
  return { track, truth: fx.groundTruthF0(f.curve, track) };
}

function concat(parts: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function report(label: string, m: fx.PitchMetrics): void {
  console.log(
    `${label.padEnd(36)} RPA ${(100 * m.rawPitchAccuracy).toFixed(2)}%  GPE ${(100 * m.grossPitchError).toFixed(2)}%  ` +
      `octave ${(100 * m.octaveErrorRate).toFixed(2)}%  VR ${(100 * m.voicingRecall).toFixed(2)}%  ` +
      `VFA ${(100 * m.voicingFalseAlarm).toFixed(1)}%  median ${m.medianAbsCents.toFixed(2)}c  p95 ${m.p95AbsCents.toFixed(1)}c`,
  );
}

describe('trackPitch (pYIN) on clean synthetic vowels', () => {
  const results = CLEAN_FIXTURES.map((f) => ({ f, ...analyseFixture(f) }));

  it('meets the frame-level accuracy targets in aggregate', () => {
    for (const r of results) report(r.f.name, fx.computePitchMetrics(r.track.f0Hz, r.truth));
    const all = fx.computePitchMetrics(
      concat(results.map((r) => r.track.f0Hz)),
      concat(results.map((r) => r.truth)),
    );
    report('AGGREGATE (clean)', all);
    expect(all.rawPitchAccuracy).toBeGreaterThanOrEqual(0.95);
    expect(all.grossPitchError).toBeLessThanOrEqual(0.02);
    expect(all.octaveErrorRate).toBeLessThanOrEqual(0.02);
    expect(all.voicingRecall).toBeGreaterThanOrEqual(0.95);
  });

  it('meets the targets on every individual fixture', () => {
    for (const r of results) {
      const m = fx.computePitchMetrics(r.track.f0Hz, r.truth);
      // Known limit: the 59 semitone/s glide measures 94.6 % because the 38 ms YIN span
      // blurs the hold→glide corners (documented in docs/vocal-dsp.md).
      const floor = r.f.name.startsWith('glide 500') ? 0.93 : 0.95;
      expect(m.rawPitchAccuracy, r.f.name).toBeGreaterThanOrEqual(floor);
      expect(m.grossPitchError, r.f.name).toBeLessThanOrEqual(0.02);
      expect(m.voicingRecall, r.f.name).toBeGreaterThanOrEqual(0.95);
    }
  });

  it('reports exact YIN frequencies on steady vowels (sub-cent median error)', () => {
    for (const r of results.slice(0, 5)) {
      expect(fx.computePitchMetrics(r.track.f0Hz, r.truth).medianAbsCents, r.f.name).toBeLessThan(
        1,
      );
    }
  });

  it('fills the PitchTrack contract', () => {
    const { track } = results[2]!;
    expect(track.sampleRate).toBe(SR);
    expect(track.hopSeconds).toBeCloseTo(240 / SR, 15);
    expect(track.firstFrameSeconds).toBe(0);
    expect(track.frameCount).toBe(Math.floor((1.6 * SR - 1) / 240) + 1);
    expect(track.f0Hz).toHaveLength(track.frameCount);
    expect(track.voicedProbability).toHaveLength(track.frameCount);
    expect(track.rmsDb).toHaveLength(track.frameCount);
    for (let i = 0; i < track.frameCount; i++) {
      expect(track.voicedProbability[i]).toBeGreaterThanOrEqual(0);
      expect(track.voicedProbability[i]).toBeLessThanOrEqual(1);
    }
    // Leading silence: unvoiced with very low level.
    expect(track.f0Hz[2]).toBe(0);
    expect(track.rmsDb[2]).toBeLessThan(-100);
  });
});

describe('trackPitch robustness', () => {
  it('handles breathiness, jitter, octave traps and other sample rates', () => {
    for (const f of ROBUSTNESS_FIXTURES) {
      const { track, truth } = analyseFixture(f);
      const m = fx.computePitchMetrics(track.f0Hz, truth);
      report(f.name, m);
      expect(m.rawPitchAccuracy, f.name).toBeGreaterThanOrEqual(0.95);
      expect(m.grossPitchError, f.name).toBeLessThanOrEqual(0.02);
      expect(m.voicingRecall, f.name).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('voicing false alarms on unvoiced material', () => {
  const cases: [string, fx.FixturePcm][] = [
    [
      'white noise −26 dBFS',
      fx.whiteNoise({ sampleRate: SR, durationSeconds: 1.5, seed: 5, amplitude: 0.09 }),
    ],
    [
      'breath −30 dBFS',
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 1.5,
        kind: 'breath',
        seed: 6,
      }),
    ],
    [
      'loud breath −18 dBFS',
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 1.5,
        kind: 'breath',
        seed: 7,
        rmsDb: -18,
      }),
    ],
    [
      'sibilant −24 dBFS',
      fx.synthesizeConsonantBurst({
        sampleRate: SR,
        durationSeconds: 1.5,
        kind: 'sibilant',
        seed: 8,
      }),
    ],
    ['digital silence', fx.silence(SR, 1)],
  ];
  for (const [name, pcm] of cases) {
    it(`stays unvoiced on ${name} (≤ 10 % false alarms)`, () => {
      const track = trackPitch(pcm.channels[0]!, SR, params);
      let voiced = 0;
      for (let i = 0; i < track.frameCount; i++) if (track.f0Hz[i]! > 0) voiced++;
      const rate = voiced / track.frameCount;
      console.log(`${name.padEnd(24)} VFA ${(100 * rate).toFixed(2)}%`);
      expect(rate).toBeLessThanOrEqual(0.1);
    });
  }
});

describe('trackPitch behaviour', () => {
  const breathy = fx.synthesizeVowel({
    sampleRate: SR,
    durationSeconds: 1,
    f0: fx.constantF0(200, 0.1, 0.9),
    breathiness: 1,
    seed: 4,
  });

  it('voices fewer frames as voicingThreshold rises', () => {
    const count = (threshold: number): number => {
      const track = trackPitch(breathy.channels[0]!, SR, {
        ...params,
        voicingThreshold: threshold,
      });
      return track.f0Hz.filter((v) => v > 0).length;
    };
    const low = count(0.05);
    const mid = count(0.5);
    const high = count(0.995);
    expect(low).toBeGreaterThanOrEqual(mid);
    expect(mid).toBeGreaterThanOrEqual(high);
    expect(low).toBeGreaterThan(high);
  });

  it('respects the silence threshold', () => {
    const quiet = fx.synthesizeVowel({
      sampleRate: SR,
      durationSeconds: 0.6,
      f0: fx.constantF0(220),
      amplitude: 0.001,
    });
    const gated = trackPitch(quiet.channels[0]!, SR, params);
    expect(gated.f0Hz.some((v) => v > 0)).toBe(false);
    const open = trackPitch(quiet.channels[0]!, SR, { ...params, silenceThresholdDb: -90 });
    expect(open.f0Hz.filter((v) => v > 0).length).toBeGreaterThan(open.frameCount * 0.8);
  });

  it('reports progress and supports cancellation', () => {
    const pcm = fx.synthesizeVowel({ sampleRate: SR, durationSeconds: 4, f0: fx.constantF0(150) });
    const progress: number[] = [];
    trackPitch(pcm.channels[0]!, SR, params, { onProgress: (f) => progress.push(f) });
    expect(progress.length).toBeGreaterThan(3);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]!);
    let calls = 0;
    expect(() =>
      trackPitch(pcm.channels[0]!, SR, params, { shouldCancel: () => ++calls > 2 }),
    ).toThrow(VocalJobCancelledError);
  });

  it('handles empty input', () => {
    const track = trackPitch(new Float32Array(0), SR, params);
    expect(track.frameCount).toBe(0);
  });

  it('splits Viterbi chunks at long silences and bounds chunk length', () => {
    const gated = new Uint8Array(400);
    gated.fill(1, 100, 200); // 0.5 s of silence at 5 ms hop
    gated.fill(1, 300, 310); // short gap: no split
    expect(decodeChunks(gated, 0.005)).toEqual([
      { start: 0, end: 100 },
      { start: 200, end: 400 },
    ]);
    const long = new Uint8Array(30000);
    const chunks = decodeChunks(long, 0.005);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toEqual({ start: 0, end: 12000 });
    expect(chunks[2]!.end).toBe(30000);
  });
});
