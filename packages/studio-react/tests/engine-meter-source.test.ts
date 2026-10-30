import type { MeterSnapshot } from '@studio/audio-contracts';
import type { MeterFrame } from '@studio/audio-ui';
import type { TrackId } from '@studio/domain';
import { describe, expect, it, vi } from 'vitest';
import { EngineMeterHub } from '../src/lib/engine-meter-source';
import type { StudioSession } from '../src/session/studio-session';

function fakeSession(snapshots: MeterSnapshot[]) {
  let frame: (() => void) | null = null;
  const readMeters = vi.fn(() => snapshots.shift() ?? { master: silent, tracks: {} });
  const session = {
    renderLoop: { add: (cb: () => void) => ((frame = cb), () => undefined) },
    engine: { readMeters },
  } as unknown as StudioSession;
  return { session, readMeters, tick: () => frame?.() };
}

const T1 = 't1' as TrackId;
const silent = { peak: [0, 0], rms: [0, 0], clipped: false };
const loud = { peak: [1, 0.5], rms: [0.2, 0.1], clipped: true };

describe('EngineMeterHub', () => {
  it('reads the engine once per frame and gives every meter of a target the same frame', () => {
    const { session, readMeters, tick } = fakeSession([{ master: loud, tracks: { [T1]: loud } }]);
    const hub = new EngineMeterHub(session);
    const header: MeterFrame[] = [];
    const strip: MeterFrame[] = [];
    const source = hub.source(T1);
    expect(hub.source(T1)).toBe(source);
    source.subscribe(() => header.push(source.getSnapshot()));
    source.subscribe(() => strip.push(source.getSnapshot()));
    tick();
    expect(readMeters).toHaveBeenCalledTimes(1);
    expect(header).toHaveLength(1);
    expect(strip).toEqual(header);
    expect(header[0]!.levels[0]).toBeCloseTo(0, 6);
  });

  it('skips silent frames while the meter is at rest', () => {
    const { session, tick } = fakeSession([
      { master: silent, tracks: {} },
      { master: silent, tracks: {} },
      { master: loud, tracks: {} },
    ]);
    const hub = new EngineMeterHub(session);
    const frames: MeterFrame[] = [];
    const source = hub.source('master');
    source.subscribe(() => frames.push(source.getSnapshot()));
    tick();
    tick();
    tick();
    expect(frames.map((f) => f.levels[0])).toEqual([0]);
  });
});
