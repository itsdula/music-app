import type { AssetPcmSource, AudioEngine, RenderRequest } from '@studio/audio-contracts';
import { rmsOfSamples, type PcmAudio } from '@studio/audio-dsp';
import {
  asAssetId,
  asClipId,
  asEffectId,
  asNoteId,
  asProjectId,
  asTrackId,
  createAudioClip,
  createEffectSlot,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createTrack,
  type AssetId,
  type AssetRef,
  type AudioClip,
  type Clip,
  type EffectKind,
  type EffectSlot,
  type InstrumentKind,
  type MidiClip,
  type MidiNote,
  type Project,
  type Track,
} from '@studio/domain';
import { createWebAudioBackendFactory, type WebAudioEngine } from '../src';

export const SR = 48000;
/** 120 bpm: 1920 ticks per second, 960 ticks per beat (0.5 s). */
export const BPM = 120;
export const TPS = 1920;

export function note(
  id: string,
  startTick: number,
  durationTicks: number,
  pitch = 69,
  velocity = 127,
): MidiNote {
  return { id: asNoteId(id), startTick, durationTicks, pitch, velocity };
}

/** A pure-sine synth (osc2 off, filter wide open, no filter envelope). */
export const SINE_SYNTH: Record<string, number> = {
  osc1Waveform: 0,
  osc2Mix: 0,
  cutoffHz: 18000,
  resonance: 0.7071,
  filterEnvAmount: 0,
  attack: 0.005,
  decay: 0.05,
  sustain: 1,
  release: 0.05,
  polyphony: 8,
  glideMs: 0,
  gainDb: 0,
};

export function instrumentTrack(
  id: string,
  kind: InstrumentKind = 'synth',
  params: Record<string, number> = {},
  patch: Partial<Track> = {},
): Track {
  const base = createInstrumentConfig(kind);
  return {
    ...createTrack({ id: asTrackId(id), kind: 'instrument' }),
    instrument: { ...base, params: { ...base.params, ...params } },
    ...patch,
  };
}

export function audioTrack(id: string, patch: Partial<Track> = {}): Track {
  return { ...createTrack({ id: asTrackId(id), kind: 'audio' }), ...patch };
}

export function effect(
  id: string,
  kind: EffectKind,
  params: Record<string, number> = {},
  bypass = false,
): EffectSlot {
  const slot = createEffectSlot(asEffectId(id), kind);
  return { ...slot, bypass, params: { ...slot.params, ...params } };
}

export function midiClip(
  id: string,
  trackId: string,
  startTick: number,
  notes: MidiNote[],
  patch: Partial<MidiClip> = {},
): MidiClip {
  return {
    ...createMidiClip({
      id: asClipId(id),
      trackId: asTrackId(trackId),
      startTick,
      notes,
      lengthTicks: 3840 * 16,
    }),
    ...patch,
  };
}

export function audioClip(
  id: string,
  trackId: string,
  assetId: string,
  startTick: number,
  lengthFrames: number,
  patch: Partial<AudioClip> = {},
): AudioClip {
  return {
    ...createAudioClip({
      id: asClipId(id),
      trackId: asTrackId(trackId),
      assetId: asAssetId(assetId),
      startTick,
      lengthFrames,
    }),
    ...patch,
  };
}

export function assetRef(id: string, pcm: PcmAudio): AssetRef {
  return {
    id: asAssetId(id),
    name: id,
    kind: 'audio',
    mimeType: 'audio/wav',
    sampleRate: pcm.sampleRate,
    channels: pcm.channels.length,
    frames: pcm.channels[0]!.length,
    contentHash: id,
    byteLength: 0,
    source: 'import',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

export function makeProject(
  tracks: Track[],
  clips: Clip[] = [],
  assets: AssetRef[] = [],
  patch: Partial<Project> = {},
): Project {
  const base = createEmptyProject({
    id: asProjectId('prj_test'),
    now: '2026-01-01T00:00:00.000Z',
    bpm: BPM,
  });
  return {
    ...base,
    trackOrder: tracks.map((t) => t.id),
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    clips: Object.fromEntries(clips.map((c) => [c.id, c])),
    assets: Object.fromEntries(assets.map((a) => [a.id, a])),
    ...patch,
  };
}

export class MemoryAssets implements AssetPcmSource {
  readonly map = new Map<AssetId, PcmAudio>();
  loads = 0;
  constructor(entries: [string, PcmAudio][] = []) {
    for (const [id, pcm] of entries) this.map.set(asAssetId(id), pcm);
  }
  load(assetId: AssetId): Promise<PcmAudio> {
    this.loads++;
    const pcm = this.map.get(assetId);
    return pcm ? Promise.resolve(pcm) : Promise.reject(new Error(`no such asset ${assetId}`));
  }
}

export function createEngine(assets: AssetPcmSource = new MemoryAssets()): WebAudioEngine {
  return createWebAudioBackendFactory().create({ assets }) as WebAudioEngine;
}

export async function renderProject(
  project: Project,
  request: Partial<RenderRequest> = {},
  assets: AssetPcmSource = new MemoryAssets(),
  prepare?: (engine: AudioEngine) => Promise<void>,
): Promise<{ pcm: PcmAudio; tailSeconds: number; peak: number }> {
  const engine = createEngine(assets);
  await engine.loadProject({ project });
  if (prepare) await prepare(engine);
  const result = await engine.render({
    startTick: 0,
    endTick: 3840,
    sampleRate: SR,
    channelCount: 2,
    tailSeconds: 0,
    includeMetronome: false,
    ...request,
  });
  await engine.dispose();
  return result;
}

export function sine(
  frequency: number,
  seconds: number,
  amplitude = 0.5,
  sampleRate = SR,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++)
    out[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  return out;
}

export function noise(seconds: number, amplitude = 0.3, seed = 1, sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = amplitude * ((s / 4294967296) * 2 - 1);
  }
  return out;
}

export function rmsBetween(
  samples: Float32Array,
  fromSeconds: number,
  toSeconds: number,
  sampleRate = SR,
): number {
  return rmsOfSamples(
    samples,
    Math.floor(fromSeconds * sampleRate),
    Math.floor(toSeconds * sampleRate),
  );
}

export function slice(
  samples: Float32Array,
  fromSeconds: number,
  toSeconds: number,
  sampleRate = SR,
): Float32Array {
  return samples.subarray(Math.floor(fromSeconds * sampleRate), Math.floor(toSeconds * sampleRate));
}

export function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++)
    max = Math.max(max, Math.abs(a[i]! - b[i]!));
  return max;
}

/** Relative RMS difference ‖a − b‖ / ‖b‖. */
export function relativeDifference(a: Float32Array, b: Float32Array): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    num += (a[i]! - b[i]!) ** 2;
    den += b[i]! ** 2;
  }
  return Math.sqrt(num / Math.max(den, 1e-30));
}

export function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
