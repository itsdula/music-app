/**
 * Pure helpers for presenting and editing MIDI mappings.
 */
import {
  INSTRUMENT_PARAM_SPECS,
  type MappingTarget,
  type MidiControlSource,
  type MidiDeviceSelector,
  type MidiMapping,
  type ParameterAddress,
  type Project,
  type StudioActionId,
  type TrackId,
} from '@studio/domain';
import type { DeviceControl } from '@studio/midi-core';
import { describeAddress } from '../../session/parameters';

export function describeSource(source: MidiControlSource): string {
  const ch = (c: number | 'any') => (c === 'any' ? 'any ch' : `ch ${c}`);
  switch (source.kind) {
    case 'cc':
      return `CC ${source.controller} · ${ch(source.channel)}${source.mode === 'absolute' ? '' : ` · relative (${source.mode})`}`;
    case 'note':
      return `Note ${source.note} · ${ch(source.channel)} · ${source.behavior}`;
    case 'pitchBend':
      return `Pitch bend · ${ch(source.channel)}`;
    case 'programChange':
      return `Program change${source.program !== undefined ? ` ${source.program}` : ''} · ${ch(source.channel)}`;
  }
}

export function describeDevice(
  device: MidiDeviceSelector | null,
  profileNames: Readonly<Record<string, string>>,
): string {
  if (!device) return 'Any device';
  if (device.profileId) return profileNames[device.profileId] ?? device.profileId;
  return device.portName ?? 'Any device';
}

const ACTION_LABELS: Record<StudioActionId, string> = {
  'transport.play': 'Play',
  'transport.stop': 'Stop',
  'transport.togglePlay': 'Play / Stop',
  'transport.record': 'Record',
  'transport.toggleLoop': 'Loop on/off',
  'transport.toggleMetronome': 'Metronome on/off',
  'transport.rewind': 'Return to start',
  'transport.tapTempo': 'Tap tempo',
  'edit.undo': 'Undo',
  'edit.redo': 'Redo',
  'track.selectNext': 'Select next track',
  'track.selectPrevious': 'Select previous track',
  'track.toggleArmSelected': 'Arm selected track',
  'track.toggleMuteSelected': 'Mute selected track',
  'track.toggleSoloSelected': 'Solo selected track',
};

export function describeTarget(
  project: Project,
  target: MappingTarget,
  selectedTrackId: TrackId | null,
): string {
  return target.kind === 'action'
    ? ACTION_LABELS[target.action]
    : describeAddress(project, target.address, selectedTrackId);
}

export interface TargetOption {
  readonly key: string;
  readonly label: string;
  readonly group: string;
  readonly target: MappingTarget;
}

const param = (address: ParameterAddress): MappingTarget => ({ kind: 'parameter', address });

/** Mapping targets offered in the inspector (selection-following targets first). */
export function targetOptions(project: Project): TargetOption[] {
  const options: TargetOption[] = [
    {
      key: 'sel:gain',
      group: 'Selected track',
      label: 'Volume',
      target: param({ scope: 'selectedTrack', param: 'gainDb' }),
    },
    {
      key: 'sel:pan',
      group: 'Selected track',
      label: 'Pan',
      target: param({ scope: 'selectedTrack', param: 'pan' }),
    },
    {
      key: 'sel:mute',
      group: 'Selected track',
      label: 'Mute',
      target: param({ scope: 'selectedTrack', param: 'mute' }),
    },
    {
      key: 'sel:solo',
      group: 'Selected track',
      label: 'Solo',
      target: param({ scope: 'selectedTrack', param: 'solo' }),
    },
    {
      key: 'sel:arm',
      group: 'Selected track',
      label: 'Arm',
      target: param({ scope: 'selectedTrack', param: 'arm' }),
    },
  ];
  for (const spec of INSTRUMENT_PARAM_SPECS.synth) {
    options.push({
      key: `inst:${spec.id}`,
      group: 'Selected instrument',
      label: spec.label,
      target: param({ scope: 'selectedInstrument', param: spec.id }),
    });
  }
  options.push({
    key: 'master:gain',
    group: 'Master',
    label: 'Master volume',
    target: param({ scope: 'master', param: 'gainDb' }),
  });
  options.push({
    key: 'transport:bpm',
    group: 'Transport',
    label: 'Tempo',
    target: param({ scope: 'transport', param: 'bpm' }),
  });
  for (const id of project.trackOrder) {
    const track = project.tracks[id];
    if (!track) continue;
    options.push({
      key: `track:${id}:gain`,
      group: `Track · ${track.name}`,
      label: `${track.name} volume`,
      target: param({ scope: 'track', trackId: id, param: 'gainDb' }),
    });
    options.push({
      key: `track:${id}:pan`,
      group: `Track · ${track.name}`,
      label: `${track.name} pan`,
      target: param({ scope: 'track', trackId: id, param: 'pan' }),
    });
  }
  for (const [action, label] of Object.entries(ACTION_LABELS) as Array<[StudioActionId, string]>) {
    options.push({
      key: `action:${action}`,
      group: 'Actions',
      label,
      target: { kind: 'action', action },
    });
  }
  return options;
}

export function targetKey(target: MappingTarget): string {
  if (target.kind === 'action') return `action:${target.action}`;
  const a = target.address;
  switch (a.scope) {
    case 'selectedTrack':
      return `sel:${a.param === 'gainDb' ? 'gain' : a.param}`;
    case 'selectedInstrument':
      return `inst:${a.param}`;
    case 'master':
      return 'master:gain';
    case 'transport':
      return 'transport:bpm';
    case 'track':
      return `track:${a.trackId}:${a.param === 'gainDb' ? 'gain' : a.param}`;
    case 'instrument':
      return `instrument:${a.trackId}:${a.param}`;
    case 'effect':
      return `effect:${a.trackId}:${a.effectId}:${a.param}`;
  }
}

export function sourceKey(source: MidiControlSource, device: MidiDeviceSelector | null): string {
  return JSON.stringify([
    source.kind,
    'channel' in source ? source.channel : 'any',
    source.kind === 'cc' ? source.controller : source.kind === 'note' ? source.note : 0,
    device?.profileId ?? device?.portName ?? '*',
  ]);
}

/** Enabled mappings sharing a source with another enabled mapping. */
export function conflictingMappingIds(mappings: readonly MidiMapping[]): ReadonlySet<string> {
  const groups = new Map<string, string[]>();
  for (const m of mappings) {
    if (!m.enabled) continue;
    const key = sourceKey(m.source, m.device);
    groups.set(key, [...(groups.get(key) ?? []), m.id]);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) if (group.length > 1) for (const id of group) ids.add(id);
  return ids;
}

/** Mappings that respond to a physical control's default message. */
export function mappingsForControl(
  mappings: readonly MidiMapping[],
  control: DeviceControl,
  profileId: string,
): MidiMapping[] {
  const src = control.defaultSource;
  if (!src) return [];
  return mappings.filter((m) => {
    if (m.device && m.device.profileId && m.device.profileId !== profileId) return false;
    if (m.source.kind !== src.kind) return false;
    if (m.source.kind === 'cc' && src.kind === 'cc') return m.source.controller === src.controller;
    if (m.source.kind === 'note' && src.kind === 'note') return m.source.note === src.note;
    return true;
  });
}
