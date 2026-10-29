import type { AudioEngineEvent } from '@studio/audio-contracts';
import { asAssetId, asTrackId, type Project } from '@studio/domain';
import { diffProjects } from '@studio/engine-core';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebAudioBackendFactory, type WebAudioEngine } from '../src';
import {
  MemoryAssets,
  SINE_SYNTH,
  TPS,
  assetRef,
  audioClip,
  audioTrack,
  createEngine,
  instrumentTrack,
  makeProject,
  midiClip,
  note,
  sine,
  waitMs,
} from './helpers';

const engines: WebAudioEngine[] = [];
function track(engine: WebAudioEngine): WebAudioEngine {
  engines.push(engine);
  return engine;
}
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
});

/** Polls meters until `predicate` holds (meters arrive one read round-trip late). */
async function meterUntil(
  engine: WebAudioEngine,
  predicate: (peak: number) => boolean,
  timeoutMs = 1500,
): Promise<number> {
  const start = performance.now();
  let last = 0;
  while (performance.now() - start < timeoutMs) {
    last = engine.readMeters().master.peak[0]!;
    if (predicate(last)) return last;
    await waitMs(20);
  }
  return last;
}

describe('lifecycle', () => {
  it('initializes an interactive AudioContext and reports capabilities and lifecycle events', async () => {
    const factory = createWebAudioBackendFactory();
    expect(factory.kind).toBe('web-audio');
    expect(factory.isSupported()).toBe(true);
    const engine = track(factory.create({ assets: new MemoryAssets() }) as WebAudioEngine);
    const events: AudioEngineEvent[] = [];
    engine.subscribe((e) => events.push(e));
    expect(engine.getLifecycleState()).toBe('uninitialized');
    const caps = await engine.initialize();
    expect(caps.backend).toBe('web-audio');
    expect(caps.sampleRate).toBeGreaterThan(0);
    expect(caps.offlineRender).toBe(true);
    expect(caps.recording).toBe(true);
    expect(typeof caps.baseLatencySeconds).toBe('number');
    expect(caps.outputLatencySeconds).not.toBeUndefined();
    expect(await engine.initialize()).toBe(caps);
    await engine.resume();
    expect(engine.getLifecycleState()).toBe('running');
    expect(events.some((e) => e.type === 'lifecycle' && e.state === 'running')).toBe(true);
    expect(engine.getDiagnostics().heartbeat).toBe('worker');
    expect(engine.getDiagnostics().workletReady).toBe(true);
    await engine.dispose();
    expect(engine.getLifecycleState()).toBe('closed');
    expect(events[events.length - 1]).toEqual({ type: 'lifecycle', state: 'closed' });
    expect(engine.getDiagnostics().contextState).toBe('closed');
  });

  it('falls back to setInterval when asked not to use a Worker', async () => {
    const engine = track(
      createWebAudioBackendFactory({ useWorkerClock: false }).create({
        assets: new MemoryAssets(),
      }) as WebAudioEngine,
    );
    await engine.loadProject({ project: makeProject([]) });
    await engine.play();
    await waitMs(200);
    expect(engine.getDiagnostics().heartbeat).toBe('interval');
    expect(engine.getDiagnostics().schedulerTicks).toBeGreaterThan(3);
  });
});

describe('transport on the realtime clock', () => {
  async function playing(project: Project = makeProject([])) {
    const engine = track(createEngine());
    await engine.loadProject({ project });
    await engine.resume();
    return engine;
  }

  it('advances at real time while playing, pauses, and stop returns to the play start', async () => {
    const engine = await playing();
    const transport: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'transport') transport.push(e.transport.state);
    });
    await engine.play(960);
    const t0 = performance.now();
    const start = engine.getTransportPosition();
    expect(start.state).toBe('playing');
    await waitMs(500);
    const pos = engine.getTransportPosition();
    const elapsedTicks = ((performance.now() - t0) / 1000) * TPS;
    expect(pos.ticks - 960).toBeGreaterThan(elapsedTicks * 0.75 - 100);
    expect(pos.ticks - 960).toBeLessThan(elapsedTicks * 1.1 + 50);
    // Position is consistent with the engine clock.
    expect(pos.engineTime).toBeGreaterThan(start.engineTime);

    await engine.pause();
    const paused = engine.getTransportPosition();
    expect(paused.state).toBe('paused');
    await waitMs(100);
    expect(engine.getTransportPosition().ticks).toBe(paused.ticks);
    await engine.play();
    await waitMs(100);
    expect(engine.getTransportPosition().ticks).toBeGreaterThan(paused.ticks);

    await engine.stop();
    expect(engine.getTransportPosition()).toMatchObject({ state: 'stopped', ticks: 960 });
    expect(transport).toEqual(expect.arrayContaining(['playing', 'paused', 'stopped']));
  });

  it('seeks while playing and while stopped', async () => {
    const engine = await playing();
    await engine.seek(5000);
    expect(engine.getTransportPosition().ticks).toBe(5000);
    await engine.play();
    await waitMs(150);
    await engine.seek(20_000);
    await waitMs(200);
    const ticks = engine.getTransportPosition().ticks;
    expect(ticks).toBeGreaterThan(20_000);
    expect(ticks).toBeLessThan(20_000 + 0.5 * TPS);
    await engine.stop();
    expect(engine.getTransportPosition().ticks).toBe(20_000); // seek while playing sets the play start
  });

  it('wraps at the loop end and keeps cycling inside the loop', async () => {
    const project = makeProject([], [], [], {
      loop: { enabled: true, startTick: 480, endTick: 960 },
    });
    const engine = await playing(project);
    await engine.play(0);
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      seen.push(engine.getTransportPosition().ticks);
      await waitMs(25);
    }
    expect(Math.max(...seen)).toBeLessThan(960);
    const late = seen.slice(20);
    expect(Math.min(...late)).toBeGreaterThanOrEqual(480);
    // At least one wrap observed (position decreased).
    expect(seen.some((v, i) => i > 0 && v < seen[i - 1]!)).toBe(true);
  });

  it('plays scheduled notes audibly, edits while playing take effect, stop silences', async () => {
    const synth = instrumentTrack('trk_s', 'synth', SINE_SYNTH);
    const project = makeProject(
      [synth],
      [midiClip('clp_1', 'trk_s', 0, [note('n1', 0, 40 * 960, 69)])],
    );
    const engine = await playing(project);
    await engine.play(0);
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1);
    const meters = engine.readMeters();
    expect(Object.keys(meters.tracks)).toEqual(['trk_s']);

    // Mute through applyChanges(diffProjects(...)) → silence.
    const muted: Project = {
      ...project,
      tracks: { [synth.id]: { ...synth, mixer: { ...synth.mixer, mute: true } } },
    };
    await engine.applyChanges(diffProjects(project, muted));
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    // Unmute and delete the clip → the sounding note stops.
    await engine.applyChanges(diffProjects(muted, project));
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1);
    const noClip: Project = { ...project, clips: {} };
    await engine.applyChanges(diffProjects(project, noClip));
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    // Add a clip back while playing: notes starting after "now" are scheduled.
    const position = engine.getTransportPosition().ticks;
    const later: Project = {
      ...noClip,
      clips: {
        [midiClip('clp_2', 'trk_s', 0, []).id]: midiClip('clp_2', 'trk_s', 0, [
          note('n2', Math.ceil(position) + 480, 3840, 69),
        ]),
      },
    };
    await engine.applyChanges(diffProjects(noClip, later));
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1);
    await engine.stop();
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    expect(engine.getDiagnostics().schedulerTicks).toBeGreaterThan(3);
  });

  it('editing one clip while playing does not double notes of other clips on the track', async () => {
    const synth = instrumentTrack('trk_s', 'synth', SINE_SYNTH);
    const a = midiClip('clp_a', 'trk_s', 0, [note('na', 960, 4 * 3840, 69)]);
    const b = midiClip('clp_b', 'trk_s', 0, [note('nb', 60_000, 960, 72)]);
    const project = makeProject([synth], [a, b]);
    const engine = await playing(project);
    // clp_a's note starts ~31 ms after play — inside the first scheduled window.
    await engine.play(900);
    const edited: Project = {
      ...project,
      clips: { ...project.clips, [b.id]: { ...b, notes: [note('nb', 61_000, 960, 72)] } },
    };
    await engine.applyChanges(diffProjects(project, edited));
    await waitMs(300);
    expect(engine.getDiagnostics().activeVoices).toBe(1);
  });

  it('tempo and loop edits while playing keep the position continuous', async () => {
    const project = makeProject([]);
    const engine = await playing(project);
    await engine.play(0);
    await waitMs(200);
    const before = engine.getTransportPosition().ticks;
    const faster = { ...project, bpm: 240 };
    await engine.applyChanges(diffProjects(project, faster));
    const right = engine.getTransportPosition().ticks;
    expect(Math.abs(right - before)).toBeLessThan(0.1 * TPS);
    await waitMs(250);
    const after = engine.getTransportPosition().ticks;
    // 240 bpm = 3840 ticks/s.
    expect(after - right).toBeGreaterThan(0.25 * 3840 * 0.6);
    const looped = {
      ...faster,
      loop: { enabled: true, startTick: 0, endTick: Math.ceil(after) + 960 },
    };
    await engine.applyChanges(diffProjects(faster, looped));
    await waitMs(600);
    expect(engine.getTransportPosition().ticks).toBeLessThan(looped.loop.endTick);
  });

  it('plays audio clips from mid-clip positions after a seek and on asset overrides', async () => {
    const pcm = { sampleRate: 48000, channels: [sine(440, 4)] };
    const assets = new MemoryAssets([['ast_a', pcm]]);
    const project = makeProject(
      [audioTrack('trk_a')],
      [audioClip('clp_a', 'trk_a', 'ast_a', 0, 4 * 48000)],
      [assetRef('ast_a', pcm)],
    );
    const engine = track(createEngine(assets));
    const events: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'asset') events.push(e.status);
    });
    await engine.loadProject({ project });
    expect(events).toEqual(['loading', 'ready']);
    await engine.resume();
    await engine.play(TPS); // 1 s into the clip
    expect(await meterUntil(engine, (p) => p > 0.3)).toBeGreaterThan(0.3);
    await engine.setAssetOverride(asAssetId('ast_a'), {
      sampleRate: 48000,
      channels: [new Float32Array(48000 * 4)],
    });
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    await engine.setAssetOverride(asAssetId('ast_a'), null);
    expect(await meterUntil(engine, (p) => p > 0.3)).toBeGreaterThan(0.3);
    expect(assets.loads).toBe(1); // cached
  });
});

describe('live input', () => {
  it('plays notes while stopped, honours sustain, and allNotesOff releases', async () => {
    const synth = instrumentTrack('trk_s', 'synth', { ...SINE_SYNTH, release: 0.05 });
    const engine = track(createEngine());
    await engine.loadProject({ project: makeProject([synth]) });
    await engine.resume();
    const id = asTrackId('trk_s');
    engine.live.noteOn(id, 69, 120);
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1);
    expect(engine.getDiagnostics().activeVoices).toBe(1);
    engine.live.sustain(id, true);
    engine.live.noteOff(id, 69);
    await waitMs(200);
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1); // sustained
    engine.live.pitchBend(id, 1);
    engine.live.modulation(id, 1);
    engine.live.sustain(id, false);
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    await waitMs(100);
    expect(engine.getDiagnostics().activeVoices).toBe(0); // voice nodes released on 'ended'

    engine.live.noteOn(id, 60, 100);
    engine.live.noteOn(id, 64, 100);
    engine.live.noteOn(id, 67, 0); // velocity 0 = note off (no-op here)
    expect(await meterUntil(engine, (p) => p > 0.1)).toBeGreaterThan(0.1);
    engine.live.allNotesOff();
    expect(await meterUntil(engine, (p) => p < 1e-4)).toBeLessThan(1e-4);
    // Unknown tracks are ignored.
    engine.live.noteOn(asTrackId('trk_nope'), 60, 100);
  });

  it('plays drum hits live', async () => {
    const engine = track(createEngine());
    await engine.loadProject({ project: makeProject([instrumentTrack('trk_d', 'drums')]) });
    await engine.resume();
    engine.live.noteOn(asTrackId('trk_d'), 36, 127);
    expect(await meterUntil(engine, (p) => p > 0.05)).toBeGreaterThan(0.05);
  });
});

describe('recording', () => {
  it('records a non-silent take of the expected duration from the fake microphone', async () => {
    const engine = track(createEngine());
    await engine.loadProject({ project: makeProject([audioTrack('trk_rec')]) });
    await engine.resume();
    const devices = await engine.listInputDevices();
    expect(devices.length).toBeGreaterThan(0);
    const statuses: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'recording') statuses.push(e.status.phase);
    });
    await engine.startRecording({ trackIds: [asTrackId('trk_rec')], channelCount: 1 });
    expect(engine.getTransportPosition()).toMatchObject({ state: 'playing', recording: true });
    const started = performance.now();
    await waitMs(1500);
    const takes = await engine.stopRecording();
    const wall = (performance.now() - started) / 1000;
    expect(takes).toHaveLength(1);
    const take = takes[0]!;
    const seconds = take.pcm.channels[0]!.length / take.pcm.sampleRate;
    expect(seconds).toBeGreaterThan(wall - 0.25);
    expect(seconds).toBeLessThan(wall + 0.25);
    let peak = 0;
    for (const v of take.pcm.channels[0]!) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
    expect(take.inputLabel).toMatch(/Fake/);
    expect(take.latencyCompensationSeconds).toBeCloseTo(
      engine.estimateLatencySeconds({ latencySeconds: 0.01 } as never),
      1,
    );
    // Take starts near the transport position where recording began, minus latency.
    expect(take.startTick).toBeLessThan(0.2 * TPS);
    expect(take.startTick).toBeGreaterThan(-0.2 * TPS);
    expect(statuses).toEqual(['requesting-permission', 'recording', 'finalizing', 'idle']);
    expect(engine.getTransportPosition().recording).toBe(false);
    expect(await engine.stopRecording()).toEqual([]);
  });

  it('applies an explicit latency override and supports stereo multi-track takes', async () => {
    const engine = track(createEngine());
    await engine.loadProject({ project: makeProject([audioTrack('trk_a'), audioTrack('trk_b')]) });
    await engine.resume();
    await engine.play(TPS * 2);
    await waitMs(100);
    await engine.startRecording({
      trackIds: [asTrackId('trk_a'), asTrackId('trk_b')],
      channelCount: 2,
      latencyCompensationSeconds: 0.5,
    });
    const startedAt = engine.getTransportPosition().ticks;
    await waitMs(400);
    const takes = await engine.stopRecording();
    expect(takes.map((t) => t.trackId)).toEqual(['trk_a', 'trk_b']);
    expect(takes[0]!.pcm.channels).toHaveLength(2);
    expect(takes[0]!.pcm.channels[0]).not.toBe(takes[1]!.pcm.channels[0]);
    expect(takes[0]!.latencyCompensationSeconds).toBe(0.5);
    // Shifted ~0.5 s (960 ticks) earlier than the transport position at record start.
    expect(startedAt - takes[0]!.startTick).toBeGreaterThan(0.4 * TPS);
    expect(startedAt - takes[0]!.startTick).toBeLessThan(0.75 * TPS);
  });

  it('maps permission and device failures to microphone-denied / microphone-unavailable', async () => {
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    try {
      for (const [name, code] of [
        ['NotAllowedError', 'microphone-denied'],
        ['NotFoundError', 'microphone-unavailable'],
        ['NotReadableError', 'microphone-unavailable'],
      ] as const) {
        media.getUserMedia = () => Promise.reject(new DOMException('mock', name));
        const engine = track(createEngine());
        await engine.loadProject({ project: makeProject([audioTrack('trk_a')]) });
        const errors: string[] = [];
        engine.subscribe((e) => {
          if (e.type === 'error') errors.push(e.error.code);
        });
        await expect(
          engine.startRecording({ trackIds: [asTrackId('trk_a')], channelCount: 1 }),
        ).rejects.toMatchObject({ code });
        expect(errors).toEqual([code]);
        expect(engine.getRecordingStatus().phase).toBe('error');
        await expect(engine.setInputMonitoring(asTrackId('trk_a'), true)).rejects.toMatchObject({
          code,
        });
      }
    } finally {
      media.getUserMedia = original;
    }
  });

  it('monitors input through the track chain', async () => {
    const engine = track(createEngine());
    await engine.loadProject({ project: makeProject([audioTrack('trk_a', { inputChannels: 1 })]) });
    await engine.resume();
    await engine.setInputMonitoring(asTrackId('trk_a'), true);
    await engine.setInputMonitoring(asTrackId('trk_a'), true); // idempotent
    // The fake device emits periodic beeps; wait for one to reach the track meter.
    let seen = 0;
    const until = performance.now() + 2500;
    while (performance.now() < until && seen < 0.01) {
      seen = Math.max(seen, engine.readMeters().tracks[asTrackId('trk_a')]!.peak[0]!);
      await waitMs(20);
    }
    expect(seen).toBeGreaterThan(0.01);
    await engine.setInputMonitoring(asTrackId('trk_a'), false);
  });
});
