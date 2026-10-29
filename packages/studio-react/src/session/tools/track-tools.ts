/** Track, instrument and effect tools. Every edit is one undo entry. */
import type { Command, EffectTarget } from '@studio/commands';
import {
  clipsOnTrack,
  createEffectSlot,
  createInstrumentConfig,
  EFFECT_KINDS,
  EFFECT_LABELS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  SYNTH_PRESETS,
  TRACK_GAIN_SPEC,
  TRACK_PAN_SPEC,
  type EffectKind,
  type EffectSlot,
  type InstrumentKind,
  type InstrumentPreset,
  type TrackMixer,
} from '@studio/domain';
import { openClipInEditor, selectTrack } from '../../state/ui-store';
import type { StudioSession } from '../studio-session';
import type { ToolRegistry } from './registry';
import {
  defineTool,
  executeEdit,
  fail,
  registerAll,
  resolveTrack,
  summarizeTrack,
  validateParams,
} from './tool-helpers';

const TRACK_INSTRUMENTS = ['synth', 'drums'] as const;
const PRESET_IDS = SYNTH_PRESETS.map((p) => p.id);
const PRESET_HELP = SYNTH_PRESETS.map((p) => `${p.id} (${p.label})`).join(', ');

function findPreset(ref: string): InstrumentPreset {
  const wanted = ref.trim().toLowerCase();
  const preset = SYNTH_PRESETS.find(
    (p) => p.id.toLowerCase() === wanted || p.label.toLowerCase() === wanted,
  );
  return preset ?? fail(`Unknown preset "${ref}". Presets: ${PRESET_HELP}.`);
}

type ParamInput = Readonly<Record<string, unknown>>;

const PARAMS_SCHEMA = {
  type: 'object',
  description:
    'Parameter values by id, e.g. {"cutoffHz": 1200, "osc1Waveform": "sawtooth"}. See get_sound_catalog for ids and ranges.',
} as const;

export function registerTrackTools(registry: ToolRegistry, session: StudioSession): () => void {
  const { history } = session;

  const effectTarget = (
    ref: string,
  ): { target: EffectTarget; name: string; chain: readonly EffectSlot[] } => {
    if (ref.trim().toLowerCase() === 'master') {
      return { target: 'master', name: 'Master', chain: history.present.master.effects };
    }
    const track = resolveTrack(session, ref);
    return { target: track.id, name: track.name, chain: track.effects };
  };

  const findEffect = (
    chain: readonly EffectSlot[],
    owner: string,
    effectId?: string,
    kind?: string,
  ) => {
    const effect = effectId
      ? chain.find((e) => e.id === effectId)
      : kind
        ? chain.find((e) => e.kind === kind)
        : undefined;
    if (!effect) {
      const present = chain.map((e) => `${e.kind} (${e.id})`).join(', ') || 'none';
      fail(
        `${effectId || kind ? 'Effect not found' : 'Give effectId or kind'} on ${owner}. Effects there: ${present}.`,
      );
    }
    return effect;
  };

  return registerAll(registry, [
    defineTool<{ kind?: string; instrument?: string; preset?: string; name?: string }>({
      name: 'add_track',
      title: 'Add track',
      description: `Adds a track after the selected one and selects it. Instrument tracks play MIDI clips with a synth (presets: ${PRESET_HELP}) or a drum kit; audio tracks hold recorded/imported audio. Returns the new track id.`,
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['instrument', 'audio'],
            description: 'Default "instrument".',
          },
          instrument: {
            type: 'string',
            enum: TRACK_INSTRUMENTS,
            description: 'For instrument tracks: "synth" (default) or "drums".',
          },
          preset: { type: 'string', enum: PRESET_IDS, description: 'Synth preset id.' },
          name: { type: 'string', description: 'Track name (default "Instrument", "Drums"…).' },
        },
      },
      run: ({ kind, instrument, preset, name }) => {
        const trackKind = kind === 'audio' ? 'audio' : 'instrument';
        if (trackKind === 'audio' && (instrument || preset))
          fail(
            'Audio tracks have no instrument; omit "instrument" and "preset" or use kind "instrument".',
          );
        const presetDef = preset ? findPreset(preset) : undefined;
        const inst: InstrumentKind =
          (instrument as InstrumentKind | undefined) ?? presetDef?.kind ?? 'synth';
        if (presetDef && presetDef.kind !== inst)
          fail(`Preset "${presetDef.id}" is for ${presetDef.kind}, not ${inst}.`);
        const id = session.edits.addTrack(trackKind, {
          ...(trackKind === 'instrument' ? { instrument: inst } : {}),
          ...(presetDef ? { presetId: presetDef.id } : {}),
          ...(name?.trim() ? { name: name.trim() } : {}),
        });
        const track = history.present.tracks[id];
        if (!track) throw new Error('The track could not be added.');
        return { track: summarizeTrack(track, history.present, false) };
      },
    }),
    defineTool<{ trackId: string; name: string }>({
      name: 'rename_track',
      title: 'Rename track',
      description: 'Renames a track (id or current name) to a new name.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id or exact name.' },
          name: { type: 'string' },
        },
        required: ['trackId', 'name'],
      },
      run: ({ trackId, name }) => {
        const track = resolveTrack(session, trackId);
        if (!name.trim()) fail('The track name cannot be empty.');
        executeEdit(
          session,
          [{ type: 'track.update', trackId: track.id, patch: { name: name.trim() } }],
          'Rename Track',
        );
        return { track: { id: track.id, name: name.trim() } };
      },
    }),
    defineTool<{ trackId: string }>({
      name: 'delete_track',
      title: 'Delete track',
      description:
        'Deletes a track together with all of its clips (destructive; the user can Undo). Tell the user what was deleted.',
      inputSchema: {
        type: 'object',
        properties: { trackId: { type: 'string', description: 'Track id or exact name.' } },
        required: ['trackId'],
      },
      run: ({ trackId }) => {
        const track = resolveTrack(session, trackId);
        const clipCount = clipsOnTrack(history.present, track.id).length;
        executeEdit(
          session,
          [{ type: 'track.remove', trackId: track.id }],
          `Delete Track "${track.name}"`,
        );
        return {
          deleted: { trackId: track.id, name: track.name, clipsDeleted: clipCount },
          undoable: true,
        };
      },
    }),
    defineTool<{
      trackId: string;
      mute?: boolean;
      solo?: boolean;
      volumeDb?: number;
      pan?: number;
    }>({
      name: 'set_track_mixer',
      title: 'Mix track',
      description: `Sets a track's mute, solo, volume (dB, ${TRACK_GAIN_SPEC.min} to +${TRACK_GAIN_SPEC.max}, 0 = unity) and/or pan (-1 left … 1 right).`,
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id or exact name.' },
          mute: { type: 'boolean' },
          solo: { type: 'boolean' },
          volumeDb: { type: 'number', minimum: TRACK_GAIN_SPEC.min, maximum: TRACK_GAIN_SPEC.max },
          pan: { type: 'number', minimum: TRACK_PAN_SPEC.min, maximum: TRACK_PAN_SPEC.max },
        },
        required: ['trackId'],
      },
      run: ({ trackId, mute, solo, volumeDb, pan }) => {
        const track = resolveTrack(session, trackId);
        const mixer: Partial<TrackMixer> = {
          ...(mute !== undefined ? { mute } : {}),
          ...(solo !== undefined ? { solo } : {}),
          ...(volumeDb !== undefined ? { gainDb: volumeDb } : {}),
          ...(pan !== undefined ? { pan } : {}),
        };
        if (Object.keys(mixer).length === 0)
          fail('Give at least one of mute, solo, volumeDb or pan.');
        executeEdit(session, [{ type: 'track.setMixer', trackId: track.id, mixer }], 'Mix Track');
        return { track: summarizeTrack(history.present.tracks[track.id]!, history.present, false) };
      },
    }),
    defineTool<{ trackId: string; instrument?: string; preset?: string; params?: ParamInput }>({
      name: 'set_instrument_params',
      title: 'Set instrument',
      description:
        'Changes an instrument track\'s sound: switch instrument ("synth"/"drums") and/or load a preset, then apply parameter values (e.g. cutoffHz, attack, release, osc1Waveform). Values outside the parameter range are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Instrument track id or exact name.' },
          instrument: { type: 'string', enum: TRACK_INSTRUMENTS },
          preset: { type: 'string', enum: PRESET_IDS },
          params: PARAMS_SCHEMA,
        },
        required: ['trackId'],
      },
      run: ({ trackId, instrument, preset, params }) => {
        const track = resolveTrack(session, trackId);
        if (track.kind !== 'instrument' || !track.instrument)
          fail(`Track "${track.name}" is not an instrument track.`);
        const presetDef = preset ? findPreset(preset) : undefined;
        const kind: InstrumentKind =
          (instrument as InstrumentKind | undefined) ?? presetDef?.kind ?? track.instrument.kind;
        if (presetDef && presetDef.kind !== kind)
          fail(`Preset "${presetDef.id}" is for ${presetDef.kind}, not ${kind}.`);
        const commands: Command[] = [];
        if (presetDef || kind !== track.instrument.kind) {
          commands.push({
            type: 'track.setInstrument',
            trackId: track.id,
            instrument: createInstrumentConfig(kind, presetDef?.id),
          });
        }
        if (params && Object.keys(params).length > 0) {
          const values = validateParams(INSTRUMENT_PARAM_SPECS[kind], params, kind);
          commands.push({ type: 'track.setInstrumentParams', trackId: track.id, params: values });
        }
        if (commands.length === 0) fail('Give instrument, preset or params.');
        executeEdit(session, commands, 'Set Instrument');
        const updated = history.present.tracks[track.id]!.instrument!;
        return {
          trackId: track.id,
          instrument: updated.kind,
          preset: updated.presetId ?? null,
          params: updated.params,
        };
      },
    }),
    defineTool<{ trackId: string; kind: string; params?: ParamInput }>({
      name: 'add_effect',
      title: 'Add effect',
      description: `Adds an effect to the end of a track's effect chain (or "master"): ${EFFECT_KINDS.map((k) => `${k} (${EFFECT_LABELS[k]})`).join(', ')}. Optional params override the defaults. Returns the effect id.`,
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id, exact track name, or "master".' },
          kind: { type: 'string', enum: EFFECT_KINDS },
          params: PARAMS_SCHEMA,
        },
        required: ['trackId', 'kind'],
      },
      run: ({ trackId, kind, params }) => {
        const { target, name } = effectTarget(trackId);
        const effectKind = kind as EffectKind;
        const values = params ? validateParams(EFFECT_PARAM_SPECS[effectKind], params, kind) : {};
        const slot = createEffectSlot(session.ids.create('effect'), effectKind);
        const effect: EffectSlot = { ...slot, params: { ...slot.params, ...values } };
        executeEdit(
          session,
          [{ type: 'effect.add', target, effect }],
          `Add ${EFFECT_LABELS[effectKind]}`,
        );
        return { effect: { id: effect.id, kind: effect.kind, on: name, params: effect.params } };
      },
    }),
    defineTool<{
      trackId: string;
      effectId?: string;
      kind?: string;
      params?: ParamInput;
      bypass?: boolean;
    }>({
      name: 'set_effect_params',
      title: 'Adjust effect',
      description:
        'Changes parameters (and/or bypass) of an effect on a track or "master". Identify it by effectId, or by kind (first effect of that kind).',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id, exact track name, or "master".' },
          effectId: { type: 'string' },
          kind: { type: 'string', enum: EFFECT_KINDS },
          params: PARAMS_SCHEMA,
          bypass: {
            type: 'boolean',
            description: 'true turns the effect off without removing it.',
          },
        },
        required: ['trackId'],
      },
      run: ({ trackId, effectId, kind, params, bypass }) => {
        const { target, name, chain } = effectTarget(trackId);
        const effect = findEffect(chain, name, effectId, kind);
        const commands: Command[] = [];
        if (params && Object.keys(params).length > 0) {
          const values = validateParams(EFFECT_PARAM_SPECS[effect.kind], params, effect.kind);
          commands.push({ type: 'effect.setParams', target, effectId: effect.id, params: values });
        }
        if (bypass !== undefined)
          commands.push({ type: 'effect.setBypass', target, effectId: effect.id, bypass });
        if (commands.length === 0) fail('Give params or bypass.');
        executeEdit(session, commands, `Adjust ${EFFECT_LABELS[effect.kind]}`);
        const updated = effectTarget(trackId).chain.find((e) => e.id === effect.id)!;
        return {
          effect: {
            id: updated.id,
            kind: updated.kind,
            on: name,
            bypass: updated.bypass,
            params: updated.params,
          },
        };
      },
    }),
    defineTool<{ trackId: string; effectId?: string; kind?: string }>({
      name: 'remove_effect',
      title: 'Remove effect',
      description:
        'Removes an effect from a track or "master" (by effectId, or the first effect of a kind). The user can Undo.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Track id, exact track name, or "master".' },
          effectId: { type: 'string' },
          kind: { type: 'string', enum: EFFECT_KINDS },
        },
        required: ['trackId'],
      },
      run: ({ trackId, effectId, kind }) => {
        const { target, name, chain } = effectTarget(trackId);
        const effect = findEffect(chain, name, effectId, kind);
        executeEdit(
          session,
          [{ type: 'effect.remove', target, effectId: effect.id }],
          `Remove ${EFFECT_LABELS[effect.kind]}`,
        );
        return { removed: { id: effect.id, kind: effect.kind, from: name } };
      },
    }),
    defineTool<{ trackId: string }>({
      name: 'select_track_devices',
      title: 'Show track devices',
      description:
        'Selects a track and shows its instrument and effects in the editor panel (so the user can see what you changed).',
      inputSchema: {
        type: 'object',
        properties: { trackId: { type: 'string', description: 'Track id or exact name.' } },
        required: ['trackId'],
      },
      run: ({ trackId }) => {
        const track = resolveTrack(session, trackId);
        session.uiStore.setState((s) => {
          const next = openClipInEditor(selectTrack(s, track.id), null);
          return {
            ...next,
            view: next.view === 'projects' ? 'arrange' : next.view,
            panels: { ...next.panels, bottomOpen: true, bottomPanel: 'editor' },
          };
        });
        return { showing: { id: track.id, name: track.name } };
      },
    }),
  ]);
}
