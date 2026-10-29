import { decodeWav, encodeWav } from '@studio/audio-dsp';
import { normalizeParam, orderedTracks, PPQ, TRACK_GAIN_SPEC, type ClipId, type MidiClip, type TrackId } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { createTestPlatform, type TestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];

async function startSession(platform: TestPlatform = createTestPlatform()) {
  const session = createStudioSession(platform, { ...DEFAULT_STUDIO_CONFIG, autosaveDelayMs: 5 });
  sessions.push(session);
  await session.start();
  return { session, platform };
}

afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

function sineWav(seconds: number, sampleRate = 48000): Uint8Array {
  const frames = Math.round(seconds * sampleRate);
  const data = new Float32Array(frames);
  for (let i = 0; i < frames; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  return encodeWav({ sampleRate, channels: [data] }, { bitDepth: 16 });
}

describe('session lifecycle', () => {
  it('starts with a saved starter project loaded into the engine', async () => {
    const { session, platform } = await startSession();
    const project = session.history.present;
    expect(orderedTracks(project).map((t) => t.kind)).toEqual(['instrument']);
    expect(platform.engine.project?.id).toBe(project.id);
    expect(session.uiStore.getState().selection.trackId).toBe(project.trackOrder[0]);
    const list = await platform.projectRepository.list();
    expect(list.map((p) => p.id)).toContain(project.id);
  });

  it('syncs edits and undo to the engine through incremental changes', async () => {
    const { session, platform } = await startSession();
    const trackId = session.history.present.trackOrder[0]!;
    const clipId = session.edits.createMidiClip(trackId, 0)!;
    session.edits.addNotes(clipId, [{ startTick: 0, durationTicks: PPQ, pitch: 69, velocity: 100 }]);
    session.history.undo();
    session.history.undo();
    await new Promise((r) => setTimeout(r, 0));
    const types = platform.engine.changes.flat().map((c) => c.type);
    expect(types).toEqual(['clip.add', 'clip.update', 'clip.update', 'clip.remove']);
  });

  it('autosaves and reopens the same project in a new session', async () => {
    const platform = createTestPlatform();
    const { session } = await startSession(platform);
    const trackId = session.history.present.trackOrder[0]!;
    const clipId = session.edits.createMidiClip(trackId, PPQ * 4)!;
    session.edits.addNotes(clipId, [{ startTick: 0, durationTicks: PPQ, pitch: 60, velocity: 90 }]);
    await session.projects.flush();
    expect(session.projectStore.getState().saveStatus).toBe('saved');
    const saved = session.history.present;
    await session.dispose();
    sessions.length = 0;

    const second = createStudioSession({ ...platform, audioBackendFactory: { ...platform.audioBackendFactory } }, DEFAULT_STUDIO_CONFIG);
    sessions.push(second);
    await second.start();
    const reopened = second.history.present;
    expect(reopened.id).toBe(saved.id);
    const clip = reopened.clips[clipId] as MidiClip;
    expect(clip.startTick).toBe(PPQ * 4);
    expect(clip.notes.map((n) => n.pitch)).toEqual([60]);
  });
});

describe('audio import and export', () => {
  it('imports a WAV file onto a new audio track with stored bytes and peaks', async () => {
    const { session, platform } = await startSession();
    const bytes = sineWav(0.5);
    const [clipId] = await session.edits.importAudio([{ name: 'tone.wav', mimeType: 'audio/wav', bytes }], { atTick: PPQ });
    const project = session.history.present;
    const clip = project.clips[clipId as ClipId];
    expect(clip?.kind).toBe('audio');
    if (clip?.kind !== 'audio') return;
    expect(project.tracks[clip.trackId]?.kind).toBe('audio');
    expect(clip.startTick).toBe(PPQ);
    const asset = project.assets[clip.assetId]!;
    expect(asset).toMatchObject({ sampleRate: 48000, channels: 1, frames: 24000, source: 'import' });
    expect((await platform.assetRepository.get(asset.id))?.bytes.byteLength).toBe(bytes.byteLength);
    await new Promise((r) => setTimeout(r, 10));
    const peaks = session.assets.readPeaks(asset.id, 0, asset.frames, 50);
    expect(peaks).not.toBeNull();
    expect(Math.max(...Array.from(peaks!))).toBeGreaterThan(0.45);
  });

  it('reuses an identical asset instead of storing it twice', async () => {
    const { session } = await startSession();
    const bytes = sineWav(0.25);
    await session.edits.importAudio([{ name: 'a.wav', mimeType: 'audio/wav', bytes }]);
    await session.edits.importAudio([{ name: 'b.wav', mimeType: 'audio/wav', bytes }]);
    expect(Object.keys(session.history.present.assets)).toHaveLength(1);
  });

  it('rejects files the platform cannot decode with a clear message', async () => {
    const { session } = await startSession();
    await expect(
      session.edits.importAudio([{ name: 'notes.txt', mimeType: 'text/plain', bytes: new Uint8Array([1, 2]) }]),
    ).rejects.toThrow(/not an audio format/);
  });

  it('exports the arrangement as a WAV through the engine render path', async () => {
    const { session, platform } = await startSession();
    const trackId = session.history.present.trackOrder[0]!;
    const clipId = session.edits.createMidiClip(trackId, 0, PPQ * 4)!;
    session.edits.addNotes(clipId, [{ startTick: 0, durationTicks: PPQ, pitch: 69, velocity: 100 }]);
    const result = await session.exporter.exportWav(session.history.present, { range: 'arrangement', sampleRate: 44100, bitDepth: 16, includeTail: false });
    expect(platform.engine.renders[0]).toMatchObject({ startTick: 0, endTick: PPQ * 4, sampleRate: 44100, tailSeconds: 0 });
    expect(platform.savedFiles[0]?.name).toMatch(/\.wav$/);
    const decoded = decodeWav(result.bytes);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.channels[0]!.length).toBe(Math.round(2 * 44100)); // 4 beats at 120 BPM
  });
});

describe('recording', () => {
  it('commits an audio take as asset + clip at the recording position', async () => {
    const { session, platform } = await startSession();
    const audioTrack = session.edits.addTrack('audio');
    session.history.execute({ type: 'track.update', trackId: audioTrack, patch: { armed: true } });
    await session.transport.seek(PPQ * 4);
    await session.transport.record();
    platform.engine.advance(1);
    await session.transport.stop();
    const clips = Object.values(session.history.present.clips).filter((c) => c.trackId === audioTrack);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ kind: 'audio', startTick: PPQ * 4 });
    expect(session.history.undoLabel).toBe('Record Audio');
  });

  it('stops the transport and explains a denied microphone instead of failing silently', async () => {
    const { session, platform } = await startSession();
    const audioTrack = session.edits.addTrack('audio');
    session.history.execute({ type: 'track.update', trackId: audioTrack, patch: { armed: true } });
    platform.engine.recordingError = { code: 'microphone-denied', message: 'Microphone access was denied' };
    await session.transport.record();
    expect(session.transport.isRecording).toBe(false);
    expect(platform.engine.getTransportPosition().state).toBe('stopped');
    expect(session.engineStore.getState().playState).toBe('stopped');
    expect(session.engineStore.getState().lastError?.message).toMatch(/Allow the microphone/);
    expect(Object.values(session.history.present.clips).filter((c) => c.trackId === audioTrack)).toHaveLength(0);
  });
});

describe('MIDI integration', () => {
  async function connectMpk(session: StudioSession, platform: TestPlatform) {
    await session.midi.requestAccess();
    platform.midiPort.connect({ id: 'in-1', name: 'MPK mini 3', manufacturer: 'AKAI', type: 'input', state: 'connected' });
  }

  it('routes notes to the selected instrument track', async () => {
    const { session, platform } = await startSession();
    await connectMpk(session, platform);
    const trackId = session.uiStore.getState().selection.trackId as TrackId;
    platform.midiPort.input('in-1', [0x90, 60, 100]);
    platform.midiPort.input('in-1', [0x80, 60, 0]);
    const calls = platform.engine.live_calls.filter((c) => c.kind === 'noteOn' || c.kind === 'noteOff');
    expect(calls).toEqual([
      { kind: 'noteOn', trackId, value: 60, velocity: 100 },
      { kind: 'noteOff', trackId, value: 60 },
    ]);
    expect(session.midi.store.getState().devices[0]?.profileId).toBe('akai.mpk-mini-mk3');
  });

  it('applies the default K1 mapping to the selected track volume with pickup', async () => {
    const { session, platform } = await startSession();
    await connectMpk(session, platform);
    const trackId = session.uiStore.getState().selection.trackId as TrackId;
    const current = normalizeParam(TRACK_GAIN_SPEC, 0);
    const pickupValue = Math.round(current * 127);
    platform.midiPort.input('in-1', [0xb0, 70, 10]); // far from current: ignored (pickup)
    expect(session.history.present.tracks[trackId]!.mixer.gainDb).toBe(0);
    platform.midiPort.input('in-1', [0xb0, 70, pickupValue]);
    platform.midiPort.input('in-1', [0xb0, 70, 110]);
    expect(session.history.present.tracks[trackId]!.mixer.gainDb).toBeGreaterThan(1);
    // Consecutive knob moves on one mapping coalesce into a single undo entry.
    expect(session.history.entries().undo.filter((e) => e.coalesceKey?.startsWith('midi:'))).toHaveLength(1);
  });

  it('learns a CC mapping to a parameter and persists it in the project', async () => {
    const { session, platform } = await startSession();
    await connectMpk(session, platform);
    const trackId = session.uiStore.getState().selection.trackId as TrackId;
    session.midi.startLearn({ kind: 'parameter', address: { scope: 'track', trackId, param: 'pan' } });
    platform.midiPort.input('in-1', [0xb0, 20, 64]);
    expect(session.midi.store.getState().learn.phase).toBe('captured');
    const mapping = await session.midi.confirmLearn('project');
    expect(mapping?.source).toMatchObject({ kind: 'cc', controller: 20 });
    expect(session.history.present.midiMappings).toHaveLength(1);
    // Learned absolute knobs use soft takeover: the knob must first meet the current value (pan 0 ≈ 63.5).
    platform.midiPort.input('in-1', [0xb0, 20, 127]);
    expect(session.history.present.tracks[trackId]!.mixer.pan).toBe(0);
    platform.midiPort.input('in-1', [0xb0, 20, 63]);
    platform.midiPort.input('in-1', [0xb0, 20, 127]);
    expect(session.history.present.tracks[trackId]!.mixer.pan).toBeCloseTo(1, 5);
  });

  it('releases held notes when the device disconnects (no stuck notes)', async () => {
    const { session, platform } = await startSession();
    await connectMpk(session, platform);
    platform.midiPort.input('in-1', [0x90, 64, 90]);
    platform.midiPort.disconnect('in-1');
    const offs = platform.engine.live_calls.filter((c) => c.kind === 'noteOff');
    expect(offs.map((c) => c.value)).toEqual([64]);
  });

  it('records MIDI on an armed instrument track and quantizes when configured', async () => {
    const { session, platform } = await startSession();
    await connectMpk(session, platform);
    const trackId = session.history.present.trackOrder[0]!;
    session.history.execute({ type: 'track.update', trackId, patch: { armed: true } });
    await session.midi.updateSettings({ recordQuantize: '1/16' });
    await session.transport.record();
    platform.engine.advance(0.5); // 0.5 s at 120 BPM = 960 ticks
    platform.midiPort.input('in-1', [0x90, 62, 100], performance.now());
    platform.engine.advance(0.25);
    platform.midiPort.input('in-1', [0x80, 62, 0], performance.now());
    platform.engine.advance(0.25);
    await session.transport.stop();
    const clips = Object.values(session.history.present.clips).filter((c) => c.trackId === trackId && c.kind === 'midi');
    expect(clips).toHaveLength(1);
    const clip = clips[0] as MidiClip;
    expect(clip.notes).toHaveLength(1);
    // Latency compensation (30 ms ≈ 58 ticks) then 1/16 quantize → back on the 960 grid line.
    expect(clip.startTick + clip.notes[0]!.startTick).toBe(960);
    expect(clip.notes[0]!.pitch).toBe(62);
  });
});
