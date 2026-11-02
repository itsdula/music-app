/** Read-only tools: project summary, tracks, clip notes, projects, selection, view, catalogs. */
import {
  EFFECT_KINDS,
  EFFECT_LABELS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_LABELS,
  INSTRUMENT_PARAM_SPECS,
  orderedTracks,
  SCALES,
  SYNTH_PRESETS,
} from '@studio/domain';
import type { StudioSession } from '../studio-session';
import { DRUM_VOICE_NOTES, keyName, noteName, parseKey, scaleNotes } from './music';
import type { ToolRegistry } from './registry';
import {
  defineTool,
  describeNote,
  describeSpec,
  registerAll,
  resolveMidiClip,
  summarizeClip,
  summarizeProject,
  summarizeSelection,
  summarizeTrack,
  summarizeView,
} from './tool-helpers';

const MAX_NOTES = 400;

export function registerReadTools(registry: ToolRegistry, session: StudioSession): () => void {
  return registerAll(registry, [
    defineTool<Record<string, never>>({
      name: 'get_project_summary',
      title: 'Read project',
      description:
        'Returns the open project: name, tempo, time signature, estimated key, length, loop, transport position, every track (instrument, mixer, effects) with its clips (ids, start bar, length, note count), the master bus, the current page and the selection. Call this first when you need ids or context.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: () => summarizeProject(session),
    }),
    defineTool<Record<string, never>>({
      name: 'list_tracks',
      title: 'List tracks',
      description:
        'Lists tracks in arrangement order with id, name, kind, instrument/preset, volume, pan, mute/solo, effects and clip count.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: () => {
        const project = session.history.present;
        return { tracks: orderedTracks(project).map((t) => summarizeTrack(t, project, false)) };
      },
    }),
    defineTool<{ clipId: string }>({
      name: 'get_clip_notes',
      title: 'Read clip notes',
      description:
        'Returns the notes of a MIDI clip: pitch name, MIDI number, drum voice (on drums tracks), start as 0-based beat and 16th step from the clip start, length in beats and velocity.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string', description: 'Clip id (or unique clip name).' } },
        required: ['clipId'],
      },
      readOnly: true,
      run: ({ clipId }) => {
        const project = session.history.present;
        const clip = resolveMidiClip(session, clipId);
        const drums = project.tracks[clip.trackId]?.instrument?.kind === 'drums';
        return {
          clip: summarizeClip(clip, project),
          notes: clip.notes.slice(0, MAX_NOTES).map((n) => describeNote(n, project.meter, drums)),
          ...(clip.notes.length > MAX_NOTES
            ? { truncated: `showing ${MAX_NOTES} of ${clip.notes.length} notes` }
            : {}),
        };
      },
    }),
    defineTool<Record<string, never>>({
      name: 'list_projects',
      title: 'List projects',
      description:
        'Lists saved projects (id, name, last updated), most recent first, and marks the open one.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: async () => {
        const current = session.history.present.id;
        const items = await session.projects.list();
        return {
          projects: items.map((p) => ({
            id: p.id,
            name: p.name,
            updatedAt: p.updatedAt,
            trackCount: p.trackCount,
            ...(p.id === current ? { open: true } : {}),
          })),
        };
      },
    }),
    defineTool<Record<string, never>>({
      name: 'get_selection',
      title: 'Read selection',
      description:
        'Returns what the user has selected: the selected track, selected clips, the clip open in the editor and how many notes are selected.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: () => summarizeSelection(session),
    }),
    defineTool<Record<string, never>>({
      name: 'get_current_view',
      title: 'Read current page',
      description:
        'Returns the current Nawa page ("projects", "arrange" or "editor") and which bottom panel (track, clip, mixer, controller) is open.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: () => summarizeView(session),
    }),
    defineTool<Record<string, never>>({
      name: 'get_sound_catalog',
      title: 'Read instruments & effects',
      description:
        'Lists instruments (synth, drums) with their presets and parameters, effect types with their parameters (ids, ranges, defaults) and the drum-kit note map. Use before add_track, set_instrument_params, add_effect or set_effect_params when unsure of ids.',
      inputSchema: { type: 'object', properties: {} },
      readOnly: true,
      run: () => ({
        instruments: (['synth', 'drums'] as const).map((kind) => ({
          kind,
          label: INSTRUMENT_LABELS[kind],
          presets: SYNTH_PRESETS.filter((p) => p.kind === kind).map((p) => ({
            id: p.id,
            label: p.label,
          })),
          params: INSTRUMENT_PARAM_SPECS[kind].map(describeSpec),
        })),
        effects: EFFECT_KINDS.map((kind) => ({
          kind,
          label: EFFECT_LABELS[kind],
          params: EFFECT_PARAM_SPECS[kind].map(describeSpec),
        })),
        drumKit: Object.entries(DRUM_VOICE_NOTES).map(([voice, midi]) => ({
          voice,
          midi,
          pitch: noteName(midi),
        })),
      }),
    }),
    defineTool<{ key: string; octave?: number; octaves?: number }>({
      name: 'get_scale_notes',
      title: 'Scale notes',
      description:
        'Returns the notes of a key/scale (e.g. "A minor", "C major", "D dorian", "E minor pentatonic", "Bb blues") as names and MIDI numbers, to help write melodies and bass lines that stay in key.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Tonic and scale, e.g. "A minor".' },
          octave: {
            type: 'integer',
            minimum: 0,
            maximum: 8,
            description: 'Octave of the starting tonic (4 → middle C octave). Default 4.',
          },
          octaves: { type: 'integer', minimum: 1, maximum: 3, description: 'Default 1.' },
        },
        required: ['key'],
      },
      readOnly: true,
      run: ({ key, octave, octaves }) => {
        const parsed = parseKey(key);
        const notes = scaleNotes(parsed, octave ?? 4, octaves ?? 1);
        return {
          key: keyName(parsed),
          intervals: SCALES[parsed.scale].intervals,
          notes: notes.map((midi) => ({ pitch: noteName(midi), midi })),
        };
      },
    }),
  ]);
}
