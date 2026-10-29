import {
  EFFECT_PARAM_SPECS,
  MASTER_GAIN_SPEC,
  clampParam,
  type EffectId,
  type EffectSlot,
  type Project,
} from '@studio/domain';
import type { CommandOf, EffectTarget } from '../types';
import {
  clampIndex,
  fail,
  insertAt,
  mergeChanged,
  moveItem,
  replaceAt,
  requireFinite,
} from '../util';
import { clampParamPatch, normalizeEffect } from '../validate';
import { requireTrack, withTrack } from './tracks';

function getChain(project: Project, target: EffectTarget): readonly EffectSlot[] {
  return target === 'master' ? project.master.effects : requireTrack(project, target).effects;
}

function withChain(
  project: Project,
  target: EffectTarget,
  effects: readonly EffectSlot[],
): Project {
  if (target === 'master') {
    return effects === project.master.effects
      ? project
      : { ...project, master: { ...project.master, effects } };
  }
  const track = requireTrack(project, target);
  return effects === track.effects ? project : withTrack(project, { ...track, effects });
}

function findEffect(chain: readonly EffectSlot[], effectId: EffectId, target: EffectTarget) {
  const index = chain.findIndex((e) => e.id === effectId);
  if (index < 0) fail('not-found', `effect ${effectId} not found on ${target}`);
  return { index, effect: chain[index]! };
}

export function addEffect(project: Project, command: CommandOf<'effect.add'>): Project {
  const chain = getChain(project, command.target);
  const effect = normalizeEffect(command.effect);
  if (chain.some((e) => e.id === effect.id)) {
    fail('invalid-argument', `effect ${effect.id} already exists on ${command.target}`);
  }
  const index = clampIndex(command.index, chain.length, 'effect index');
  return withChain(project, command.target, insertAt(chain, index, effect));
}

export function removeEffect(project: Project, command: CommandOf<'effect.remove'>): Project {
  const chain = getChain(project, command.target);
  const { index } = findEffect(chain, command.effectId, command.target);
  return withChain(
    project,
    command.target,
    chain.filter((_, i) => i !== index),
  );
}

/** Reorders an effect within its chain; `toIndex` is clamped into bounds. */
export function moveEffect(project: Project, command: CommandOf<'effect.move'>): Project {
  const chain = getChain(project, command.target);
  const { index } = findEffect(chain, command.effectId, command.target);
  const to = clampIndex(command.toIndex, chain.length - 1, 'effect index');
  return withChain(project, command.target, moveItem(chain, index, to));
}

export function setEffectParams(project: Project, command: CommandOf<'effect.setParams'>): Project {
  const chain = getChain(project, command.target);
  const { index, effect } = findEffect(chain, command.effectId, command.target);
  const patch = clampParamPatch(EFFECT_PARAM_SPECS[effect.kind], command.params, 'effect');
  const params = mergeChanged(effect.params, patch);
  if (params === effect.params) return project;
  return withChain(project, command.target, replaceAt(chain, index, { ...effect, params }));
}

export function setEffectBypass(project: Project, command: CommandOf<'effect.setBypass'>): Project {
  const chain = getChain(project, command.target);
  const { index, effect } = findEffect(chain, command.effectId, command.target);
  const next = mergeChanged(effect, { bypass: command.bypass === true });
  return withChain(project, command.target, replaceAt(chain, index, next));
}

export function setMasterGain(project: Project, command: CommandOf<'master.setGain'>): Project {
  const gainDb = clampParam(MASTER_GAIN_SPEC, requireFinite(command.gainDb, 'master gainDb'));
  const master = mergeChanged(project.master, { gainDb });
  return master === project.master ? project : { ...project, master };
}
