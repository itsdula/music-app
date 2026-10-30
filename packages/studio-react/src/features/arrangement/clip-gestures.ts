/**
 * Pure arrangement gesture math → commands. Like note edits, each function computes the
 * full command list from the gesture start state so drags use `applyFromStart`.
 */
import type { Command } from '@studio/commands';
import {
  clipEndTick,
  snapTick,
  type Clip,
  type ClipId,
  type IdFactory,
  type Project,
  type Track,
  type TrackId,
} from '@studio/domain';
import { setClipLoopCommand } from '../../lib/clip-commands';

export function trackAccepts(track: Track, clip: Clip): boolean {
  return clip.kind === 'midi' ? track.kind === 'instrument' : track.kind !== 'instrument';
}

export interface MoveGestureInput {
  readonly project: Project;
  readonly clipIds: readonly ClipId[];
  readonly anchorClipId: ClipId;
  readonly rawDeltaTicks: number;
  readonly deltaRows: number;
  readonly trackOrder: readonly TrackId[];
  readonly gridTicks: number;
}

/** Moves clips by a snapped time delta and a row delta (falling back to the original track when incompatible). */
export function moveClipsCommands(input: MoveGestureInput): Command[] {
  const { project, clipIds, anchorClipId, rawDeltaTicks, deltaRows, trackOrder, gridTicks } = input;
  const clips = clipIds.map((id) => project.clips[id]).filter((c): c is Clip => Boolean(c));
  const anchor = project.clips[anchorClipId] ?? clips[0];
  if (!anchor || clips.length === 0) return [];
  let delta =
    gridTicks > 0
      ? snapTick(anchor.startTick + rawDeltaTicks, gridTicks) - anchor.startTick
      : Math.round(rawDeltaTicks);
  const minStart = Math.min(...clips.map((c) => c.startTick));
  if (minStart + delta < 0) delta = -minStart;
  const moves = clips.map((clip) => {
    const fromRow = trackOrder.indexOf(clip.trackId);
    const toRow = Math.min(trackOrder.length - 1, Math.max(0, fromRow + deltaRows));
    const targetId = trackOrder[toRow];
    const target = targetId ? project.tracks[targetId] : undefined;
    const trackId = target && trackAccepts(target, clip) ? target.id : clip.trackId;
    return {
      clipId: clip.id,
      startTick: clip.startTick + delta,
      ...(trackId !== clip.trackId ? { trackId } : {}),
    };
  });
  if (moves.every((m, i) => m.startTick === clips[i]!.startTick && !('trackId' in m))) return [];
  return [{ type: 'clip.move', moves }];
}

/** Alt-drag: copies of the clips placed at the moved positions (originals untouched). */
export function duplicateMoveCommands(
  input: MoveGestureInput,
  ids: IdFactory,
  newIds: Map<ClipId, ClipId>,
): Command[] {
  const moves = moveClipsCommands(input);
  const move = moves[0];
  if (!move || move.type !== 'clip.move') return [];
  const copies: Clip[] = [];
  for (const m of move.moves) {
    const original = input.project.clips[m.clipId];
    if (!original) continue;
    let id = newIds.get(m.clipId);
    if (!id) {
      id = ids.create('clip');
      newIds.set(m.clipId, id);
    }
    copies.push({
      ...original,
      id,
      startTick: m.startTick,
      trackId: m.trackId ?? original.trackId,
    });
  }
  return copies.length > 0 ? [{ type: 'clip.add', clips: copies }] : [];
}

export function trimStartCommand(
  project: Project,
  clipId: ClipId,
  rawTick: number,
  gridTicks: number,
): Command[] {
  const clip = project.clips[clipId];
  if (!clip) return [];
  const end = clipEndTick(clip, project);
  let tick = gridTicks > 0 ? snapTick(rawTick, gridTicks) : Math.round(rawTick);
  tick = Math.max(0, Math.min(tick, Math.ceil(end) - 1));
  if (tick === clip.startTick) return [];
  return [{ type: 'clip.trimStart', clipId, startTick: tick }];
}

export function trimEndCommand(
  project: Project,
  clipId: ClipId,
  rawTick: number,
  gridTicks: number,
): Command[] {
  const clip = project.clips[clipId];
  if (!clip) return [];
  let tick = gridTicks > 0 ? snapTick(rawTick, gridTicks) : Math.round(rawTick);
  tick = Math.max(clip.startTick + 1, tick);
  if (Math.abs(tick - clipEndTick(clip, project)) < 0.5) return [];
  return [{ type: 'clip.trimEnd', clipId, endTick: tick }];
}

/**
 * Loop-handle drag: moves the clip end like a trim, but extending past the current end first
 * turns looping on so the content repeats (instead of being clamped to the source length).
 */
export function loopExtendCommands(
  project: Project,
  clipId: ClipId,
  rawTick: number,
  gridTicks: number,
): Command[] {
  const clip = project.clips[clipId];
  if (!clip) return [];
  let tick = gridTicks > 0 ? snapTick(rawTick, gridTicks) : Math.round(rawTick);
  tick = Math.max(clip.startTick + 1, tick);
  const end = clipEndTick(clip, project);
  if (Math.abs(tick - end) < 0.5) return [];
  const commands: Command[] = [];
  if (tick > end) {
    const loop = setClipLoopCommand(clip, true);
    if (loop) commands.push(loop);
  }
  commands.push({ type: 'clip.trimEnd', clipId, endTick: tick });
  return commands;
}

/** Loop-region drag in the ruler. */
export function loopCommand(startTick: number, endTick: number, gridTicks: number): Command[] {
  const a =
    gridTicks > 0
      ? snapTick(Math.min(startTick, endTick), gridTicks, 'floor')
      : Math.round(Math.min(startTick, endTick));
  let b =
    gridTicks > 0
      ? snapTick(Math.max(startTick, endTick), gridTicks, 'ceil')
      : Math.round(Math.max(startTick, endTick));
  if (b <= a) b = a + Math.max(1, gridTicks);
  return [
    { type: 'project.setLoop', loop: { enabled: true, startTick: Math.max(0, a), endTick: b } },
  ];
}
