import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SustainPedal,
  adsrLevelAt,
  audioVoiceGainEnvelope,
  filterEnvelopePeakHz,
  gainEnvelopeAt,
  midiToFrequency,
  pitchBendCents,
  releaseLevelAt,
  releaseTimeConstant,
  resonanceToQDb,
  samplerPlaybackRate,
  selectVoicesToSteal,
  semitoneRatio,
  velocityToGain,
  vibratoDepthCents,
} from '../src';

describe('voice stealing', () => {
  const voices = [
    { id: 1, startTime: 0, endTime: 10 },
    { id: 2, startTime: 1, endTime: Number.POSITIVE_INFINITY },
    { id: 3, startTime: 1, endTime: 1.5 },
    { id: 4, startTime: 2, endTime: 10 },
  ];

  it('steals the oldest sounding voices to stay within the limit', () => {
    expect(selectVoicesToSteal(voices, 3, 4)).toEqual([]);
    expect(selectVoicesToSteal(voices, 3, 3)).toEqual([1]); // 3 sounding (1,2,4) + new
    expect(selectVoicesToSteal(voices, 3, 2)).toEqual([1, 2]);
    expect(selectVoicesToSteal(voices, 1.2, 1)).toEqual([1, 2, 3]); // ties by id
    expect(selectVoicesToSteal(voices, 3, 0)).toEqual([1, 2, 4]); // clamped to 1
    expect(selectVoicesToSteal([], 0, 1)).toEqual([]);
  });

  it('never leaves more than max−1 sounding voices (property)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 10, noNaN: true }),
            fc.double({ min: 0, max: 5, noNaN: true }),
          ),
          { maxLength: 30 },
        ),
        fc.double({ min: 0, max: 12, noNaN: true }),
        fc.integer({ min: 1, max: 16 }),
        (raw, time, max) => {
          const spans = raw.map(([s, len], id) => ({ id, startTime: s, endTime: s + len }));
          const stolen = new Set(selectVoicesToSteal(spans, time, max));
          const remaining = spans.filter(
            (v) => !stolen.has(v.id) && v.startTime <= time && time < v.endTime,
          );
          expect(remaining.length).toBeLessThanOrEqual(max - 1);
          for (const id of stolen) {
            const v = spans[id]!;
            expect(v.startTime <= time && time < v.endTime).toBe(true);
            for (const r of remaining) expect(v.startTime).toBeLessThanOrEqual(r.startTime);
          }
        },
      ),
    );
  });
});

describe('sustain pedal', () => {
  it('defers note-offs while down and releases on pedal up (except re-held keys)', () => {
    const pedal = new SustainPedal();
    pedal.noteOn(60);
    expect(pedal.noteOff(60)).toBe(true);
    expect(pedal.setDown(true)).toEqual([]);
    expect(pedal.isDown).toBe(true);
    pedal.noteOn(64);
    pedal.noteOn(67);
    expect(pedal.noteOff(64)).toBe(false);
    expect(pedal.noteOff(67)).toBe(false);
    pedal.noteOn(67); // re-pressed while sustained: stays held
    expect(pedal.setDown(false)).toEqual([64]);
    expect(pedal.setDown(false)).toEqual([]);
    expect(pedal.noteOff(67)).toBe(true);
  });

  it('reset returns everything held or sustained', () => {
    const pedal = new SustainPedal();
    pedal.setDown(true);
    pedal.noteOn(50);
    pedal.noteOn(40);
    pedal.noteOff(50);
    expect(pedal.reset()).toEqual([40, 50]);
    expect(pedal.isDown).toBe(false);
  });
});

describe('instrument math', () => {
  it('pitch, velocity and modulation mappings', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(57)).toBeCloseTo(220, 9);
    expect(semitoneRatio(12)).toBe(2);
    expect(samplerPlaybackRate(72, 60)).toBe(2);
    expect(samplerPlaybackRate(60, 60)).toBe(1);
    expect(velocityToGain(127)).toBe(1);
    expect(velocityToGain(0)).toBe(0);
    expect(velocityToGain(200)).toBe(1);
    expect(velocityToGain(64)).toBeCloseTo(Math.pow(64 / 127, 1.6), 12);
    expect(pitchBendCents(1)).toBe(200);
    expect(pitchBendCents(-0.5)).toBe(-100);
    expect(pitchBendCents(3, 12)).toBe(1200);
    expect(pitchBendCents(Number.NaN)).toBe(0);
    expect(vibratoDepthCents(1)).toBe(50);
    expect(vibratoDepthCents(-1)).toBe(0);
    expect(vibratoDepthCents(Number.NaN)).toBe(0);
  });

  it('filter envelope reaches up to +4 octaves, capped below Nyquist', () => {
    expect(filterEnvelopePeakHz(500, 0, 48000)).toBe(500);
    expect(filterEnvelopePeakHz(500, 1, 48000)).toBe(8000);
    expect(filterEnvelopePeakHz(500, 0.5, 48000)).toBeCloseTo(2000, 9);
    expect(filterEnvelopePeakHz(4000, 1, 22050)).toBeCloseTo(0.45 * 22050, 9);
    expect(filterEnvelopePeakHz(9000, 1, 96000)).toBe(20000);
    expect(resonanceToQDb(1)).toBe(0);
    expect(resonanceToQDb(10)).toBeCloseTo(20, 12);
    expect(resonanceToQDb(0)).toBeCloseTo(-80, 9);
  });

  it('ADSR shape: linear attack, exponential decay to sustain, exponential release', () => {
    const shape = { attack: 0.1, decay: 0.4, sustain: 0.5 };
    expect(adsrLevelAt(shape, 0)).toBe(0);
    expect(adsrLevelAt(shape, 0.05)).toBeCloseTo(0.5, 12);
    expect(adsrLevelAt(shape, 0.1)).toBeCloseTo(1, 12);
    expect(adsrLevelAt(shape, 0.5)).toBeCloseTo(0.5 + 0.5 * Math.exp(-4), 12);
    expect(adsrLevelAt(shape, 100)).toBeCloseTo(0.5, 12);
    expect(adsrLevelAt({ attack: 0, decay: 0, sustain: 0.3 }, 0.001)).toBeCloseTo(0.3, 9);
    expect(releaseTimeConstant(0.7)).toBeCloseTo(0.1, 12);
    expect(releaseLevelAt(0.8, 0.7, 0)).toBe(0.8);
    expect(releaseLevelAt(0.8, 0.7, 0.7)).toBeCloseTo(0.8 * Math.exp(-7), 12);
  });
});

describe('audio voice gain envelopes', () => {
  const base = {
    clipOffsetFrames: 0,
    playFrames: 48000,
    clipLengthFrames: 48000,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    sampleRate: 48000,
    gain: 1,
    startsMidway: false,
    endsEarly: false,
    declickFrames: 240,
  };

  it('is flat at the clip gain without fades', () => {
    expect(audioVoiceGainEnvelope({ ...base, gain: 0.5 })).toEqual([
      { offsetSeconds: 0, gain: 0.5 },
      { offsetSeconds: 1, gain: 0.5 },
    ]);
  });

  it('applies clip-edge fades', () => {
    const points = audioVoiceGainEnvelope({ ...base, fadeInFrames: 4800, fadeOutFrames: 9600 });
    expect(points).toEqual([
      { offsetSeconds: 0, gain: 0 },
      { offsetSeconds: 0.1, gain: 1 },
      { offsetSeconds: 0.8, gain: 1 },
      { offsetSeconds: 1, gain: 0 },
    ]);
    expect(gainEnvelopeAt(points, 0.05)).toBeCloseTo(0.5, 12);
    expect(gainEnvelopeAt(points, 0.9)).toBeCloseTo(0.5, 12);
    expect(gainEnvelopeAt(points, -1)).toBe(0);
    expect(gainEnvelopeAt(points, 5)).toBe(0);
    expect(gainEnvelopeAt([], 0)).toBe(0);
  });

  it('starting mid-fade begins at the fade value with a de-click ramp; cutting early ramps out', () => {
    const points = audioVoiceGainEnvelope({
      ...base,
      clipOffsetFrames: 2400,
      playFrames: 24000,
      fadeInFrames: 4800,
      startsMidway: true,
      endsEarly: true,
    });
    expect(points[0]).toEqual({ offsetSeconds: 0, gain: 0 });
    expect(points[1]!.offsetSeconds).toBeCloseTo(0.005, 12);
    expect(points[1]!.gain).toBeCloseTo((2400 + 240) / 4800, 12);
    expect(points.find((p) => p.offsetSeconds === 0.05)!.gain).toBe(1);
    expect(points[points.length - 1]).toEqual({ offsetSeconds: 0.5, gain: 0 });
    expect(points[points.length - 2]!.gain).toBe(1);
    for (let i = 1; i < points.length; i++)
      expect(points[i]!.offsetSeconds).toBeGreaterThan(points[i - 1]!.offsetSeconds);
  });

  it('handles zero-length plays', () => {
    const points = audioVoiceGainEnvelope({ ...base, playFrames: 0 });
    expect(points).toHaveLength(2);
  });
});
