/**
 * Project → engine change-list diffing.
 */
import type {
  LoopRegion,
  MetronomeSettings,
  Project,
  TimeSignature,
  TrackId,
} from '@studio/domain';
import { type AudioGraphChange } from './changes';

/**
 * Computes the engine changes that turn `prev` into `next`.
 *
 * Comparison rules:
 * - Entities (tracks, clips, master bus, assets) are compared by reference identity —
 *   commands produce new objects for anything they change (structural sharing), so an
 *   unchanged reference means unchanged content. A new reference with equal content
 *   still yields an update (harmless for engines; deep equality is deliberately avoided).
 * - Small value settings (bpm, meter, loop, metronome) are compared by value, so a
 *   re-created but equal settings object produces no change.
 * - Asset metadata replaced under the same id produces no change (assets are
 *   content-addressed and immutable); vocal edits, MIDI mappings and names have no
 *   audio-graph effect and are ignored.
 *
 * Output order (deterministic): tempo, meter, loop, metronome, track.remove (previous
 * track order, then remaining ids sorted), track.add (next track order, then remaining
 * ids sorted), track.update (same order as add), track.order (only when the order
 * arrays differ element-wise), clip.remove, clip.add, clip.update (each sorted by clip
 * id), master.update, asset.add, asset.remove (each sorted by asset id).
 * Identical roots return [] immediately.
 *
 * - Ownership: returned changes reference (never copy) entities of `prev`/`next`.
 * - Determinism: depends only on the inputs; never on object key insertion order.
 * - Complexity: O(T + C log C + A log A) for T tracks, C clips, A assets.
 */
export function diffProjects(prev: Project, next: Project): AudioGraphChange[] {
  if (prev === next) return [];
  const changes: AudioGraphChange[] = [];

  if (prev.bpm !== next.bpm) changes.push({ type: 'tempo', bpm: next.bpm });
  if (!meterEquals(prev.meter, next.meter)) changes.push({ type: 'meter', meter: next.meter });
  if (!loopEquals(prev.loop, next.loop)) changes.push({ type: 'loop', loop: next.loop });
  if (!metronomeEquals(prev.metronome, next.metronome)) {
    changes.push({ type: 'metronome', metronome: next.metronome });
  }

  if (prev.tracks !== next.tracks || prev.trackOrder !== next.trackOrder) {
    for (const id of orderedIds(prev.trackOrder, prev.tracks)) {
      if (!(id in next.tracks)) changes.push({ type: 'track.remove', trackId: id });
    }
    const nextIds = orderedIds(next.trackOrder, next.tracks);
    for (const id of nextIds) {
      if (!(id in prev.tracks)) changes.push({ type: 'track.add', track: next.tracks[id]! });
    }
    for (const id of nextIds) {
      const before = prev.tracks[id];
      const after = next.tracks[id]!;
      if (before && before !== after) {
        changes.push({ type: 'track.update', track: after, previous: before });
      }
    }
    if (!arraysEqual(prev.trackOrder, next.trackOrder)) {
      changes.push({ type: 'track.order', trackOrder: next.trackOrder });
    }
  }

  if (prev.clips !== next.clips) {
    const prevIds = sortedKeys(prev.clips);
    const nextIds = sortedKeys(next.clips);
    for (const id of prevIds) {
      if (!(id in next.clips)) {
        changes.push({ type: 'clip.remove', clipId: id, trackId: prev.clips[id]!.trackId });
      }
    }
    for (const id of nextIds) {
      if (!(id in prev.clips)) changes.push({ type: 'clip.add', clip: next.clips[id]! });
    }
    for (const id of nextIds) {
      const before = prev.clips[id];
      const after = next.clips[id]!;
      if (before && before !== after) {
        changes.push({ type: 'clip.update', clip: after, previous: before });
      }
    }
  }

  if (prev.master !== next.master) {
    changes.push({ type: 'master.update', master: next.master, previous: prev.master });
  }

  if (prev.assets !== next.assets) {
    for (const id of sortedKeys(next.assets)) {
      if (!(id in prev.assets)) changes.push({ type: 'asset.add', asset: next.assets[id]! });
    }
    for (const id of sortedKeys(prev.assets)) {
      if (!(id in next.assets)) changes.push({ type: 'asset.remove', assetId: id });
    }
  }
  return changes;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortedKeys<K extends string>(record: Readonly<Record<K, unknown>>): K[] {
  return (Object.keys(record) as K[]).sort(compareIds);
}

/** Ids in `order` that exist in `record`, followed by the remaining ids sorted. */
function orderedIds(
  order: readonly TrackId[],
  record: Readonly<Record<TrackId, unknown>>,
): TrackId[] {
  const seen = new Set<TrackId>();
  const result: TrackId[] = [];
  for (const id of order) {
    if (id in record && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of sortedKeys(record)) if (!seen.has(id)) result.push(id);
  return result;
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function meterEquals(a: TimeSignature, b: TimeSignature): boolean {
  return a === b || (a.numerator === b.numerator && a.denominator === b.denominator);
}

function loopEquals(a: LoopRegion, b: LoopRegion): boolean {
  return (
    a === b || (a.enabled === b.enabled && a.startTick === b.startTick && a.endTick === b.endTick)
  );
}

function metronomeEquals(a: MetronomeSettings, b: MetronomeSettings): boolean {
  return (
    a === b || (a.enabled === b.enabled && a.gainDb === b.gainDb && a.countInBars === b.countInBars)
  );
}
