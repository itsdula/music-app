import { MAX_BPM, MIN_BPM, type TimeSignatureDenominator } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import { apply, expectCommandError, expectNoop, makeProject } from './fixtures';

describe('project.rename', () => {
  it('trims and sets the name, sharing everything else', () => {
    const p = makeProject();
    const next = apply(p, { type: 'project.rename', name: '  Song  ' });
    expect(next.name).toBe('Song');
    expect(next.tracks).toBe(p.tracks);
    expect(next.clips).toBe(p.clips);
    expect(next.updatedAt).toBe(p.updatedAt);
  });

  it('is a no-op for the same (trimmed) name and rejects empty names', () => {
    const p = makeProject();
    expectNoop(p, { type: 'project.rename', name: ' Demo ' });
    expectCommandError(p, { type: 'project.rename', name: '   ' }, 'invalid-argument');
  });
});

describe('project.setTempo', () => {
  it('clamps to the BPM range and rounds to 0.01', () => {
    const p = makeProject();
    expect(apply(p, { type: 'project.setTempo', bpm: 1000 }).bpm).toBe(MAX_BPM);
    expect(apply(p, { type: 'project.setTempo', bpm: 1 }).bpm).toBe(MIN_BPM);
    expect(apply(p, { type: 'project.setTempo', bpm: 128.456 }).bpm).toBe(128.46);
    expect(apply(p, { type: 'project.setTempo', bpm: 26.987 }).bpm).toBe(26.99);
  });

  it('is a no-op when the rounded tempo is unchanged', () => {
    const p = makeProject();
    expectNoop(p, { type: 'project.setTempo', bpm: 120 });
    expectNoop(p, { type: 'project.setTempo', bpm: 120.004 });
  });

  it('rejects non-finite tempos', () => {
    expectCommandError(
      makeProject(),
      { type: 'project.setTempo', bpm: Number.NaN },
      'invalid-argument',
    );
  });
});

describe('project.setMeter', () => {
  it('sets a valid meter', () => {
    const next = apply(makeProject(), {
      type: 'project.setMeter',
      meter: { numerator: 7, denominator: 8 },
    });
    expect(next.meter).toEqual({ numerator: 7, denominator: 8 });
  });

  it('is a no-op for an equal meter and rejects invalid ones', () => {
    const p = makeProject();
    expectNoop(p, { type: 'project.setMeter', meter: { numerator: 4, denominator: 4 } });
    expectCommandError(
      p,
      { type: 'project.setMeter', meter: { numerator: 0, denominator: 4 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      {
        type: 'project.setMeter',
        meter: { numerator: 4, denominator: 6 as TimeSignatureDenominator },
      },
      'invalid-argument',
    );
  });
});

describe('project.setLoop', () => {
  it('merges partial updates', () => {
    const p = makeProject();
    const next = apply(p, { type: 'project.setLoop', loop: { enabled: true, startTick: 960 } });
    expect(next.loop).toEqual({ enabled: true, startTick: 960, endTick: p.loop.endTick });
  });

  it('validates the merged region', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'project.setLoop', loop: { startTick: p.loop.endTick } },
      'invalid-argument',
    );
    expectCommandError(p, { type: 'project.setLoop', loop: { endTick: 0 } }, 'invalid-argument');
    expectCommandError(p, { type: 'project.setLoop', loop: { startTick: -1 } }, 'invalid-argument');
    expectCommandError(
      p,
      { type: 'project.setLoop', loop: { endTick: 100.5 } },
      'invalid-argument',
    );
  });

  it('accepts moving both edges at once past the old end', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'project.setLoop',
      loop: { startTick: 100_000, endTick: 100_960 },
    });
    expect(next.loop).toMatchObject({ startTick: 100_000, endTick: 100_960 });
  });

  it('is a no-op when nothing changes', () => {
    const p = makeProject();
    expectNoop(p, { type: 'project.setLoop', loop: { enabled: false } });
    expectNoop(p, { type: 'project.setLoop', loop: {} });
  });
});

describe('project.setMetronome', () => {
  it('merges and clamps', () => {
    const p = makeProject();
    const next = apply(p, {
      type: 'project.setMetronome',
      metronome: { enabled: true, gainDb: 20, countInBars: 9 },
    });
    expect(next.metronome).toEqual({ enabled: true, gainDb: 6, countInBars: 4 });
    expect(
      apply(p, { type: 'project.setMetronome', metronome: { gainDb: -100, countInBars: -1 } })
        .metronome,
    ).toEqual({
      enabled: false,
      gainDb: -60,
      countInBars: 0,
    });
  });

  it('requires integer count-in bars and finite gain', () => {
    const p = makeProject();
    expectCommandError(
      p,
      { type: 'project.setMetronome', metronome: { countInBars: 1.5 } },
      'invalid-argument',
    );
    expectCommandError(
      p,
      { type: 'project.setMetronome', metronome: { gainDb: Number.NaN } },
      'invalid-argument',
    );
  });

  it('is a no-op for identical values', () => {
    const p = makeProject();
    expectNoop(p, {
      type: 'project.setMetronome',
      metronome: { enabled: false, gainDb: -6, countInBars: 0 },
    });
  });
});
