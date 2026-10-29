/**
 * Deterministic tests of the realtime scheduling path (EventScheduler + engine-core
 * planning) driven on an OfflineAudioContext, plus dynamic behaviour (click-free stop,
 * parameter smoothing, bypass crossfade, IR regeneration, live modulation).
 */
import {
  dominantFrequency,
  magnitudeSpectrum,
  rmsOfSamples,
  type PcmAudio,
} from '@studio/audio-dsp';
import { asAssetId, type Project } from '@studio/domain';
import {
  createTransportClock,
  planScheduleSegments,
  unwrappedTickAtTime,
  type TransportClock,
} from '@studio/engine-core';
import { describe, expect, it } from 'vitest';
import { AssetBufferStore } from '../src/assets';
import { EffectUnit } from '../src/effects/effect-unit';
import { EFFECT_PROCESSORS } from '../src/effects/processors';
import { createGraphContext, type GraphContext } from '../src/graph/graph-context';
import { ProjectGraph } from '../src/graph/project-graph';
import { SynthInstrument } from '../src/instruments/synth';
import { EngineModel } from '../src/model';
import { EventScheduler } from '../src/scheduler/event-scheduler';
import { SILENT_LOGGER } from '../src/errors';
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
  rmsBetween,
  slice,
  waitMs,
} from './helpers';

interface Rig {
  ctx: OfflineAudioContext;
  g: GraphContext;
  graph: ProjectGraph;
  scheduler: EventScheduler;
  model: EngineModel;
}

async function rig(
  project: Project,
  seconds: number,
  assets = new MemoryAssets(),
  realtime = false,
): Promise<Rig> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.ceil(seconds * SR),
    sampleRate: SR,
  });
  const store = new AssetBufferStore(assets, () => undefined, SILENT_LOGGER);
  const model = new EngineModel(project);
  await Promise.all([...model.referencedAssets()].map((id) => store.ensure(id)));
  const g = createGraphContext({
    ctx,
    realtime,
    logger: SILENT_LOGGER,
    assets: store,
    workletReady: false,
  });
  const graph = new ProjectGraph(g, {
    tracks: model.orderedTracks(),
    master: model.master,
    metronome: model.metronome,
    meters: false,
  });
  return { ctx, g, graph, scheduler: new EventScheduler(graph, model, store), model };
}

/** Schedules [0, seconds) of a clock in windows of `windowSeconds` (as the heartbeat would). */
function scheduleInWindows(
  r: Rig,
  clock: TransportClock,
  seconds: number,
  windowSeconds: number,
): void {
  let u = clock.anchorTick;
  let first = true;
  for (let t = windowSeconds; t < seconds + windowSeconds; t += windowSeconds) {
    const to = unwrappedTickAtTime(clock, Math.min(t, seconds));
    r.scheduler.schedule(planScheduleSegments(clock, u, to, { startIsDiscontinuity: first }), {
      metronome: false,
      earliestTime: 0,
    });
    u = to;
    first = false;
  }
}

describe('loop scheduling', () => {
  it('cuts notes crossing the loop end and replays them after each wrap', async () => {
    const project = makeProject(
      [instrumentTrack('trk_s', 'synth', SINE_SYNTH)],
      [midiClip('clp_1', 'trk_s', 0, [note('n1', 480, 960, 69)])],
    );
    const r = await rig(project, 1.5);
    // Loop [0, 960) = 0.5 s; the note (0.25 s → 0.75 s) crosses the loop end.
    const clock = createTransportClock(0, 0, 120, { enabled: true, startTick: 0, endTick: 960 });
    scheduleInWindows(r, clock, 1.5, 0.12);
    const out = (await r.ctx.startRendering()).getChannelData(0);
    for (const pass of [0, 0.5, 1]) {
      // The note sounds from 0.25 s into every pass …
      expect(rmsBetween(out, pass + 0.27, pass + 0.48), `pass at ${pass}`).toBeGreaterThan(0.1);
      // … and is released at the loop end (release 50 ms + margin): silent until the next note-on.
      if (pass > 0)
        expect(rmsBetween(out, pass + 0.08, pass + 0.245), `gap after wrap ${pass}`).toBeLessThan(
          1e-5,
        );
    }
    // Without the loop-end cut the note would still sound right after the wrap.
    expect(rmsBetween(out, 0.5, 0.52)).toBeLessThan(rmsBetween(out, 0.46, 0.48));
  });

  it('stops audio clips at the loop end and resumes them mid-clip after the wrap', async () => {
    const source = new Float32Array(SR * 2);
    for (let i = 0; i < source.length; i++) source[i] = (i % 4800) / 4800 - 0.5; // sawtooth ramp: offset is visible
    const pcm: PcmAudio = { sampleRate: SR, channels: [source] };
    const assets = new MemoryAssets([['ast_r', pcm]]);
    const project = makeProject(
      [audioTrack('trk_a')],
      [audioClip('clp_a', 'trk_a', 'ast_r', 0, SR * 2)],
      [assetRef('ast_r', pcm)],
    );
    const r = await rig(project, 1.6, assets);
    // Loop [0.25 s, 0.75 s) inside the clip; playback starts at 0.
    const clock = createTransportClock(0, 0, 120, { enabled: true, startTick: 480, endTick: 1440 });
    scheduleInWindows(r, clock, 1.6, 0.12);
    const out = (await r.ctx.startRendering()).getChannelData(0);
    // First pass plays the clip from frame 0 …
    expect(Math.abs(out[1000]! - source[1000]!)).toBeLessThan(1e-4);
    // … after the wrap at 0.75 s (frame 36000) it continues from the loop start (source frame 12000).
    const wrap = 36000;
    for (const i of [500, 3000, 20000]) {
      expect(Math.abs(out[wrap + i]! - source[12000 + i]!), `frame +${i}`).toBeLessThan(1e-4);
    }
    // Second wrap at 1.25 s.
    expect(Math.abs(out[60000 + 2000]! - source[12000 + 2000]!)).toBeLessThan(1e-4);
  });

  it('produces identical audio regardless of the scheduling window size', async () => {
    const project = makeProject(
      [instrumentTrack('trk_s', 'synth', SINE_SYNTH), instrumentTrack('trk_d', 'drums')],
      [
        midiClip(
          'clp_1',
          'trk_s',
          0,
          Array.from({ length: 12 }, (_, i) => note(`n${i}`, i * 300, 400, 60 + i)),
        ),
        midiClip(
          'clp_2',
          'trk_d',
          0,
          Array.from({ length: 16 }, (_, i) =>
            note(`d${i}`, i * 240, 100, [36, 42, 38, 42][i % 4]!),
          ),
        ),
      ],
    );
    const loop = { enabled: true, startTick: 960, endTick: 2880 };
    const renders: Float32Array[] = [];
    for (const windowSeconds of [0.025, 0.12, 0.37, 5]) {
      const r = await rig(project, 2.5);
      scheduleInWindows(r, createTransportClock(0, 0, 120, loop), 2.5, windowSeconds);
      renders.push((await r.ctx.startRendering()).getChannelData(0).slice());
    }
    expect(rmsOfSamples(renders[0]!)).toBeGreaterThan(0.01);
    for (const other of renders.slice(1)) expect(maxAbsDiff(other, renders[0]!)).toBeLessThan(1e-5);
  });
});

describe('click-free transitions', () => {
  /** Largest sample-to-sample step in a range — a click shows up as a large jump. */
  function maxStep(samples: Float32Array, from: number, to: number): number {
    let max = 0;
    for (let i = from + 1; i < to; i++)
      max = Math.max(max, Math.abs(samples[i]! - samples[i - 1]!));
    return max;
  }

  it('stop (cancelTransport) fades sounding voices within ~10 ms without a jump', async () => {
    const project = makeProject(
      [instrumentTrack('trk_s', 'synth', { ...SINE_SYNTH, release: 2 })],
      [midiClip('clp_1', 'trk_s', 0, [note('n1', 0, 3840, 69)])],
    );
    const r = await rig(project, 1);
    scheduleInWindows(r, createTransportClock(0, 0, 120, null), 1, 0.12);
    let stopFrame = 0;
    void r.ctx.suspend(0.5).then(() => {
      // Suspend points are quantized to 128 frames; stop at the actual current time.
      stopFrame = Math.round(r.ctx.currentTime * SR);
      r.graph.cancelTransport(r.ctx.currentTime);
      return r.ctx.resume();
    });
    const out = (await r.ctx.startRendering()).getChannelData(0);
    expect(rmsBetween(out, 0.4, 0.5)).toBeGreaterThan(0.2);
    expect(rmsOfSamples(out, stopFrame + 700, stopFrame + 4800)).toBe(0);
    // A 440 Hz sine at 0.5 peak moves ≤ 0.029 per sample; the fade must not add a jump.
    expect(maxStep(out, stopFrame - 10, stopFrame + 700)).toBeLessThan(0.035);
  });

  it('parameter changes glide (no zipper) and bypass crossfades over ~10 ms', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR, sampleRate: SR });
    const g = createGraphContext({
      ctx,
      realtime: false,
      logger: SILENT_LOGGER,
      assets: new AssetBufferStore(new MemoryAssets(), () => undefined, SILENT_LOGGER),
      workletReady: false,
    });
    const dc = new ConstantSourceNode(ctx, { offset: 0.5 });
    const unit = new EffectUnit(g, effect('fx_g', 'gain', { gainDb: 0 }), EFFECT_PROCESSORS.gain);
    dc.connect(unit.input);
    unit.output.connect(ctx.destination);
    dc.start();
    void ctx.suspend(0.25).then(() => {
      unit.update(effect('fx_g', 'gain', { gainDb: -20 }));
      return ctx.resume();
    });
    void ctx.suspend(0.5).then(() => {
      unit.update(effect('fx_g', 'gain', { gainDb: -20 }, true));
      return ctx.resume();
    });
    const out = (await ctx.startRendering()).getChannelData(0);
    expect(out[11000]).toBeCloseTo(0.5, 5);
    // Glide: after 1 ms the gain has moved only part of the way; after 100 ms it has settled.
    expect(out[12000 + 48]!).toBeGreaterThan(0.3);
    expect(out[12000 + 4800]!).toBeCloseTo(0.05, 3);
    expect(maxStep(out, 11900, 14000)).toBeLessThan(0.02);
    // Bypass: linear 10 ms crossfade from 0.05 back to the dry 0.5.
    expect(out[24000 + 240]!).toBeGreaterThan(0.2);
    expect(out[24000 + 240]!).toBeLessThan(0.35);
    expect(out[24000 + 600]!).toBeCloseTo(0.5, 5);
    expect(maxStep(out, 23990, 24600)).toBeLessThan(0.003);
  });

  it('regenerates the reverb impulse (debounced) when decay changes, crossfading convolvers', async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: SR * 2, sampleRate: SR });
    // realtime=true exercises the debounce timer path before rendering starts.
    const g = createGraphContext({
      ctx,
      realtime: true,
      logger: SILENT_LOGGER,
      assets: new AssetBufferStore(new MemoryAssets(), () => undefined, SILENT_LOGGER),
      workletReady: false,
    });
    const unit = new EffectUnit(
      g,
      effect('fx_r', 'reverb', { mix: 1, decaySeconds: 0.3 }),
      EFFECT_PROCESSORS.reverb,
    );
    unit.update(effect('fx_r', 'reverb', { mix: 1, decaySeconds: 3 }));
    unit.update(effect('fx_r', 'reverb', { mix: 1, decaySeconds: 1.5 })); // only the last change is applied
    await waitMs(250);
    const burst = new AudioBufferSourceNode(ctx, {
      buffer: (() => {
        const b = new AudioBuffer({ length: 4800, numberOfChannels: 1, sampleRate: SR });
        b.getChannelData(0).set(noise(0.1, 0.5, 2));
        return b;
      })(),
    });
    burst.connect(unit.input);
    unit.output.connect(ctx.destination);
    burst.start(0.2);
    const out = (await ctx.startRendering()).getChannelData(0);
    // A 0.3 s reverb would be ~60 dB down 0.5 s after the burst; the regenerated 1.5 s one is not.
    expect(rmsBetween(out, 0.8, 1.0)).toBeGreaterThan(1e-3);
    expect(rmsBetween(out, 1.9, 2.0)).toBeLessThan(rmsBetween(out, 0.8, 1.0) * 0.05);
    unit.dispose();
    g.dispose();
  });
});

describe('live modulation', () => {
  function liveRig(seconds: number) {
    const ctx = new OfflineAudioContext({
      numberOfChannels: 1,
      length: Math.ceil(seconds * SR),
      sampleRate: SR,
    });
    const g = createGraphContext({
      ctx,
      realtime: false,
      logger: SILENT_LOGGER,
      assets: new AssetBufferStore(new MemoryAssets(), () => undefined, SILENT_LOGGER),
      workletReady: false,
    });
    const synth = new SynthInstrument(g, instrumentTrack('trk', 'synth', SINE_SYNTH).instrument!);
    synth.output.connect(ctx.destination);
    return { ctx, synth };
  }

  it('pitch bend shifts by up to ±2 semitones and the mod wheel adds vibrato', async () => {
    const { ctx, synth } = liveRig(2);
    synth.noteOn(69, 127, 0);
    synth.pitchBend(1, 0.5);
    synth.pitchBend(-1, 1);
    synth.pitchBend(0, 1.5);
    synth.modulation(1, 1.5);
    const out = (await ctx.startRendering()).getChannelData(0);
    expect(dominantFrequency(slice(out, 0.1, 0.45), SR)).toBeCloseTo(440, -1);
    expect(Math.abs(dominantFrequency(slice(out, 0.6, 0.95), SR) - 493.88)).toBeLessThan(2);
    expect(Math.abs(dominantFrequency(slice(out, 1.1, 1.45), SR) - 392)).toBeLessThan(2);
    // Vibrato (±50 cents at 5.5 Hz) smears the 440 Hz line: the peak bin loses energy.
    const steady = magnitudeSpectrum(slice(out, 0.05, 0.45), 32768);
    const vibrato = magnitudeSpectrum(slice(out, 1.55, 1.95), 32768);
    const peak = (s: Float64Array) => Math.max(...Array.from(s.subarray(250, 400)));
    expect(peak(vibrato)).toBeLessThan(peak(steady) * 0.7);
  });

  it('mono legato glides live notes and releases cleanly; voices are freed after release', async () => {
    const { ctx, synth } = liveRig(1.5);
    synth.update({
      ...instrumentTrack('trk', 'synth', { ...SINE_SYNTH, polyphony: 1, glideMs: 200 }).instrument!,
    });
    synth.noteOn(57, 127, 0);
    synth.noteOn(69, 127, 0.5); // legato: same voice, glides 220 → 440 Hz
    synth.noteOff(57, 0.6);
    synth.noteOff(69, 1);
    expect(synth.activeVoiceCount()).toBe(1);
    const out = (await ctx.startRendering()).getChannelData(0);
    expect(dominantFrequency(slice(out, 0.1, 0.45), SR)).toBeCloseTo(220, -1);
    expect(dominantFrequency(slice(out, 0.75, 0.98), SR)).toBeCloseTo(440, -1);
    expect(rmsBetween(out, 1.1, 1.5)).toBeLessThan(1e-5);
    await waitMs(50);
    expect(synth.activeVoiceCount()).toBe(0);
    synth.dispose();
    expect(asAssetId('x')).toBe('x');
  });
});
