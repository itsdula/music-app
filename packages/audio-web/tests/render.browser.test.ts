import {
  decodeWav,
  dominantFrequency,
  encodeWav,
  peakAmplitude,
  rmsOfSamples,
} from '@studio/audio-dsp';
import { describe, expect, it } from 'vitest';
import { AudioEngineError } from '../src';
import {
  BPM,
  SINE_SYNTH,
  SR,
  TPS,
  createEngine,
  instrumentTrack,
  makeProject,
  midiClip,
  note,
  relativeDifference,
  renderProject,
  rmsBetween,
  slice,
} from './helpers';

describe('offline render: synth note', () => {
  it('renders A4 at 440 Hz ± 1% with energy only inside the note window', async () => {
    const track = instrumentTrack('trk_1', 'synth', SINE_SYNTH);
    // Note at tick 960 (0.5 s) for 960 ticks (0.5 s).
    const project = makeProject(
      [track],
      [midiClip('clp_1', 'trk_1', 0, [note('n1', 960, 960, 69)])],
    );
    const { pcm } = await renderProject(project, { endTick: 3840 });
    expect(pcm.sampleRate).toBe(SR);
    expect(pcm.channels).toHaveLength(2);
    expect(pcm.channels[0]!.length).toBe(2 * SR);
    const left = pcm.channels[0]!;
    const frequency = dominantFrequency(slice(left, 0.55, 0.95), SR);
    expect(Math.abs(frequency - 440) / 440).toBeLessThan(0.01);
    expect(rmsBetween(left, 0.6, 0.9)).toBeGreaterThan(0.05);
    // Silence before the note starts (sample-accurate start at 24000) …
    expect(rmsOfSamples(left, 0, 24000)).toBe(0);
    expect(Math.abs(left[24000 + 10]!)).toBeGreaterThan(0);
    // … and after note end + release (0.05 s) + stop margin.
    expect(rmsBetween(left, 1.1, 2)).toBeLessThan(1e-6);
    // Centred pan: identical channels.
    expect(relativeDifference(pcm.channels[1]!, left)).toBeLessThan(1e-6);
  });

  it('round-trips a render through encodeWav/decodeWav', async () => {
    const project = makeProject(
      [instrumentTrack('trk_1', 'synth', SINE_SYNTH)],
      [midiClip('clp_1', 'trk_1', 0, [note('n1', 0, 960, 60)])],
    );
    const rendered = await renderProject(project, { endTick: 1920 });
    const float = decodeWav(encodeWav(rendered.pcm, { bitDepth: 32 }));
    expect(float.sampleRate).toBe(SR);
    expect(float.channels[0]).toEqual(rendered.pcm.channels[0]);
    const pcm16 = decodeWav(encodeWav(rendered.pcm, { bitDepth: 16, dither: 'tpdf', seed: 1 }));
    let maxErr = 0;
    rendered.pcm.channels[0]!.forEach((v, i) => {
      maxErr = Math.max(maxErr, Math.abs(v - pcm16.channels[0]![i]!));
    });
    expect(maxErr).toBeLessThanOrEqual(1.5 / 32768);
    expect(rendered.peak).toBeCloseTo(peakAmplitude(rendered.pcm), 9);
  });

  it('renders mono by down-mixing and honours startTick offsets', async () => {
    const project = makeProject(
      [instrumentTrack('trk_1', 'synth', SINE_SYNTH)],
      [midiClip('clp_1', 'trk_1', 0, [note('n1', 1920, 960, 69)])],
    );
    const { pcm } = await renderProject(project, {
      startTick: 1920,
      endTick: 3840,
      channelCount: 1,
    });
    expect(pcm.channels).toHaveLength(1);
    expect(pcm.channels[0]!.length).toBe(SR);
    // The note starts exactly at the render start.
    expect(Math.abs(pcm.channels[0]![5]!)).toBeGreaterThan(0);
    expect(dominantFrequency(slice(pcm.channels[0]!, 0.05, 0.45), SR)).toBeCloseTo(440, -1);
  });

  it('cuts notes at the render end and estimates the tail automatically', async () => {
    const track = instrumentTrack('trk_1', 'synth', { ...SINE_SYNTH, release: 1 });
    const project = makeProject(
      [track],
      [midiClip('clp_1', 'trk_1', 0, [note('n1', 0, 3840 * 4)])],
    );
    const result = await renderProject(project, { endTick: 1920, tailSeconds: 'auto' });
    expect(result.tailSeconds).toBeCloseTo(1.02, 6);
    expect(result.pcm.channels[0]!.length).toBe(Math.ceil((1 + 1.02) * SR));
    const left = result.pcm.channels[0]!;
    // Release starts at 1.0 s: exponential decay to −61 dB over 1 s.
    expect(rmsBetween(left, 0.9, 1)).toBeGreaterThan(0.1);
    expect(rmsBetween(left, 1.5, 1.6)).toBeLessThan(rmsBetween(left, 1.05, 1.15) * 0.2);
    expect(rmsBetween(left, 1.98, 2.02)).toBeLessThan(0.003);
  });

  it('validates requests and supports cancellation with progress reporting', async () => {
    const engine = createEngine();
    await expect(
      engine.render({
        startTick: 0,
        endTick: 100,
        sampleRate: SR,
        channelCount: 2,
        tailSeconds: 0,
        includeMetronome: false,
      }),
    ).rejects.toMatchObject({ code: 'internal' });
    const project = makeProject(
      [instrumentTrack('trk_1', 'synth', SINE_SYNTH)],
      [
        midiClip(
          'clp_1',
          'trk_1',
          0,
          Array.from({ length: 64 }, (_, i) => note(`n${i}`, i * 960, 480, 60 + (i % 12))),
        ),
      ],
    );
    await engine.loadProject({ project });
    const base = {
      startTick: 0,
      sampleRate: SR,
      channelCount: 2,
      tailSeconds: 0,
      includeMetronome: false,
    } as const;
    await expect(engine.render({ ...base, endTick: 0 })).rejects.toBeInstanceOf(AudioEngineError);
    await expect(
      engine.render({ ...base, endTick: 10, sampleRate: 22050 as 48000 }),
    ).rejects.toMatchObject({
      code: 'render-failed',
    });

    const progress: number[] = [];
    const ok = await engine.render(
      { ...base, endTick: 64 * 960 },
      { onProgress: (p) => progress.push(p.fraction) },
    );
    expect(ok.pcm.channels[0]!.length).toBe(32 * SR);
    expect(progress.length).toBeGreaterThan(10);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++)
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);

    const controller = new AbortController();
    const pending = engine.render(
      { ...base, endTick: 64 * 960 },
      {
        signal: controller.signal,
        onProgress: (p) => {
          if (p.fraction > 0.2) controller.abort();
        },
      },
    );
    await expect(pending).rejects.toMatchObject({ code: 'render-cancelled' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      engine.render({ ...base, endTick: 960 }, { signal: aborted.signal }),
    ).rejects.toMatchObject({
      code: 'render-cancelled',
    });
    await engine.dispose();
    expect(BPM * 16).toBe(TPS);
  });
});
