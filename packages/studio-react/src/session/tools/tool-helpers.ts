/**
 * Shared helpers for the core tool groups: typed tool definitions, track/clip lookup by id or
 * name, musical-time conversion (bars/beats/16th steps ↔ ticks), note input parsing,
 * parameter validation against domain specs and compact project summaries for the model.
 */
import type { Command } from '@studio/commands';
import {
  anyTrackSoloed,
  arrangementEndTick,
  clipLengthTicks,
  clipsOnTrack,
  EFFECT_LABELS,
  INSTRUMENT_LABELS,
  isTrackAudible,
  orderedTracks,
  PPQ,
  SYNTH_PRESETS,
  ticksPerBar,
  ticksPerBeat,
  type Clip,
  type EffectSlot,
  type MidiClip,
  type MidiNote,
  type ParamSpec,
  type Project,
  type TimeSignature,
  type Track,
} from '@studio/domain';
import type { JsonSchema } from '@studio/platform-contracts';
import type { StudioSession } from '../studio-session';
import { chordRoot, drumVoiceName, estimateKey, noteName, parsePitch } from './music';
import { ToolInputError, type StudioTool, type ToolRegistry } from './registry';

/** Identity helper that keeps the input type of a tool definition. */
export function defineTool<I>(tool: StudioTool<I>): StudioTool<I> {
  return tool;
}

/** Registers tools and returns one function that removes them all. */
export function registerAll(
  registry: ToolRegistry,
  tools: ReadonlyArray<StudioTool<never>>,
): () => void {
  const undo = tools.map((t) => registry.register(t));
  return () => {
    for (const fn of undo.reverse()) fn();
  };
}

export const STEP_TICKS = PPQ / 4;

/** Rounds to at most 3 decimals for compact, readable output. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Musical time
// ---------------------------------------------------------------------------

export function barToTick(bar: number, meter: TimeSignature): number {
  return Math.round((bar - 1) * ticksPerBar(meter));
}

/** 1-based (fractional) bar number of a tick position. */
export function tickToBar(tick: number, meter: TimeSignature): number {
  return round3(tick / ticksPerBar(meter) + 1);
}

export function ticksToBars(ticks: number, meter: TimeSignature): number {
  return round3(ticks / ticksPerBar(meter));
}

export function meterLabel(meter: TimeSignature): string {
  return `${meter.numerator}/${meter.denominator}`;
}

// ---------------------------------------------------------------------------
// Errors and command execution
// ---------------------------------------------------------------------------

export function fail(message: string): never {
  throw new ToolInputError(message);
}

/** Executes commands as one undo entry; throws a readable error if the edit is rejected. */
export function executeEdit(
  session: StudioSession,
  commands: readonly Command[],
  label: string,
): void {
  const result =
    commands.length === 1
      ? session.history.execute(commands[0]!, { label })
      : session.history.executeBatch(commands, { label });
  if (!result.ok) throw new Error(`${label} failed: ${result.error.message}`);
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

function trackList(project: Project): string {
  const tracks = orderedTracks(project);
  if (tracks.length === 0) return 'The project has no tracks yet (use add_track).';
  return `Tracks: ${tracks.map((t) => `"${t.name}" (${t.id})`).join(', ')}.`;
}

/** Finds a track by id, or by name (case-insensitive) when the name is unique. */
export function resolveTrack(session: StudioSession, ref: string): Track {
  const project = session.history.present;
  const byId = project.tracks[ref as Track['id']];
  if (byId) return byId;
  const wanted = ref.trim().toLowerCase();
  const matches = orderedTracks(project).filter((t) => t.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    fail(`Several tracks are named "${ref}"; use the track id. ${trackList(project)}`);
  return fail(`Track "${ref}" not found. ${trackList(project)}`);
}

export function resolveInstrumentTrack(session: StudioSession, ref: string): Track {
  const track = resolveTrack(session, ref);
  if (track.kind !== 'instrument')
    fail(
      `Track "${track.name}" is an ${track.kind} track; notes need an instrument track (use add_track with kind "instrument").`,
    );
  return track;
}

export function resolveClip(session: StudioSession, ref: string): Clip {
  const project = session.history.present;
  const clip = project.clips[ref as Clip['id']];
  if (clip) return clip;
  const wanted = ref.trim().toLowerCase();
  const matches = Object.values(project.clips).filter((c) => c.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0]!;
  const known = Object.values(project.clips)
    .slice(0, 12)
    .map((c) => `"${c.name}" (${c.id})`)
    .join(', ');
  return fail(
    `Clip "${ref}" not found${matches.length > 1 ? ' (several clips share that name; use the id)' : ''}. ${
      known ? `Clips include: ${known}.` : 'The project has no clips.'
    } Use get_project_summary to see clip ids.`,
  );
}

export function resolveMidiClip(session: StudioSession, ref: string): MidiClip {
  const clip = resolveClip(session, ref);
  if (clip.kind !== 'midi') fail(`Clip "${clip.name}" is an audio clip and has no notes.`);
  return clip;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface NoteInput {
  readonly pitch?: unknown;
  readonly beat?: number;
  readonly step?: number;
  readonly length?: number;
  readonly velocity?: number;
}

export const NOTE_ITEM_SCHEMA: JsonSchema = {
  type: 'object',
  description:
    'One note. Give its position as `beat` OR `step` (both 0-based from the clip start); `length` uses the same unit as the position.',
  properties: {
    pitch: {
      description:
        'MIDI number 0-127 or a note name like "C4", "F#3", "Bb2" (C4 = 60). On drums tracks: 36 kick, 38 snare, 39 clap, 42 closed hat, 46 open hat, 49 crash.',
    },
    beat: {
      type: 'number',
      minimum: 0,
      description:
        'Start in beats from the clip start (0 = first beat; 1.5 = halfway through beat 2).',
    },
    step: {
      type: 'integer',
      minimum: 0,
      description: 'Start as a 16th-note step from the clip start (0-15 in the first 4/4 bar).',
    },
    length: {
      type: 'number',
      minimum: 0.01,
      description: 'Duration in beats (with `beat`) or 16th steps (with `step`). Default 1.',
    },
    velocity: {
      type: 'integer',
      minimum: 1,
      maximum: 127,
      description: 'Loudness 1-127. Default 100.',
    },
  },
  required: ['pitch'],
};

/** Converts tool note input into domain notes (ticks relative to the clip content start). */
export function parseNotes(
  inputs: readonly NoteInput[],
  meter: TimeSignature,
  path = 'notes',
): Array<Omit<MidiNote, 'id'>> {
  const beatTicks = ticksPerBeat(meter);
  return inputs.map((n, i) => {
    const at = `${path}[${i}]`;
    const pitch = parsePitch(n.pitch, `${at}.pitch`);
    if (n.beat !== undefined && n.step !== undefined)
      fail(`${at}: give either "beat" or "step", not both`);
    if (n.beat === undefined && n.step === undefined)
      fail(`${at}: give a position as "beat" (0-based beats) or "step" (0-based 16th steps)`);
    const unit = n.beat !== undefined ? beatTicks : STEP_TICKS;
    const startTick = Math.round((n.beat ?? n.step ?? 0) * unit);
    const durationTicks = Math.max(1, Math.round((n.length ?? 1) * unit));
    return { pitch, velocity: n.velocity ?? 100, startTick, durationTicks };
  });
}

export function describeNote(
  note: MidiNote,
  meter: TimeSignature,
  drums: boolean,
): Record<string, unknown> {
  const beatTicks = ticksPerBeat(meter);
  const drum = drums ? drumVoiceName(note.pitch) : undefined;
  return {
    id: note.id,
    pitch: noteName(note.pitch),
    midi: note.pitch,
    ...(drum ? { drum } : {}),
    beat: round3(note.startTick / beatTicks),
    step: round3(note.startTick / STEP_TICKS),
    lengthBeats: round3(note.durationTicks / beatTicks),
    velocity: note.velocity,
  };
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

export function describeSpec(spec: ParamSpec): Record<string, unknown> {
  return {
    id: spec.id,
    label: spec.label,
    min: spec.min,
    max: spec.max,
    default: spec.default,
    ...(spec.unit ? { unit: spec.unit } : {}),
    ...(spec.options ? { options: spec.options.map((o) => o.label.toLowerCase()) } : {}),
  };
}

/**
 * Validates `{ paramId: value }` against specs. Option parameters also accept their label
 * (e.g. "sawtooth"). Out-of-range values are errors so the model learns the valid range.
 */
export function validateParams(
  specs: readonly ParamSpec[],
  params: Readonly<Record<string, unknown>>,
  owner: string,
): Record<string, number> {
  const result: Record<string, number> = {};
  const errors: string[] = [];
  for (const [id, raw] of Object.entries(params)) {
    const spec = specs.find((s) => s.id === id || s.label.toLowerCase() === id.toLowerCase());
    if (!spec) {
      errors.push(`unknown parameter "${id}"`);
      continue;
    }
    let value: number | undefined;
    if (typeof raw === 'number' && Number.isFinite(raw)) value = raw;
    else if (typeof raw === 'string' && spec.options) {
      value = spec.options.find((o) => o.label.toLowerCase() === raw.trim().toLowerCase())?.value;
    }
    if (value === undefined) {
      errors.push(
        `${spec.id} must be a number${spec.options ? ` or one of ${spec.options.map((o) => `"${o.label.toLowerCase()}"`).join(', ')}` : ''}`,
      );
      continue;
    }
    if (value < spec.min || value > spec.max) {
      errors.push(
        `${spec.id} must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}`,
      );
      continue;
    }
    result[spec.id] = value;
  }
  if (errors.length > 0) {
    fail(
      `Invalid ${owner} parameters: ${errors.join('; ')}. Valid parameters: ${specs
        .map((s) => `${s.id} (${s.min}..${s.max}${s.unit ? ` ${s.unit}` : ''})`)
        .join(', ')}.`,
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export function summarizeClip(clip: Clip, project: Project): Record<string, unknown> {
  const meter = project.meter;
  return {
    id: clip.id,
    name: clip.name,
    kind: clip.kind,
    trackId: clip.trackId,
    startBar: tickToBar(clip.startTick, meter),
    lengthBars: ticksToBars(clipLengthTicks(clip, project), meter),
    ...(clip.kind === 'midi' ? { noteCount: clip.notes.length } : {}),
    ...(clip.muted ? { muted: true } : {}),
  };
}

function summarizeEffects(effects: readonly EffectSlot[]): Array<Record<string, unknown>> {
  return effects.map((e) => ({
    id: e.id,
    kind: e.kind,
    label: EFFECT_LABELS[e.kind],
    ...(e.bypass ? { bypassed: true } : {}),
  }));
}

export function instrumentLabel(track: Track): string | undefined {
  const inst = track.instrument;
  if (!inst) return undefined;
  const preset = inst.presetId ? SYNTH_PRESETS.find((p) => p.id === inst.presetId) : undefined;
  return preset
    ? `${INSTRUMENT_LABELS[inst.kind]} – ${preset.label}`
    : INSTRUMENT_LABELS[inst.kind];
}

export function summarizeTrack(
  track: Track,
  project: Project,
  withClips: boolean,
): Record<string, unknown> {
  const clips = clipsOnTrack(project, track.id);
  return {
    id: track.id,
    name: track.name,
    kind: track.kind,
    ...(track.instrument
      ? {
          instrument: track.instrument.kind,
          ...(track.instrument.presetId ? { preset: track.instrument.presetId } : {}),
          instrumentLabel: instrumentLabel(track),
        }
      : {}),
    volumeDb: round3(track.mixer.gainDb),
    pan: round3(track.mixer.pan),
    mute: track.mixer.mute,
    solo: track.mixer.solo,
    audible: isTrackAudible(track, anyTrackSoloed(project)),
    effects: summarizeEffects(track.effects),
    ...(withClips
      ? { clips: clips.map((c) => summarizeClip(c, project)) }
      : { clipCount: clips.length }),
  };
}

/** Rough key of the project's pitched (non-drum) notes, weighted by duration. */
export function projectKey(project: Project): string | null {
  const notes: Array<{ pitch: number; weight: number }> = [];
  const anchors: number[] = [];
  const rootAt = (clip: MidiClip, tick: number) =>
    chordRoot(clip.notes.filter((n) => n.startTick === tick).map((n) => n.pitch));
  for (const clip of Object.values(project.clips)) {
    if (clip.kind !== 'midi' || clip.notes.length === 0) continue;
    if (project.tracks[clip.trackId]?.instrument?.kind === 'drums') continue;
    for (const n of clip.notes) notes.push({ pitch: n.pitch, weight: n.durationTicks });
    // Notes are sorted by start: the first and last onsets usually sit on the tonal centre.
    anchors.push(rootAt(clip, clip.notes[0]!.startTick));
    anchors.push(rootAt(clip, clip.notes[clip.notes.length - 1]!.startTick));
  }
  return estimateKey(notes, anchors)?.label ?? null;
}

export function summarizeSelection(session: StudioSession): Record<string, unknown> {
  const { selection } = session.uiStore.getState();
  const project = session.history.present;
  const track = selection.trackId ? project.tracks[selection.trackId] : undefined;
  const editorClip = selection.editorClipId ? project.clips[selection.editorClipId] : undefined;
  return {
    track: track ? { id: track.id, name: track.name } : null,
    clips: [...selection.clipIds]
      .map((id) => project.clips[id])
      .filter((c): c is Clip => Boolean(c))
      .map((c) => ({ id: c.id, name: c.name })),
    editorClip: editorClip ? { id: editorClip.id, name: editorClip.name } : null,
    selectedNoteCount: selection.noteIds.size,
  };
}

export function summarizeView(session: StudioSession): Record<string, unknown> {
  const ui = session.uiStore.getState();
  return {
    view: ui.view,
    bottomPanel: ui.view === 'arrange' && ui.panels.bottomOpen ? ui.panels.bottomPanel : null,
    browserOpen: ui.panels.browserOpen,
    assistantOpen: ui.assistantOpen,
  };
}

export function summarizeProject(session: StudioSession): Record<string, unknown> {
  const project = session.history.present;
  const meter = project.meter;
  const engine = session.engineStore.getState();
  return {
    projectId: project.id,
    name: project.name,
    tempoBpm: project.bpm,
    timeSignature: meterLabel(meter),
    estimatedKey: projectKey(project),
    lengthBars: ticksToBars(arrangementEndTick(project), meter),
    loop: {
      enabled: project.loop.enabled,
      startBar: tickToBar(project.loop.startTick, meter),
      endBar: tickToBar(project.loop.endTick, meter),
    },
    transport: { state: engine.playState, positionBar: tickToBar(engine.cursorTick, meter) },
    tracks: orderedTracks(project).map((t) => summarizeTrack(t, project, true)),
    master: { volumeDb: project.master.gainDb, effects: summarizeEffects(project.master.effects) },
    view: summarizeView(session),
    selection: summarizeSelection(session),
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
  };
}
