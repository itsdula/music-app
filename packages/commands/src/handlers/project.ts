import { clampBpm, isValidTimeSignature, type LoopRegion, type Project } from '@studio/domain';
import type { CommandOf } from '../types';
import { clampFinite, clampInt, fail, mergeChanged, requireFinite, requireInt } from '../util';
import { requireName } from '../validate';

export function rename(project: Project, command: CommandOf<'project.rename'>): Project {
  return mergeChanged(project, { name: requireName(command.name, 'project name') });
}

/** Clamps to [MIN_BPM, MAX_BPM] and rounds to 0.01 BPM. */
export function setTempo(project: Project, command: CommandOf<'project.setTempo'>): Project {
  const bpm = Math.round(clampBpm(requireFinite(command.bpm, 'bpm')) * 100) / 100;
  return mergeChanged(project, { bpm });
}

export function setMeter(project: Project, command: CommandOf<'project.setMeter'>): Project {
  const { numerator, denominator } = command.meter;
  if (!isValidTimeSignature({ numerator, denominator })) {
    fail('invalid-argument', `invalid time signature ${numerator}/${denominator}`);
  }
  return mergeChanged(project, { meter: { numerator, denominator } });
}

/** Merges a partial loop; the merged region needs integer 0 <= start < end. */
export function setLoop(project: Project, command: CommandOf<'project.setLoop'>): Project {
  const { enabled, startTick, endTick } = command.loop;
  const patch: { -readonly [K in keyof LoopRegion]?: LoopRegion[K] } = {};
  if (enabled !== undefined) patch.enabled = enabled === true;
  if (startTick !== undefined) patch.startTick = requireInt(startTick, 'loop startTick', 0);
  if (endTick !== undefined) patch.endTick = requireInt(endTick, 'loop endTick', 0);
  const loop = mergeChanged(project.loop, patch);
  if (loop.endTick <= loop.startTick) {
    fail('invalid-argument', 'loop end must be after loop start');
  }
  return loop === project.loop ? project : { ...project, loop };
}

/** Merges metronome settings: gainDb clamped to [-60, 6], countInBars integer clamped to 0..4. */
export function setMetronome(
  project: Project,
  command: CommandOf<'project.setMetronome'>,
): Project {
  const { enabled, gainDb, countInBars } = command.metronome;
  const metronome = mergeChanged(project.metronome, {
    ...(enabled !== undefined ? { enabled: enabled === true } : {}),
    ...(gainDb !== undefined ? { gainDb: clampFinite(gainDb, -60, 6, 'metronome gainDb') } : {}),
    ...(countInBars !== undefined
      ? { countInBars: clampInt(countInBars, 0, 4, 'countInBars') }
      : {}),
  });
  return metronome === project.metronome ? project : { ...project, metronome };
}
