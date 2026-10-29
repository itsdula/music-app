import {
  dominantFrequency,
  magnitudeSpectrum,
  rmsOfSamples,
  type PcmAudio,
} from '@studio/audio-dsp';
import { SYNTH_PRESETS, createInstrumentConfig, type Track } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  MemoryAssets,
  SINE_SYNTH,
  SR,
  assetRef,
  instrumentTrack,
  makeProject,
  maxAbsDiff,
  midiClip,
  note,
  relativeDifference,
  renderProject,
  rmsBetween,
  sine,
  slice,
} from './helpers';

async function renderNotes(
  track: Track,
  notes: ReturnType<typeof note>[],
  endTick = 3840,
  assets = new MemoryAssets(),
) {
  const project = makeProject([track], [midiClip('clp_1', track.id, 0, notes)], assetsRefs(assets));
  return (await renderProject(project, { endTick }, assets)).pcm.channels[0]!;
}

function assetsRefs(assets: MemoryAssets) {
  return [...assets.map.entries()].map(([id, pcm]) => assetRef(id, pcm));
}

/** Energy fraction above `hz` via the FFT magnitude spectrum. */
function highFraction(samples: Float32Array, hz: number): number {
  const spectrum = magnitudeSpectrum(samples, 32768);
  const cut = Math.round((hz * 32768) / SR);
  let hi = 0;
  let total = 0;
  spectrum.forEach((m, k) => {
    total += m * m;
    if (k >= cut) hi += m * m;
  });
  return hi / total;
}

describe('synth', () => {
  it('follows equal temperament across the keyboard', async () => {
    for (const [pitch, hz] of [
      [45, 110],
      [60, 261.626],
      [81, 880],
    ] as const) {
      const out = await renderNotes(
        instrumentTrack('trk_s', 'synth', SINE_SYNTH),
        [note('n', 0, 1920, pitch)],
        1920,
      );
      expect(Math.abs(dominantFrequency(slice(out, 0.1, 0.9), SR) - hz) / hz).toBeLessThan(0.005);
    }
  });

  it('presets sound distinct from each other', async () => {
    const renders: Float32Array[] = [];
    for (const preset of SYNTH_PRESETS) {
      const config = createInstrumentConfig('synth', preset.id);
      const track = { ...instrumentTrack('trk_p'), instrument: config };
      renders.push(await renderNotes(track, [note('n', 0, 1920, 57, 100)], 3840));
    }
    for (let i = 0; i < renders.length; i++) {
      for (let j = i + 1; j < renders.length; j++) {
        expect(
          relativeDifference(renders[i]!, renders[j]!),
          `${SYNTH_PRESETS[i]!.id} vs ${SYNTH_PRESETS[j]!.id}`,
        ).toBeGreaterThan(0.3);
      }
    }
  });

  it('osc2 octave/detune/mix, cutoff, resonance and filter envelope all change the sound', async () => {
    const base = { ...SINE_SYNTH, osc1Waveform: 2, cutoffHz: 2000, resonance: 1 };
    const reference = await renderNotes(
      instrumentTrack('trk_s', 'synth', base),
      [note('n', 0, 1920, 57)],
      1920,
    );
    const changes: Record<string, number>[] = [
      { osc2Mix: 0.5, osc2Waveform: 3 },
      { osc2Mix: 0.5, osc2Octave: 1 },
      { osc2Mix: 0.5, osc2Detune: 40 },
      { cutoffHz: 400 },
      { resonance: 15 },
      { filterEnvAmount: 1, filterDecay: 0.5 },
      { attack: 0.5 },
      { sustain: 0.2, decay: 0.1 },
      { gainDb: -12 },
    ];
    for (const change of changes) {
      const out = await renderNotes(
        instrumentTrack('trk_s', 'synth', { ...base, ...change }),
        [note('n', 0, 1920, 57)],
        1920,
      );
      expect(relativeDifference(out, reference), JSON.stringify(change)).toBeGreaterThan(0.05);
    }
    // Lower cutoff → less high-frequency energy.
    const dark = await renderNotes(
      instrumentTrack('trk_s', 'synth', { ...base, cutoffHz: 300 }),
      [note('n', 0, 1920, 57)],
      1920,
    );
    expect(highFraction(slice(dark, 0.1, 0.9), 2000)).toBeLessThan(
      highFraction(slice(reference, 0.1, 0.9), 2000) * 0.2,
    );
  });

  it('steals the oldest voice beyond the polyphony limit', async () => {
    const params = { ...SINE_SYNTH, polyphony: 2 };
    const notes = [note('a', 0, 3840, 45), note('b', 480, 3840, 52), note('c', 960, 3840, 57)];
    const out = await renderNotes(instrumentTrack('trk_s', 'synth', params), notes, 3840);
    const at = (samples: Float32Array, hz: number) =>
      magnitudeSpectrum(samples, 65536)[Math.round((hz * 65536) / SR)]!;
    const before = slice(out, 0.3, 0.48);
    const after = slice(out, 0.6, 1.4);
    expect(at(before, 110)).toBeGreaterThan(10);
    expect(at(after, 110)).toBeLessThan(at(before, 110) * 0.02); // 110 Hz (oldest) stolen at 0.5 s
    expect(at(after, 164.81)).toBeGreaterThan(10);
    expect(at(after, 220)).toBeGreaterThan(10);
    const poly = await renderNotes(
      instrumentTrack('trk_s', 'synth', { ...params, polyphony: 3 }),
      notes,
      3840,
    );
    expect(at(slice(poly, 0.6, 1.4), 110)).toBeGreaterThan(10);
  });

  it('glides between overlapping notes when monophonic', async () => {
    const params = { ...SINE_SYNTH, polyphony: 1, glideMs: 400 };
    const notes = [note('a', 0, 1920, 57), note('b', 960, 1920, 69)];
    const out = await renderNotes(instrumentTrack('trk_s', 'synth', params), notes, 3840);
    const mid = dominantFrequency(slice(out, 0.62, 0.72), SR, 100, 1000);
    expect(mid).toBeGreaterThan(240);
    expect(mid).toBeLessThan(420);
    expect(dominantFrequency(slice(out, 1.0, 1.4), SR)).toBeCloseTo(440, -1);
    // Without glide the pitch jumps immediately.
    const jump = await renderNotes(
      instrumentTrack('trk_s', 'synth', { ...params, glideMs: 0 }),
      notes,
      3840,
    );
    expect(dominantFrequency(slice(jump, 0.55, 0.75), SR)).toBeCloseTo(440, -1);
  });
});

describe('drum kit', () => {
  it('maps GM notes to distinct non-silent voices', async () => {
    const renders = new Map<number, Float32Array>();
    for (const pitch of [36, 37, 38, 39, 41, 42, 45, 46, 48, 49, 56]) {
      const out = await renderNotes(
        instrumentTrack('trk_d', 'drums'),
        [note('n', 0, 240, pitch)],
        1920,
      );
      expect(rmsOfSamples(out), `note ${pitch}`).toBeGreaterThan(0.005);
      renders.set(pitch, out);
    }
    expect(relativeDifference(renders.get(36)!, renders.get(38)!)).toBeGreaterThan(0.5);
    // Aliases render the same voice.
    const snare40 = await renderNotes(
      instrumentTrack('trk_d', 'drums'),
      [note('n', 0, 240, 40)],
      1920,
    );
    expect(maxAbsDiff(snare40, renders.get(38)!)).toBe(0);
    const unmapped = await renderNotes(
      instrumentTrack('trk_d', 'drums'),
      [note('n', 0, 240, 90)],
      1920,
    );
    expect(rmsOfSamples(unmapped)).toBe(0);
  });

  it('tune, decayScale, tone and gain are audible; closed hat chokes the open hat', async () => {
    const kick = (params: Record<string, number>, pitch = 41) =>
      renderNotes(instrumentTrack('trk_d', 'drums', params), [note('n', 0, 240, pitch)], 3840);
    const base = await kick({});
    const tuned = await kick({ tune: 12 });
    const fBase = dominantFrequency(slice(base, 0.1, 0.4), SR, 40, 600);
    const fTuned = dominantFrequency(slice(tuned, 0.1, 0.4), SR, 40, 600);
    expect(fTuned / fBase).toBeGreaterThan(1.8);
    expect(fTuned / fBase).toBeLessThan(2.2);
    const long = await kick({ decayScale: 3 });
    expect(rmsBetween(long, 0.8, 1.2)).toBeGreaterThan(rmsBetween(base, 0.8, 1.2) * 10);
    const bright = await kick({ tone: 1 }, 38);
    const dull = await kick({ tone: 0 }, 38);
    expect(highFraction(bright, 3000)).toBeGreaterThan(highFraction(dull, 3000) * 1.2);
    const quiet = await kick({ gainDb: -15 });
    expect(rmsOfSamples(quiet) / rmsOfSamples(base)).toBeCloseTo(Math.pow(10, -12 / 20), 2);

    const open = await renderNotes(
      instrumentTrack('trk_d', 'drums'),
      [note('o', 0, 240, 46)],
      3840,
    );
    const choked = await renderNotes(
      instrumentTrack('trk_d', 'drums'),
      [note('o', 0, 240, 46), note('c', 480, 240, 42)],
      3840,
    );
    // After the closed hat (0.25 s) has decayed, the open hat is gone in the choked render.
    expect(rmsBetween(open, 0.5, 0.8)).toBeGreaterThan(1e-3);
    expect(rmsBetween(choked, 0.5, 0.8)).toBeLessThan(rmsBetween(open, 0.5, 0.8) * 0.05);
  });
});

describe('sampler', () => {
  const sample: PcmAudio = { sampleRate: 44100, channels: [sine(440, 0.8, 0.5, 44100)] };
  const assets = () => new MemoryAssets([['ast_smp', sample]]);
  const samplerTrack = (params: Record<string, number> = {}) => {
    const t = instrumentTrack('trk_m', 'sampler', {
      rootNote: 69,
      attack: 0.002,
      release: 0.05,
      ...params,
    });
    return { ...t, instrument: { ...t.instrument!, sampleAssetId: 'ast_smp' as never } };
  };

  it('pitches the sample by 2^((note − root)/12)', async () => {
    const root = await renderNotes(samplerTrack(), [note('n', 0, 960, 69)], 1920, assets());
    expect(dominantFrequency(slice(root, 0.05, 0.4), SR)).toBeCloseTo(440, -1);
    const octave = await renderNotes(samplerTrack(), [note('n', 0, 960, 81)], 1920, assets());
    expect(dominantFrequency(slice(octave, 0.05, 0.35), SR)).toBeCloseTo(880, -1);
    // Pitched up an octave, the 0.8 s sample lasts 0.4 s.
    expect(rmsBetween(octave, 0.42, 0.5)).toBeLessThan(1e-4);
  });

  it('gate mode releases at note-off; one-shot plays the whole sample', async () => {
    const gate = await renderNotes(samplerTrack(), [note('n', 0, 240, 69)], 1920, assets());
    expect(rmsBetween(gate, 0.05, 0.12)).toBeGreaterThan(0.1);
    expect(rmsBetween(gate, 0.25, 0.7)).toBeLessThan(1e-3);
    const oneShot = await renderNotes(
      samplerTrack({ oneShot: 1 }),
      [note('n', 0, 240, 69)],
      1920,
      assets(),
    );
    expect(rmsBetween(oneShot, 0.4, 0.7)).toBeGreaterThan(0.1);
    expect(rmsBetween(oneShot, 0.82, 0.9)).toBeLessThan(1e-4);
  });
});

describe('metronome and clip loops', () => {
  it('renders clicks on beats only when requested', async () => {
    const project = makeProject([]);
    const without = await renderProject(project, { endTick: 3840, includeMetronome: false });
    expect(rmsOfSamples(without.pcm.channels[0]!)).toBe(0);
    const withClicks = await renderProject(project, { endTick: 3840, includeMetronome: true });
    const left = withClicks.pcm.channels[0]!;
    for (const beat of [0, 0.5, 1, 1.5]) {
      expect(rmsBetween(left, beat, beat + 0.03), `beat ${beat}`).toBeGreaterThan(0.05);
      expect(rmsBetween(left, beat + 0.1, beat + 0.45)).toBe(0);
    }
    // Downbeat accent (1760 Hz) differs from the other beats (1320 Hz).
    expect(dominantFrequency(slice(left, 0, 0.05), SR)).toBeCloseTo(1760, -1);
    expect(dominantFrequency(slice(left, 0.5, 0.55), SR)).toBeCloseTo(1320, -1);
    // Metronome level follows project.metronome.gainDb.
    const quiet = await renderProject(
      makeProject([], [], [], { metronome: { enabled: false, gainDb: -26, countInBars: 0 } }),
      {
        endTick: 3840,
        includeMetronome: true,
      },
    );
    expect(rmsOfSamples(quiet.pcm.channels[0]!) / rmsOfSamples(left)).toBeCloseTo(
      Math.pow(10, -20 / 20),
      2,
    );
  });

  it('looped MIDI clips repeat exactly at the loop period', async () => {
    const track = instrumentTrack('trk_s', 'synth', SINE_SYNTH);
    const clip = midiClip('clp_l', 'trk_s', 0, [note('a', 0, 240, 60), note('b', 480, 240, 67)], {
      lengthTicks: 3840 * 2,
      loopLengthTicks: 960,
    });
    const { pcm } = await renderProject(makeProject([track], [clip]), { endTick: 3840 * 2 });
    const left = pcm.channels[0]!;
    const period = 24000; // 960 ticks = 0.5 s
    const first = left.subarray(0, period);
    expect(rmsOfSamples(first)).toBeGreaterThan(0.05);
    for (let k = 1; k < 8; k++) {
      expect(
        maxAbsDiff(left.subarray(k * period, (k + 1) * period), first),
        `iteration ${k}`,
      ).toBeLessThan(1e-4);
    }
  });
});
