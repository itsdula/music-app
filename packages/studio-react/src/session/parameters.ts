/**
 * Resolves `ParameterAddress`es (used by MIDI mappings, knobs and automation) to their
 * ParamSpec, current value and the command that sets a new value. One place, so UI
 * controls and controller mappings always agree on ranges and curves.
 */
import type { Command } from '@studio/commands';
import {
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  MASTER_GAIN_SPEC,
  TEMPO_SPEC,
  TRACK_GAIN_SPEC,
  TRACK_PAN_SPEC,
  denormalizeParam,
  normalizeParam,
  type ParamSpec,
  type ParameterAddress,
  type Project,
  type TrackId,
  type TrackParam,
} from '@studio/domain';

const TOGGLE_SPEC = (id: string, label: string): ParamSpec => ({
  id,
  label,
  min: 0,
  max: 1,
  default: 0,
  unit: '',
  curve: 'linear',
  step: 1,
  options: [
    { value: 0, label: 'Off' },
    { value: 1, label: 'On' },
  ],
});

export interface ResolvedParameter {
  readonly spec: ParamSpec;
  readonly value: number;
  readonly label: string;
  /** Command setting the parameter to `value` (already clamped by handlers). */
  command(value: number): Command;
}

function trackParam(project: Project, trackId: TrackId, param: TrackParam): ResolvedParameter | undefined {
  const track = project.tracks[trackId];
  if (!track) return undefined;
  switch (param) {
    case 'gainDb':
      return {
        spec: TRACK_GAIN_SPEC,
        value: track.mixer.gainDb,
        label: `${track.name} · Volume`,
        command: (v) => ({ type: 'track.setMixer', trackId, mixer: { gainDb: v } }),
      };
    case 'pan':
      return {
        spec: TRACK_PAN_SPEC,
        value: track.mixer.pan,
        label: `${track.name} · Pan`,
        command: (v) => ({ type: 'track.setMixer', trackId, mixer: { pan: v } }),
      };
    case 'mute':
      return {
        spec: TOGGLE_SPEC('mute', 'Mute'),
        value: track.mixer.mute ? 1 : 0,
        label: `${track.name} · Mute`,
        command: (v) => ({ type: 'track.setMixer', trackId, mixer: { mute: v >= 0.5 } }),
      };
    case 'solo':
      return {
        spec: TOGGLE_SPEC('solo', 'Solo'),
        value: track.mixer.solo ? 1 : 0,
        label: `${track.name} · Solo`,
        command: (v) => ({ type: 'track.setMixer', trackId, mixer: { solo: v >= 0.5 } }),
      };
    case 'arm':
      return {
        spec: TOGGLE_SPEC('arm', 'Arm'),
        value: track.armed ? 1 : 0,
        label: `${track.name} · Arm`,
        command: (v) => ({ type: 'track.update', trackId, patch: { armed: v >= 0.5 } }),
      };
  }
}

function instrumentParam(project: Project, trackId: TrackId, param: string): ResolvedParameter | undefined {
  const track = project.tracks[trackId];
  const instrument = track?.instrument;
  if (!track || !instrument) return undefined;
  const spec = INSTRUMENT_PARAM_SPECS[instrument.kind].find((s) => s.id === param);
  if (!spec) return undefined;
  return {
    spec,
    value: instrument.params[param] ?? spec.default,
    label: `${track.name} · ${spec.label}`,
    command: (v) => ({ type: 'track.setInstrumentParams', trackId, params: { [param]: v } }),
  };
}

export function resolveParameter(
  project: Project,
  address: ParameterAddress,
  selectedTrackId: TrackId | null,
): ResolvedParameter | undefined {
  switch (address.scope) {
    case 'track':
      return trackParam(project, address.trackId, address.param);
    case 'selectedTrack':
      return selectedTrackId ? trackParam(project, selectedTrackId, address.param) : undefined;
    case 'instrument':
      return instrumentParam(project, address.trackId, address.param);
    case 'selectedInstrument':
      return selectedTrackId ? instrumentParam(project, selectedTrackId, address.param) : undefined;
    case 'master':
      return {
        spec: MASTER_GAIN_SPEC,
        value: project.master.gainDb,
        label: 'Master · Volume',
        command: (v) => ({ type: 'master.setGain', gainDb: v }),
      };
    case 'transport':
      return {
        spec: TEMPO_SPEC,
        value: project.bpm,
        label: 'Tempo',
        command: (v) => ({ type: 'project.setTempo', bpm: v }),
      };
    case 'effect': {
      const chain = address.trackId === 'master' ? project.master.effects : project.tracks[address.trackId]?.effects;
      const slot = chain?.find((e) => e.id === address.effectId);
      if (!slot) return undefined;
      const spec = EFFECT_PARAM_SPECS[slot.kind].find((s) => s.id === address.param);
      if (!spec) return undefined;
      const owner = address.trackId === 'master' ? 'Master' : (project.tracks[address.trackId]?.name ?? 'Track');
      return {
        spec,
        value: slot.params[address.param] ?? spec.default,
        label: `${owner} · ${spec.label}`,
        command: (v) => ({
          type: 'effect.setParams',
          target: address.trackId,
          effectId: address.effectId,
          params: { [address.param]: v },
        }),
      };
    }
  }
}

export function normalizedValue(resolved: ResolvedParameter): number {
  return normalizeParam(resolved.spec, resolved.value);
}

export function commandForNormalized(resolved: ResolvedParameter, normalized: number): Command {
  return resolved.command(denormalizeParam(resolved.spec, normalized));
}

export function describeAddress(project: Project, address: ParameterAddress, selectedTrackId: TrackId | null): string {
  if (address.scope === 'selectedTrack' || address.scope === 'selectedInstrument') {
    const resolved = resolveParameter(project, address, selectedTrackId);
    const paramLabel = resolved?.spec.label ?? address.param;
    return `Selected track · ${paramLabel}`;
  }
  return resolveParameter(project, address, selectedTrackId)?.label ?? 'Unavailable parameter';
}
