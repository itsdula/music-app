/**
 * Measured benchmarks (results are printed and recorded in docs/audio-engine.md).
 * Assertions are deliberately loose: they guard against pathological regressions, not
 * machine speed.
 */
import { synthesizeDrumVoice, generateReverbImpulse, DRUM_VOICE_KINDS } from '@studio/audio-dsp';
import {
  SYNTH_PRESETS,
  createInstrumentConfig,
  type Clip,
  type Project,
  type Track,
} from '@studio/domain';
import { afterAll, describe, expect, it } from 'vitest';
import {
  MemoryAssets,
  assetRef,
  audioClip,
  audioTrack,
  createEngine,
  effect,
  instrumentTrack,
  makeProject,
  midiClip,
  noise,
  note,
  waitMs,
} from './helpers';

const BAR = 3840;
const BARS = 32;
const results: Record<string, unknown> = {};

afterAll(() => {
  console.log(`BENCHMARK ${JSON.stringify(results)}`);
});

/** 16 tracks (8 synth, 4 drums, 4 audio) and 100 two-bar clips over 32 bars, with effects. */
function syntheticProject(): { project: Project; assets: MemoryAssets } {
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const pcm = { sampleRate: 48000, channels: [noise(4, 0.2, 5), noise(4, 0.2, 6)] };
  const assets = new MemoryAssets([['ast_loop', pcm]]);
  const fx = (i: number) =>
    [
      [effect(`fx_eq_${i}`, 'eq3', { lowGainDb: 3 }), effect(`fx_c_${i}`, 'compressor')],
      [effect(`fx_r_${i}`, 'reverb', { mix: 0.3, decaySeconds: 2 })],
      [effect(`fx_d_${i}`, 'delay', { mix: 0.3 })],
      [effect(`fx_x_${i}`, 'distortion', { drive: 0.4 }), effect(`fx_g_${i}`, 'gain')],
    ][i % 4]!;
  for (let t = 0; t < 16; t++) {
    const id = `trk_${t}`;
    if (t < 8) {
      const preset = SYNTH_PRESETS[t % SYNTH_PRESETS.length]!;
      tracks.push({
        ...instrumentTrack(id),
        instrument: createInstrumentConfig('synth', preset.id),
        effects: fx(t),
      });
    } else if (t < 12) {
      tracks.push({ ...instrumentTrack(id, 'drums'), effects: fx(t) });
    } else {
      tracks.push(audioTrack(id, { effects: fx(t) }));
    }
  }
  let clipIndex = 0;
  for (let c = 0; clipIndex < 100; c++) {
    const t = c % 16;
    const bar = Math.floor(c / 16) * 2;
    if (bar >= BARS) break;
    const id = `clp_${clipIndex++}`;
    const trackId = `trk_${t}`;
    if (t < 8) {
      const notes = Array.from({ length: 16 }, (_, i) =>
        note(`${id}_${i}`, (i % 8) * 960, 900, 48 + ((i * 7 + t) % 24), 90),
      );
      clips.push(midiClip(id, trackId, bar * BAR, notes, { lengthTicks: 2 * BAR }));
    } else if (t < 12) {
      const hits = Array.from({ length: 32 }, (_, i) =>
        note(`${id}_${i}`, i * 240, 120, [36, 42, 38, 42][i % 4]!, 100),
      );
      clips.push(midiClip(id, trackId, bar * BAR, hits, { lengthTicks: 2 * BAR }));
    } else {
      clips.push(audioClip(id, trackId, 'ast_loop', bar * BAR, 4 * 48000));
    }
  }
  return { project: makeProject(tracks, clips, [assetRef('ast_loop', pcm)]), assets };
}

describe('benchmarks', () => {
  it('offline render of a 16-track / 100-clip project', async () => {
    const { project, assets } = syntheticProject();
    expect(Object.keys(project.clips)).toHaveLength(100);
    const engine = createEngine(assets);
    await engine.loadProject({ project });
    const audioSeconds = (BARS * BAR) / 1920;
    const start = performance.now();
    const result = await engine.render({
      startTick: 0,
      endTick: BARS * BAR,
      sampleRate: 48000,
      channelCount: 2,
      tailSeconds: 'auto',
      includeMetronome: false,
    });
    const ms = performance.now() - start;
    results.render = {
      tracks: 16,
      clips: 100,
      audioSeconds: audioSeconds + result.tailSeconds,
      renderMs: Math.round(ms),
      realtimeFactor: Number(((audioSeconds + result.tailSeconds) / (ms / 1000)).toFixed(1)),
      peak: Number(result.peak.toFixed(3)),
    };
    expect(result.peak).toBeGreaterThan(0.01);
    expect(ms / 1000).toBeLessThan(audioSeconds * 2);

    // Same arrangement without any effects, to show where render time goes.
    const dry: Project = {
      ...project,
      tracks: Object.fromEntries(
        Object.entries(project.tracks).map(([id, t]) => [id, { ...t, effects: [] }]),
      ),
    };
    await engine.loadProject({ project: dry });
    const dryStart = performance.now();
    await engine.render({
      startTick: 0,
      endTick: BARS * BAR,
      sampleRate: 48000,
      channelCount: 2,
      tailSeconds: 0,
      includeMetronome: false,
    });
    const dryMs = performance.now() - dryStart;
    results.renderNoEffects = {
      audioSeconds,
      renderMs: Math.round(dryMs),
      realtimeFactor: Number((audioSeconds / (dryMs / 1000)).toFixed(1)),
    };
    await engine.dispose();
  }, 240_000);

  it('scheduler tick cost and meter read cost while playing 16 tracks', async () => {
    const { project, assets } = syntheticProject();
    const engine = createEngine(assets);
    await engine.loadProject({ project });
    await engine.resume();
    await engine.play(0);
    await waitMs(300);
    engine.resetDiagnostics();
    await waitMs(3000);
    const diag = engine.getDiagnostics();
    results.scheduler = {
      ticks: diag.schedulerTicks,
      avgMs: Number(diag.schedulerAvgMs.toFixed(3)),
      maxMs: Number(diag.schedulerMaxMs.toFixed(3)),
      activeVoices: diag.activeVoices,
      lateDropped: diag.lateEventsDropped,
      heartbeat: diag.heartbeat,
    };
    expect(diag.schedulerTicks).toBeGreaterThan(50);
    expect(diag.schedulerAvgMs).toBeLessThan(10);

    const reads = 2000;
    let sink = 0;
    const start = performance.now();
    for (let i = 0; i < reads; i++) sink += engine.readMeters().master.peak[0]!;
    const perRead = (performance.now() - start) / reads;
    // Realistic cadence: replies have arrived, so each read also posts 17 'read' requests.
    // performance.now() is clamped to 100 µs (jittered) without cross-origin isolation,
    // so the mean over many reads is reported.
    const frames = 300;
    let frameTotal = 0;
    for (let i = 0; i < frames; i++) {
      await waitMs(4);
      const t0 = performance.now();
      const snapshot = engine.readMeters();
      frameTotal += performance.now() - t0;
      sink += snapshot.master.rms[0]!;
    }
    results.meters = {
      channels: 17,
      tightLoopUsPerRead: Number((perRead * 1000).toFixed(1)),
      withRequestsMeanUs: Number(((frameTotal / frames) * 1000).toFixed(1)),
    };
    // Meters lag one request round trip (longer under load): poll briefly.
    let masterPeak = 0;
    for (let i = 0; i < 50 && masterPeak === 0; i++) {
      await waitMs(20);
      masterPeak = engine.readMeters().master.peak[0]!;
    }
    expect(masterPeak).toBeGreaterThan(0);
    expect(Number.isFinite(sink)).toBe(true);
    expect(perRead).toBeLessThan(5);
    await engine.dispose();
  }, 60_000);

  it('DSP preparation costs (drum kit re-render, reverb IR)', () => {
    let start = performance.now();
    for (const kind of DRUM_VOICE_KINDS) synthesizeDrumVoice(kind, 48000, { seed: 1 });
    const kitMs = performance.now() - start;
    start = performance.now();
    for (const kind of DRUM_VOICE_KINDS)
      synthesizeDrumVoice(kind, 48000, { seed: 1, decayScale: 4 });
    const longKitMs = performance.now() - start;
    start = performance.now();
    generateReverbImpulse(48000, 2.2, 8000, 1);
    const irMs = performance.now() - start;
    start = performance.now();
    generateReverbImpulse(48000, 10, 8000, 1);
    const longIrMs = performance.now() - start;
    results.dsp = {
      drumKitMs: Number(kitMs.toFixed(1)),
      drumKitDecay4Ms: Number(longKitMs.toFixed(1)),
      reverbIr2_2sMs: Number(irMs.toFixed(1)),
      reverbIr10sMs: Number(longIrMs.toFixed(1)),
    };
    expect(kitMs).toBeLessThan(2000);
  });
});
