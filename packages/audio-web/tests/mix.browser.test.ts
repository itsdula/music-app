import {
  dbToGain,
  dominantFrequency,
  magnitudeSpectrum,
  rmsOfSamples,
  type PcmAudio,
} from '@studio/audio-dsp';
import { asAssetId, type EffectKind, type Track } from '@studio/domain';
import { describe, expect, it } from 'vitest';
import {
  MemoryAssets,
  SINE_SYNTH,
  SR,
  assetRef,
  audioClip,
  audioTrack,
  effect,
  instrumentTrack,
  makeProject,
  maxAbsDiff,
  midiClip,
  noise,
  note,
  relativeDifference,
  renderProject,
  rmsBetween,
  sine,
  slice,
} from './helpers';

/** Renders a 1 s test signal (audio clip) through an effect chain on one track. */
async function renderThrough(
  effects: Track['effects'],
  source: Float32Array,
  seconds = 1.5,
): Promise<PcmAudio> {
  const pcm: PcmAudio = { sampleRate: SR, channels: [source] };
  const assets = new MemoryAssets([['ast_src', pcm]]);
  const project = makeProject(
    [audioTrack('trk_a', { effects })],
    [audioClip('clp_a', 'trk_a', 'ast_src', 0, source.length)],
    [assetRef('ast_src', pcm)],
  );
  const { pcm: out } = await renderProject(
    project,
    { endTick: Math.round(seconds * 1920) },
    assets,
  );
  return out;
}

describe('audio clips', () => {
  it('plays the source sample-exactly with offset, clip gain and linear fades', async () => {
    const source = new Float32Array(SR);
    for (let i = 0; i < source.length; i++) source[i] = 0.25 + 0.5 * (i / source.length);
    const pcm: PcmAudio = { sampleRate: SR, channels: [source] };
    const assets = new MemoryAssets([['ast_ramp', pcm]]);
    const clip = audioClip('clp_a', 'trk_a', 'ast_ramp', 960, 24000, {
      sourceStartFrame: 12000,
      gainDb: -6,
      fadeInFrames: 4800,
      fadeOutFrames: 2400,
    });
    const project = makeProject([audioTrack('trk_a')], [clip], [assetRef('ast_ramp', pcm)]);
    const { pcm: out } = await renderProject(project, { endTick: 3840 }, assets);
    const left = out.channels[0]!;
    const gain = dbToGain(-6);
    const startFrame = 24000; // tick 960 at 120 bpm
    expect(rmsOfSamples(left, 0, startFrame)).toBe(0);
    for (const i of [0, 1, 2400, 4799, 4800, 10000, 21600, 22800, 23999]) {
      const fadeIn = Math.min(1, i / 4800);
      const fadeOut = Math.min(1, (24000 - i) / 2400);
      const expected = source[12000 + i]! * gain * Math.min(fadeIn, fadeOut);
      expect(Math.abs(left[startFrame + i]! - expected)).toBeLessThan(2e-3);
    }
    expect(rmsOfSamples(left, startFrame + 24000, left.length)).toBe(0);
  });

  it('repeats looped audio clips at the clip loop period', async () => {
    const pcm: PcmAudio = { sampleRate: SR, channels: [noise(1, 0.5, 9)] };
    const assets = new MemoryAssets([['ast_n', pcm]]);
    const clip = audioClip('clp_l', 'trk_a', 'ast_n', 0, SR * 2, { loopLengthFrames: 12000 });
    const project = makeProject([audioTrack('trk_a')], [clip], [assetRef('ast_n', pcm)]);
    const { pcm: out } = await renderProject(project, { endTick: 3840 }, assets);
    const left = out.channels[0]!;
    const first = left.subarray(100, 11900);
    for (let k = 1; k < 4; k++) {
      expect(maxAbsDiff(left.subarray(k * 12000 + 100, k * 12000 + 11900), first)).toBeLessThan(
        1e-6,
      );
    }
  });

  it('skips clips whose asset fails to load and reports it', async () => {
    const project = makeProject(
      [audioTrack('trk_a')],
      [audioClip('clp_a', 'trk_a', 'ast_missing', 0, 1000)],
      [assetRef('ast_missing', { sampleRate: SR, channels: [new Float32Array(1000)] })],
    );
    const events: string[] = [];
    const { pcm } = await renderProject(project, {}, new MemoryAssets(), (engine) => {
      engine.subscribe((e) => {
        if (e.type === 'asset' || e.type === 'error')
          events.push(e.type === 'asset' ? e.status : e.error.code);
      });
      return Promise.resolve();
    });
    expect(rmsOfSamples(pcm.channels[0]!)).toBe(0);
    expect(events).toContain('error');
  });

  it('uses asset overrides wherever the asset plays', async () => {
    const original: PcmAudio = { sampleRate: SR, channels: [sine(300, 1)] };
    const replaced: PcmAudio = { sampleRate: SR, channels: [sine(900, 1)] };
    const assets = new MemoryAssets([['ast_v', original]]);
    const project = makeProject(
      [audioTrack('trk_a')],
      [audioClip('clp_a', 'trk_a', 'ast_v', 0, SR)],
      [assetRef('ast_v', original)],
    );
    const plain = await renderProject(project, { endTick: 1920 }, assets);
    expect(dominantFrequency(slice(plain.pcm.channels[0]!, 0.1, 0.9), SR)).toBeCloseTo(300, -1);
    const over = await renderProject(project, { endTick: 1920 }, assets, (engine) =>
      engine.setAssetOverride(asAssetId('ast_v'), replaced),
    );
    expect(dominantFrequency(slice(over.pcm.channels[0]!, 0.1, 0.9), SR)).toBeCloseTo(900, -1);
    const restored = await renderProject(project, { endTick: 1920 }, assets, async (engine) => {
      await engine.setAssetOverride(asAssetId('ast_v'), replaced);
      await engine.setAssetOverride(asAssetId('ast_v'), null);
    });
    expect(dominantFrequency(slice(restored.pcm.channels[0]!, 0.1, 0.9), SR)).toBeCloseTo(300, -1);
  });
});

describe('mixer', () => {
  const tone = (id: string, pitch: number, patch: Partial<Track> = {}) => ({
    track: instrumentTrack(id, 'synth', SINE_SYNTH, patch),
    clip: midiClip(`clp_${id}`, id, 0, [note(`n_${id}`, 0, 1920, pitch)]),
  });

  async function spectrumPeaks(tracks: { track: Track; clip: ReturnType<typeof midiClip> }[]) {
    const project = makeProject(
      tracks.map((t) => t.track),
      tracks.map((t) => t.clip),
    );
    const { pcm } = await renderProject(project, { endTick: 1920 });
    const spectrum = magnitudeSpectrum(slice(pcm.channels[0]!, 0.1, 0.9), 65536);
    const at = (hz: number) => spectrum[Math.round((hz * 65536) / SR)]!;
    return { a: at(440), e: at(659.255), rms: rmsBetween(pcm.channels[0]!, 0.1, 0.9) };
  }

  it('solo isolates soloed tracks; mute wins; fader −60 dB is silence', async () => {
    const both = await spectrumPeaks([tone('trk_a', 69), tone('trk_e', 76)]);
    expect(both.a).toBeGreaterThan(100);
    expect(both.e).toBeGreaterThan(100);
    const solo = await spectrumPeaks([
      tone('trk_a', 69, { mixer: { gainDb: 0, pan: 0, mute: false, solo: true } }),
      tone('trk_e', 76),
    ]);
    expect(solo.a).toBeGreaterThan(100);
    expect(solo.e).toBeLessThan(both.e * 1e-3);
    const muted = await spectrumPeaks([
      tone('trk_a', 69, { mixer: { gainDb: 0, pan: 0, mute: true, solo: true } }),
      tone('trk_e', 76),
    ]);
    expect(muted.rms).toBe(0);
    const faderDown = await spectrumPeaks([
      tone('trk_a', 69, { mixer: { gainDb: -60, pan: 0, mute: false, solo: false } }),
    ]);
    expect(faderDown.rms).toBe(0);
    const minus6 = await spectrumPeaks([
      tone('trk_a', 69, { mixer: { gainDb: -6, pan: 0, mute: false, solo: false } }),
    ]);
    const unity = await spectrumPeaks([tone('trk_a', 69)]);
    expect(minus6.rms / unity.rms).toBeCloseTo(dbToGain(-6), 3);
  });

  it('pans with the equal-power law (unity at centre, +3 dB hard side)', async () => {
    const render = async (pan: number) => {
      const t = tone('trk_a', 69, { mixer: { gainDb: 0, pan, mute: false, solo: false } });
      const { pcm } = await renderProject(makeProject([t.track], [t.clip]), { endTick: 1920 });
      return [
        rmsBetween(pcm.channels[0]!, 0.1, 0.9),
        rmsBetween(pcm.channels[1]!, 0.1, 0.9),
      ] as const;
    };
    const [cl, cr] = await render(0);
    const [ll, lr] = await render(-1);
    expect(cl).toBeCloseTo(cr, 6);
    expect(ll / cl).toBeCloseTo(Math.SQRT2, 3);
    expect(lr).toBeLessThan(1e-6);
    const [hl, hr] = await render(0.5);
    expect(hl ** 2 + hr ** 2).toBeCloseTo(2 * cl ** 2, 4);
  });

  it('master fader and master effects apply to the mix', async () => {
    const t = tone('trk_a', 69);
    const project = makeProject([t.track], [t.clip], [], { master: { gainDb: -12, effects: [] } });
    const quiet = await renderProject(project, { endTick: 1920 });
    const loud = await renderProject(makeProject([t.track], [t.clip]), { endTick: 1920 });
    expect(rmsOfSamples(quiet.pcm.channels[0]!) / rmsOfSamples(loud.pcm.channels[0]!)).toBeCloseTo(
      dbToGain(-12),
      3,
    );
    const withGain = makeProject([t.track], [t.clip], [], {
      master: { gainDb: 0, effects: [effect('fx_m', 'gain', { gainDb: -6 })] },
    });
    const g = await renderProject(withGain, { endTick: 1920 });
    expect(rmsOfSamples(g.pcm.channels[0]!) / rmsOfSamples(loud.pcm.channels[0]!)).toBeCloseTo(
      dbToGain(-6),
      3,
    );
  });
});

describe('effects', () => {
  const dry = noise(1, 0.3, 7);
  /** Bursty signal (loud 100 ms / quiet 150 ms) so dynamics processing is observable. */
  const bursts = noise(1, 0.6, 11).map((v, i) => (i % 12000 < 4800 ? v : v * 0.08));

  it('bypassed effects of every kind pass the dry signal unchanged', async () => {
    const reference = (await renderThrough([], dry)).channels[0]!;
    for (const kind of [
      'gain',
      'eq3',
      'compressor',
      'reverb',
      'delay',
      'distortion',
    ] as EffectKind[]) {
      const out = (await renderThrough([effect(`fx_${kind}`, kind, {}, true)], dry)).channels[0]!;
      expect(maxAbsDiff(out, reference), kind).toBeLessThan(1e-6);
    }
  });

  /** Each case: [kind, params A, params B] — B must change the output measurably vs A. */
  const cases: [EffectKind, Record<string, number>, Record<string, number>][] = [
    ['gain', { gainDb: 0 }, { gainDb: -12 }],
    ['eq3', {}, { lowGainDb: 12 }],
    ['eq3', {}, { lowFreq: 600, lowGainDb: 6 }],
    ['eq3', {}, { midGainDb: -12 }],
    ['eq3', { midGainDb: 9 }, { midGainDb: 9, midFreq: 4000 }],
    ['eq3', { midGainDb: 9 }, { midGainDb: 9, midQ: 5 }],
    ['eq3', {}, { highGainDb: 12 }],
    ['eq3', { highGainDb: 9 }, { highGainDb: 9, highFreq: 12000 }],
    ['compressor', { thresholdDb: 0, ratio: 1 }, { thresholdDb: -40, ratio: 20 }],
    ['compressor', { thresholdDb: -30 }, { thresholdDb: -30, ratio: 1.5 }],
    ['compressor', { thresholdDb: -30, ratio: 8 }, { thresholdDb: -30, ratio: 8, attackMs: 150 }],
    ['compressor', { thresholdDb: -30, ratio: 8 }, { thresholdDb: -30, ratio: 8, releaseMs: 1500 }],
    ['compressor', { thresholdDb: -20, ratio: 8 }, { thresholdDb: -20, ratio: 8, kneeDb: 40 }],
    ['compressor', {}, { makeupDb: 12 }],
    ['reverb', { mix: 0 }, { mix: 0.5 }],
    ['reverb', { mix: 0.5 }, { mix: 0.5, decaySeconds: 6 }],
    ['reverb', { mix: 0.5 }, { mix: 0.5, preDelayMs: 150 }],
    ['reverb', { mix: 0.5 }, { mix: 0.5, dampingHz: 1500 }],
    ['delay', { mix: 0 }, { mix: 0.5 }],
    ['delay', { mix: 0.5 }, { mix: 0.5, timeMs: 120 }],
    ['delay', { mix: 0.5 }, { mix: 0.5, feedback: 0.9 }],
    ['delay', { mix: 0.5 }, { mix: 0.5, toneHz: 900 }],
    ['distortion', { drive: 0 }, { drive: 1 }],
    ['distortion', { drive: 0.6 }, { drive: 0.6, toneHz: 800 }],
    ['distortion', { drive: 0.6, mix: 1 }, { drive: 0.6, mix: 0.3 }],
    ['distortion', {}, { outputDb: -12 }],
  ];

  it.each(cases.map((c, i) => [`${c[0]} #${i}: ${Object.keys(c[2]).join('+')}`, ...c] as const))(
    '%s changes the output',
    async (_label, kind, a, b) => {
      const source = kind === 'compressor' ? bursts : dry;
      const outA = (await renderThrough([effect('fx', kind, a)], source, 3)).channels[0]!;
      const outB = (await renderThrough([effect('fx', kind, b)], source, 3)).channels[0]!;
      expect(relativeDifference(outB, outA)).toBeGreaterThan(0.05);
    },
  );

  it('reverb and delay produce tails after the input stops', async () => {
    const burst = noise(0.2, 0.5, 3);
    const reverb = (
      await renderThrough([effect('fx', 'reverb', { mix: 0.5, decaySeconds: 2 })], burst, 2)
    ).channels[0]!;
    expect(rmsBetween(reverb, 0.5, 1)).toBeGreaterThan(1e-3);
    const delay = (
      await renderThrough(
        [effect('fx', 'delay', { mix: 0.5, timeMs: 300, feedback: 0.5 })],
        burst,
        2,
      )
    ).channels[0]!;
    expect(rmsBetween(delay, 0.3, 0.5)).toBeGreaterThan(rmsBetween(delay, 0.22, 0.28) * 5);
  });

  it('a gain effect scales exactly by its dB value', async () => {
    const reference = (await renderThrough([], dry)).channels[0]!;
    const out = (await renderThrough([effect('fx', 'gain', { gainDb: -6 })], dry)).channels[0]!;
    expect(rmsOfSamples(out) / rmsOfSamples(reference)).toBeCloseTo(dbToGain(-6), 4);
  });
});
