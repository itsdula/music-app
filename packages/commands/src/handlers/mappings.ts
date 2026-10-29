import type { MappingId, MidiMapping, Project } from '@studio/domain';
import type { CommandOf } from '../types';
import { fail, keepIfEqual, mergeChanged, replaceAt } from '../util';
import { normalizeMapping } from '../validate';

function findMapping(project: Project, mappingId: MappingId): number {
  const index = project.midiMappings.findIndex((m) => m.id === mappingId);
  if (index < 0) fail('not-found', `mapping ${mappingId} not found`);
  return index;
}

export function addMapping(project: Project, command: CommandOf<'mapping.add'>): Project {
  const mapping = normalizeMapping(project, command.mapping);
  if (project.midiMappings.some((m) => m.id === mapping.id)) {
    fail('invalid-argument', `mapping ${mapping.id} already exists`);
  }
  return { ...project, midiMappings: [...project.midiMappings, mapping] };
}

export function updateMapping(project: Project, command: CommandOf<'mapping.update'>): Project {
  const index = findMapping(project, command.mappingId);
  const current = project.midiMappings[index]!;
  // The patch type excludes `id` and `scope`; reject them if they arrive at runtime anyway.
  const raw = command.patch as Partial<MidiMapping>;
  if (raw.scope !== undefined && raw.scope !== 'project') {
    fail('invalid-argument', 'project mappings must keep scope "project"');
  }
  if (raw.id !== undefined && raw.id !== current.id) {
    fail('invalid-argument', 'mapping ids cannot be changed');
  }
  const merged = mergeChanged<MidiMapping>(current, command.patch);
  if (merged === current) return project;
  const next = keepIfEqual(current, normalizeMapping(project, merged));
  const midiMappings = replaceAt(project.midiMappings, index, next);
  return midiMappings === project.midiMappings ? project : { ...project, midiMappings };
}

export function removeMappings(project: Project, command: CommandOf<'mapping.remove'>): Project {
  if (command.mappingIds.length === 0) return project;
  for (const id of command.mappingIds) findMapping(project, id);
  const ids = new Set<string>(command.mappingIds);
  return { ...project, midiMappings: project.midiMappings.filter((m) => !ids.has(m.id)) };
}
