/**
 * Performance baselines for non-audio hot paths on a representative project
 * (16 tracks, 100 clips, ~4,000 notes). Budgets are deliberately generous (≈10× the
 * measured baseline on a 4-vCPU container) so CI catches regressions, not noise.
 * Measured values are printed and recorded in docs/benchmarks.md.
 */
import { buildPeakPyramid, readPeaks } from '@studio/audio-dsp';
import { applyCommand } from '@studio/commands';
import {
  asAssetId,
  asClipId,
  asNoteId,
  asProjectId,
  asTrackId,
  createAudioClip,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createTrack,
  PPQ,
  type AssetRef,
  type Clip,
  type Project,
  type Track,
} from '@studio/domain';
import { diffProjects } from '@studio/engine-core';
import { parseProject, serializeProject } from '@studio/project-storage';
import { describe, expect, it } from 'vitest';
import { TimeAxis } from '../src/canvas/time-axis';
import { clipBoxes, layoutRows } from '../src/features/arrangement/geometry';

function representativeProject(): Project {
  const base = createEmptyProject({ id: asProjectId('bench'), now: '2026-10-29T00:00:00.000Z' });
  const tracks: Track[] = [];
  const clips: Clip[] = [];
  const assets: Record<string, AssetRef> = {};
  for (let t = 0; t < 16; t++) {
    const id = asTrackId(`t${t}`);
    const kind = t < 10 ? 'instrument' : 'audio';
    tracks.push(createTrack({ id, kind, index: t, ...(kind === 'instrument' ? { instrument: createInstrumentConfig('synth', 'synth.keys') } : {}) }));
  }
  let n = 0;
  for (let c = 0; c < 100; c++) {
    const track = tracks[c % 16]!;
    const start = Math.floor(c / 16) * PPQ * 16;
    if (track.kind === 'instrument') {
      const notes = Array.from({ length: 64 }, (_, i) => ({
        id: asNoteId(`n${n++}`),
        startTick: i * (PPQ / 4),
        durationTicks: PPQ / 4,
        pitch: 48 + ((i * 7) % 24),
        velocity: 90,
      }));
      clips.push(createMidiClip({ id: asClipId(`c${c}`), trackId: track.id, startTick: start, lengthTicks: PPQ * 16, notes }));
    } else {
      const assetId = asAssetId(`a${c}`);
      assets[assetId] = { id: assetId, name: `take ${c}`, kind: 'audio', mimeType: 'audio/wav', sampleRate: 48000, channels: 2, frames: 48000 * 8, contentHash: 'f'.repeat(64), byteLength: 48000 * 8 * 8, source: 'recording', createdAt: base.createdAt };
      clips.push(createAudioClip({ id: asClipId(`c${c}`), trackId: track.id, assetId, startTick: start, lengthFrames: 48000 * 8 }));
    }
  }
  return {
    ...base,
    trackOrder: tracks.map((t) => t.id),
    tracks: Object.fromEntries(tracks.map((t) => [t.id, t])),
    clips: Object.fromEntries(clips.map((c) => [c.id, c])),
    assets,
  };
}

function time(label: string, iterations: number, fn: () => void): number {
  for (let i = 0; i < Math.min(5, iterations); i++) fn(); // warm-up
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const perOp = (performance.now() - t0) / iterations;
  console.log(`[bench] ${label}: ${perOp.toFixed(3)} ms/op`);
  return perOp;
}

describe('performance baselines (16 tracks / 100 clips)', () => {
  const project = representativeProject();

  it('diffs a single-clip edit quickly', () => {
    const moved = applyCommand(project, { type: 'clip.move', moves: [{ clipId: asClipId('c5'), startTick: PPQ * 128 }] });
    let changes = 0;
    const ms = time('diffProjects (one clip moved)', 2000, () => {
      changes = diffProjects(project, moved).length;
    });
    expect(changes).toBe(1);
    expect(ms).toBeLessThan(2);
  });

  it('applies a note move command quickly', () => {
    const ms = time('applyCommand notes.update (64-note clip)', 2000, () => {
      applyCommand(project, { type: 'notes.update', clipId: asClipId('c0'), patches: [{ id: asNoteId('n0'), startTick: 10 }] });
    });
    expect(ms).toBeLessThan(2);
  });

  it('serializes and validates the project for autosave/load', () => {
    let size = 0;
    const ser = time('serializeProject', 50, () => {
      size = serializeProject(project).length;
    });
    const json = JSON.parse(serializeProject(project)) as unknown;
    const parse = time('parseProject (migrate + zod + invariants)', 20, () => {
      expect(parseProject(json).ok).toBe(true);
    });
    console.log(`[bench] project JSON size: ${(size / 1024).toFixed(1)} KiB`);
    expect(ser).toBeLessThan(100);
    expect(parse).toBeLessThan(400);
  });

  it('lays out arrangement clips for a viewport', () => {
    const rows = layoutRows(project.trackOrder.map((id) => project.tracks[id]!), 64, 0);
    const axis = new TimeAxis(0.05, 0);
    let count = 0;
    const ms = time('clipBoxes (visible clips for 1600×1000 viewport)', 2000, () => {
      count = clipBoxes(project, rows, axis, 1600, 1000).length;
    });
    expect(count).toBeGreaterThan(10);
    expect(ms).toBeLessThan(2);
  });

  it('builds a peak pyramid for 3 minutes of stereo audio and reads zoom levels', () => {
    const frames = 48000 * 180;
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i++) channel[i] = Math.sin(i * 0.01) * 0.5;
    const pcm = { sampleRate: 48000, channels: [channel, channel.slice()] };
    let pyramid = buildPeakPyramid(pcm);
    const build = time('buildPeakPyramid (3 min stereo 48 kHz)', 3, () => {
      pyramid = buildPeakPyramid(pcm);
    });
    const read = time('readPeaks (1,600 columns, full file)', 500, () => {
      readPeaks(pyramid, 0, frames, 1600);
    });
    const readZoomed = time('readPeaks (1,600 columns, 1 s window)', 500, () => {
      readPeaks(pyramid, 48000 * 60, 48000 * 61, 1600);
    });
    expect(build).toBeLessThan(3000);
    expect(read).toBeLessThan(10);
    expect(readZoomed).toBeLessThan(10);
  });
});
