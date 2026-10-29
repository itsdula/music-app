/**
 * Clip and note tools: create MIDI clips with notes, chord progressions and drum patterns,
 * edit notes (add, replace, quantize, transpose) and move/duplicate/delete clips.
 * Inputs use bars (1-based), beats and 16th steps (0-based within a clip); never raw ticks.
 */
import type { Command } from '@studio/commands';
import {
  clipEndTick,
  clipLengthTicks,
  clipsOnTrack,
  createMidiClip,
  GRID_DIVISIONS,
  gridDivisionTicks,
  ticksPerBar,
  ticksPerBeat,
  type Clip,
  type ClipId,
  type GridDivision,
  type MidiClip,
  type MidiNote,
  type Track,
} from '@studio/domain';
import { openClipInEditor, selectClips, selectTrack } from '../../state/ui-store';
import type { StudioSession } from '../studio-session';
import { noteName, parseChord, parsePitch, resolveDrumVoice, voiceChord } from './music';
import type { ToolRegistry } from './registry';
import {
  barToTick,
  defineTool,
  executeEdit,
  fail,
  NOTE_ITEM_SCHEMA,
  parseNotes,
  registerAll,
  resolveClip,
  resolveInstrumentTrack,
  resolveMidiClip,
  resolveTrack,
  STEP_TICKS,
  summarizeClip,
  tickToBar,
  type NoteInput,
} from './tool-helpers';

const MAX_NOTES_PER_CALL = 2000;
const RHYTHMS = ['sustain', 'quarters', 'eighths', 'offbeat', 'arpeggio'] as const;
type Rhythm = (typeof RHYTHMS)[number];

const NOTES_SCHEMA = {
  type: 'array',
  maxItems: MAX_NOTES_PER_CALL,
  items: NOTE_ITEM_SCHEMA,
  description:
    'Notes, e.g. [{"pitch":"A3","beat":0,"length":2},{"pitch":"C4","step":8,"length":4}].',
} as const;

type RawNote = Omit<MidiNote, 'id'>;

export function registerClipTools(registry: ToolRegistry, session: StudioSession): () => void {
  const { history } = session;
  const project = () => history.present;

  /** Tick where a new clip goes when no start bar is given: the bar after the track's last clip. */
  const nextFreeTick = (track: Track): number => {
    const p = project();
    const end = Math.max(0, ...clipsOnTrack(p, track.id).map((c) => clipEndTick(c, p)));
    const bar = ticksPerBar(p.meter);
    return Math.ceil(end / bar) * bar;
  };

  const overlapWarning = (track: Track, startTick: number, endTick: number, ignore?: ClipId) => {
    const p = project();
    const overlaps = clipsOnTrack(p, track.id).filter(
      (c) => c.id !== ignore && c.startTick < endTick && clipEndTick(c, p) > startTick,
    );
    return overlaps.length > 0
      ? {
          warning: `Overlaps ${overlaps.map((c) => `"${c.name}" (${c.id})`).join(', ')} on the same track; both will play.`,
        }
      : {};
  };

  const withIds = (notes: readonly RawNote[]): MidiNote[] =>
    notes
      .filter((n) => n.pitch >= 0 && n.pitch <= 127)
      .map((n) => ({ ...n, id: session.ids.create('note') }));

  /** Creates a MIDI clip with notes as one undo entry and shows it in the editor. */
  const createClip = (
    track: Track,
    startBar: number | undefined,
    lengthBars: number | undefined,
    notes: readonly RawNote[],
    name: string | undefined,
    label: string,
  ) => {
    const meter = project().meter;
    const barTicks = ticksPerBar(meter);
    const startTick = startBar !== undefined ? barToTick(startBar, meter) : nextFreeTick(track);
    const contentEnd = Math.max(0, ...notes.map((n) => n.startTick + n.durationTicks));
    let lengthTicks: number;
    if (lengthBars !== undefined) {
      lengthTicks = Math.round(lengthBars * barTicks);
      const lastStart = Math.max(-1, ...notes.map((n) => n.startTick));
      if (lastStart >= lengthTicks)
        fail(
          `Some notes start after the clip ends (clip is ${lengthBars} bars = ${lengthBars * meter.numerator} beats or ${lengthTicks / STEP_TICKS} steps). Increase lengthBars or move the notes.`,
        );
    } else {
      lengthTicks = Math.max(1, Math.ceil(contentEnd / barTicks)) * barTicks;
    }
    const id = session.ids.create('clip');
    const clip = createMidiClip({
      id,
      trackId: track.id,
      startTick,
      lengthTicks,
      name: name?.trim() || track.name,
      notes: withIds(notes),
    });
    const warning = overlapWarning(track, startTick, startTick + lengthTicks);
    executeEdit(session, [{ type: 'clip.add', clips: [clip] }], label);
    session.uiStore.setState((s) =>
      openClipInEditor(selectClips(selectTrack(s, track.id), [id]), id),
    );
    return { clip: summarizeClip(history.present.clips[id]!, history.present), ...warning };
  };

  /** Clip end extension needed so `notes` (content ticks) are visible; null if none. */
  const extendCommand = (clip: MidiClip, notes: readonly RawNote[]): Command | null => {
    if (clip.loopLengthTicks !== undefined) return null;
    const contentEnd = Math.max(0, ...notes.map((n) => n.startTick + n.durationTicks));
    const visibleEnd = clip.contentOffsetTicks + clip.lengthTicks;
    if (contentEnd <= visibleEnd) return null;
    const barTicks = ticksPerBar(project().meter);
    const newLength = Math.ceil((contentEnd - clip.contentOffsetTicks) / barTicks) * barTicks;
    return { type: 'clip.trimEnd', clipId: clip.id, endTick: clip.startTick + newLength };
  };

  const toContent = (clip: MidiClip, notes: readonly RawNote[]): RawNote[] =>
    notes.map((n) => ({ ...n, startTick: n.startTick + clip.contentOffsetTicks }));

  return registerAll(registry, [
    defineTool<{
      trackId: string;
      startBar?: number;
      lengthBars?: number;
      name?: string;
      notes?: NoteInput[];
    }>({
      name: 'create_midi_clip',
      title: 'Create MIDI clip',
      description:
        'Creates a MIDI clip on an instrument track, optionally filled with notes (melodies, bass lines, chords, beats), and opens it in the piano roll. Positions are 0-based beats or 16th steps from the clip start. Without lengthBars the clip is sized to fit the notes (whole bars); without startBar it goes after the last clip on the track. Returns the clip id.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Instrument track id or exact name.' },
          startBar: {
            type: 'number',
            minimum: 1,
            description: '1-based bar where the clip starts.',
          },
          lengthBars: { type: 'number', minimum: 0.25, maximum: 512 },
          name: { type: 'string' },
          notes: NOTES_SCHEMA,
        },
        required: ['trackId'],
      },
      run: ({ trackId, startBar, lengthBars, name, notes }) => {
        const track = resolveInstrumentTrack(session, trackId);
        const parsed = parseNotes(notes ?? [], project().meter);
        return createClip(track, startBar, lengthBars, parsed, name, 'Create MIDI Clip');
      },
    }),
    defineTool<{ clipId: string; notes: NoteInput[] }>({
      name: 'add_notes',
      title: 'Add notes',
      description:
        'Adds notes to an existing MIDI clip (positions are 0-based beats or 16th steps from the clip start). The clip grows to whole bars if notes go past its end.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string' }, notes: { ...NOTES_SCHEMA, minItems: 1 } },
        required: ['clipId', 'notes'],
      },
      run: ({ clipId, notes }) => {
        const clip = resolveMidiClip(session, clipId);
        const parsed = toContent(clip, parseNotes(notes, project().meter));
        const commands: Command[] = [
          { type: 'notes.add', clipId: clip.id, notes: withIds(parsed) },
        ];
        const extend = extendCommand(clip, parsed);
        if (extend) commands.push(extend);
        executeEdit(session, commands, `Add ${parsed.length} Notes`);
        return {
          clip: summarizeClip(history.present.clips[clip.id]!, history.present),
          added: parsed.length,
        };
      },
    }),
    defineTool<{ clipId: string; notes: NoteInput[] }>({
      name: 'replace_notes',
      title: 'Replace notes',
      description:
        'Replaces all notes of a MIDI clip with new ones (to rewrite a melody, beat or chord part). The previous notes are removed; the user can Undo.',
      inputSchema: {
        type: 'object',
        properties: { clipId: { type: 'string' }, notes: NOTES_SCHEMA },
        required: ['clipId', 'notes'],
      },
      run: ({ clipId, notes }) => {
        const clip = resolveMidiClip(session, clipId);
        const parsed = toContent(clip, parseNotes(notes, project().meter));
        const commands: Command[] = [];
        if (clip.notes.length > 0)
          commands.push({
            type: 'notes.remove',
            clipId: clip.id,
            noteIds: clip.notes.map((n) => n.id),
          });
        if (parsed.length > 0)
          commands.push({ type: 'notes.add', clipId: clip.id, notes: withIds(parsed) });
        const extend = extendCommand(clip, parsed);
        if (extend) commands.push(extend);
        if (commands.length === 0)
          return { clip: summarizeClip(clip, project()), replaced: 0, added: 0 };
        executeEdit(session, commands, 'Replace Notes');
        return {
          clip: summarizeClip(history.present.clips[clip.id]!, history.present),
          removed: clip.notes.length,
          added: parsed.length,
        };
      },
    }),
    defineTool<{
      trackId: string;
      chords: string[];
      startBar?: number;
      beatsPerChord?: number;
      rhythm?: string;
      octave?: number;
      bass?: boolean;
      velocity?: number;
      repeat?: number;
      name?: string;
    }>({
      name: 'add_chord_progression',
      title: 'Add chord progression',
      description:
        'Creates a MIDI clip with a chord progression from chord symbols (e.g. ["Am","F","C","G"], "G7", "Cmaj7", "Dm7", "Esus4", "D/F#"), voiced smoothly around the chosen octave. Rhythms: sustain (held chords), quarters, eighths, offbeat (house-style stabs on the "and"), arpeggio (16th-note broken chords). Returns the clip id.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Instrument (synth) track id or exact name.' },
          chords: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
          startBar: { type: 'number', minimum: 1 },
          beatsPerChord: {
            type: 'number',
            minimum: 0.5,
            maximum: 32,
            description: 'Default: one bar per chord.',
          },
          rhythm: { type: 'string', enum: RHYTHMS, description: 'Default "sustain".' },
          octave: {
            type: 'integer',
            minimum: 1,
            maximum: 7,
            description: 'Chord register; default 4 (around middle C).',
          },
          bass: {
            type: 'boolean',
            description: 'Also play each chord root two octaves lower. Default false.',
          },
          velocity: { type: 'integer', minimum: 1, maximum: 127, description: 'Default 90.' },
          repeat: {
            type: 'integer',
            minimum: 1,
            maximum: 16,
            description: 'Times to play the progression. Default 1.',
          },
          name: { type: 'string' },
        },
        required: ['trackId', 'chords'],
      },
      run: (input) => {
        const track = resolveInstrumentTrack(session, input.trackId);
        const meter = project().meter;
        const beat = ticksPerBeat(meter);
        const parsed = input.chords.map(parseChord);
        const span = Math.round((input.beatsPerChord ?? meter.numerator) * beat);
        const rhythm: Rhythm = (input.rhythm as Rhythm | undefined) ?? 'sustain';
        const octave = input.octave ?? 4;
        const center = (octave + 1) * 12 + 4;
        const velocity = input.velocity ?? 90;
        const notes: RawNote[] = [];
        const voiced: string[] = [];
        let previous = center;
        const repeat = input.repeat ?? 1;
        parsed.forEach((chord, index) => {
          const pitches = voiceChord(chord, (previous + center) / 2);
          previous = pitches.reduce((a, b) => a + b, 0) / Math.max(1, pitches.length);
          voiced.push(`${chord.symbol}: ${pitches.map(noteName).join(' ')}`);
          for (let r = 0; r < repeat; r++) {
            const t0 = (r * parsed.length + index) * span;
            const hit = (
              start: number,
              length: number,
              list: readonly number[],
              vel = velocity,
            ) => {
              for (const pitch of list)
                notes.push({ pitch, velocity: vel, startTick: t0 + start, durationTicks: length });
            };
            switch (rhythm) {
              case 'sustain':
                hit(0, span, pitches);
                break;
              case 'quarters':
                for (let t = 0; t < span; t += beat)
                  hit(t, Math.min(beat, span - t) * 0.9, pitches);
                break;
              case 'eighths':
                for (let t = 0; t < span; t += beat / 2)
                  hit(t, Math.min(beat / 2, span - t) * 0.9, pitches);
                break;
              case 'offbeat':
                for (let t = beat / 2; t < span; t += beat)
                  hit(t, Math.min(beat / 2, span - t) * 0.9, pitches);
                break;
              case 'arpeggio': {
                let i = 0;
                for (let t = 0; t < span; t += STEP_TICKS, i++) {
                  hit(
                    t,
                    Math.min(STEP_TICKS, span - t),
                    [pitches[i % pitches.length]!],
                    i % 4 === 0 ? velocity : Math.round(velocity * 0.8),
                  );
                }
                break;
              }
            }
            if (input.bass) {
              hit(0, span, [(octave - 1) * 12 + chord.bass], Math.min(127, velocity + 5));
            }
          }
        });
        const rounded = notes.map((n) => ({
          ...n,
          durationTicks: Math.max(1, Math.round(n.durationTicks)),
        }));
        const totalBars = (span * parsed.length * repeat) / ticksPerBar(meter);
        const result = createClip(
          track,
          input.startBar,
          Math.max(totalBars, 0.25),
          rounded,
          input.name ?? 'Chords',
          'Add Chord Progression',
        );
        return { ...result, chords: voiced };
      },
    }),
    defineTool<{
      trackId: string;
      pattern: Record<string, unknown>;
      startBar?: number;
      bars?: number;
      swing?: number;
      name?: string;
    }>({
      name: 'add_drum_pattern',
      title: 'Add drum pattern',
      description:
        'Creates a drum clip on a drums track from step patterns: one string per voice, one character per 16th step ("x" hit, "X" accent, "o" ghost, "-" or "." rest; spaces and "|" are ignored). Patterns repeat to fill the clip. Voices: kick, snare, clap, rim, closedHat, openHat, lowTom, midTom, highTom, crash, cowbell. Example 4-on-the-floor bar: {"kick":"x---x---x---x---","clap":"----x-------x---","closedHat":"--x---x---x---x-"}.',
      inputSchema: {
        type: 'object',
        properties: {
          trackId: { type: 'string', description: 'Drums track id or exact name.' },
          pattern: { type: 'object', description: 'Map of voice name → step string.' },
          startBar: { type: 'number', minimum: 1 },
          bars: {
            type: 'integer',
            minimum: 1,
            maximum: 64,
            description: 'Clip length; default fits the longest pattern.',
          },
          swing: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Delays every second 16th (0 = straight). Default 0.',
          },
          name: { type: 'string' },
        },
        required: ['trackId', 'pattern'],
      },
      run: ({ trackId, pattern, startBar, bars, swing, name }) => {
        const track = resolveInstrumentTrack(session, trackId);
        if (track.instrument?.kind !== 'drums')
          fail(
            `Track "${track.name}" plays a ${track.instrument?.kind ?? 'non-drum'} instrument. Drum patterns need a drums track: call add_track with instrument "drums" (or set_instrument_params with instrument "drums").`,
          );
        const meter = project().meter;
        const stepsPerBar = Math.round(ticksPerBar(meter) / STEP_TICKS);
        const lanes: Array<{ pitch: number; steps: string }> = [];
        for (const [voice, raw] of Object.entries(pattern)) {
          if (typeof raw !== 'string') fail(`pattern.${voice} must be a string like "x---x---".`);
          const steps = raw.replace(/[\s|]/g, '');
          if (steps.length === 0) continue;
          const bad = /[^xXo.\-_]/.exec(steps);
          if (bad)
            fail(`pattern.${voice} has an invalid character "${bad[0]}"; use x, X, o, - or .`);
          const pitch = /^\d+$/.test(voice)
            ? parsePitch(Number(voice), `pattern.${voice}`)
            : resolveDrumVoice(voice);
          lanes.push({ pitch, steps });
        }
        if (lanes.length === 0) fail('The pattern is empty; give at least one voice with hits.');
        const longest = Math.max(...lanes.map((l) => l.steps.length));
        const totalBars = bars ?? Math.max(1, Math.ceil(longest / stepsPerBar));
        const totalSteps = totalBars * stepsPerBar;
        const swingTicks = Math.round((STEP_TICKS * (swing ?? 0)) / 2);
        const notes: RawNote[] = [];
        for (const lane of lanes) {
          for (let s = 0; s < totalSteps; s++) {
            const ch = lane.steps[s % lane.steps.length]!;
            const velocity = ch === 'X' ? 120 : ch === 'x' ? 100 : ch === 'o' ? 60 : 0;
            if (velocity === 0) continue;
            notes.push({
              pitch: lane.pitch,
              velocity,
              startTick: s * STEP_TICKS + (s % 2 === 1 ? swingTicks : 0),
              durationTicks: STEP_TICKS,
            });
          }
        }
        return createClip(track, startBar, totalBars, notes, name ?? 'Beat', 'Add Drum Pattern');
      },
    }),
    defineTool<{
      clipId: string;
      grid?: string;
      strength?: number;
      swing?: number;
      quantizeEnds?: boolean;
    }>({
      name: 'quantize_notes',
      title: 'Quantize',
      description:
        'Snaps the notes of a MIDI clip to a grid (e.g. "1/16", "1/8", "1/8T"), with optional strength and swing.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          grid: { type: 'string', enum: GRID_DIVISIONS, description: 'Default "1/16".' },
          strength: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '1 = fully on grid (default).',
          },
          swing: { type: 'number', minimum: 0, maximum: 1, description: 'Default 0.' },
          quantizeEnds: { type: 'boolean', description: 'Also snap note ends. Default false.' },
        },
        required: ['clipId'],
      },
      run: ({ clipId, grid, strength, swing, quantizeEnds }) => {
        const clip = resolveMidiClip(session, clipId);
        if (clip.notes.length === 0) fail(`Clip "${clip.name}" has no notes to quantize.`);
        const division = (grid ?? '1/16') as GridDivision;
        executeEdit(
          session,
          [
            {
              type: 'notes.quantize',
              clipId: clip.id,
              noteIds: clip.notes.map((n) => n.id),
              options: {
                gridTicks: gridDivisionTicks(division, project().meter),
                strength: strength ?? 1,
                ...(swing ? { swing } : {}),
                ...(quantizeEnds ? { quantizeEnds } : {}),
              },
            },
          ],
          'Quantize',
        );
        return {
          clip: summarizeClip(history.present.clips[clip.id]!, history.present),
          grid: division,
        };
      },
    }),
    defineTool<{ clipId: string; semitones: number; noteIds?: string[] }>({
      name: 'transpose_notes',
      title: 'Transpose',
      description:
        'Shifts the pitch of all notes in a MIDI clip (or the given note ids) by semitones (12 = one octave up).',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          semitones: { type: 'integer', minimum: -48, maximum: 48 },
          noteIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional subset (from get_clip_notes).',
          },
        },
        required: ['clipId', 'semitones'],
      },
      run: ({ clipId, semitones, noteIds }) => {
        const clip = resolveMidiClip(session, clipId);
        const wanted = noteIds ? new Set(noteIds) : null;
        const targets = clip.notes.filter((n) => !wanted || wanted.has(n.id));
        if (targets.length === 0) fail('No matching notes to transpose.');
        const outOfRange = targets.filter(
          (n) => n.pitch + semitones < 0 || n.pitch + semitones > 127,
        );
        if (outOfRange.length > 0)
          fail(`${outOfRange.length} notes would leave the MIDI range 0-127; use a smaller shift.`);
        if (semitones === 0) return { clip: summarizeClip(clip, project()), transposed: 0 };
        executeEdit(
          session,
          [
            {
              type: 'notes.update',
              clipId: clip.id,
              patches: targets.map((n) => ({ id: n.id, pitch: n.pitch + semitones })),
            },
          ],
          'Transpose',
        );
        return {
          clip: summarizeClip(history.present.clips[clip.id]!, history.present),
          transposed: targets.length,
          semitones,
        };
      },
    }),
    defineTool<{ clipId: string; startBar: number; trackId?: string }>({
      name: 'move_clip',
      title: 'Move clip',
      description:
        'Moves a clip to a new start bar (1-based) and optionally to another compatible track.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          startBar: { type: 'number', minimum: 1 },
          trackId: { type: 'string', description: 'Destination track id or exact name.' },
        },
        required: ['clipId', 'startBar'],
      },
      run: ({ clipId, startBar, trackId }) => {
        const clip = resolveClip(session, clipId);
        const meter = project().meter;
        const destination = trackId ? resolveTrackForClip(session, trackId, clip) : undefined;
        executeEdit(
          session,
          [
            {
              type: 'clip.move',
              moves: [
                {
                  clipId: clip.id,
                  startTick: barToTick(startBar, meter),
                  ...(destination ? { trackId: destination.id } : {}),
                },
              ],
            },
          ],
          'Move Clip',
        );
        return { clip: summarizeClip(history.present.clips[clip.id]!, history.present) };
      },
    }),
    defineTool<{ clipId: string; times?: number }>({
      name: 'duplicate_clip',
      title: 'Duplicate clip',
      description:
        'Repeats a clip right after itself `times` times (default 1) on the same track, e.g. to extend a 1-bar beat to 4 bars.',
      inputSchema: {
        type: 'object',
        properties: {
          clipId: { type: 'string' },
          times: { type: 'integer', minimum: 1, maximum: 64 },
        },
        required: ['clipId'],
      },
      run: ({ clipId, times }) => {
        const clip = resolveClip(session, clipId);
        const p = project();
        const length = Math.round(clipLengthTicks(clip, p));
        const copies: Clip[] = [];
        for (let i = 1; i <= (times ?? 1); i++) {
          copies.push({
            ...clip,
            id: session.ids.create('clip'),
            startTick: clip.startTick + i * length,
          });
        }
        executeEdit(session, [{ type: 'clip.add', clips: copies }], 'Duplicate');
        session.uiStore.setState((s) =>
          selectClips(
            s,
            copies.map((c) => c.id),
          ),
        );
        return {
          copies: copies.map((c) => ({ id: c.id, startBar: tickToBar(c.startTick, p.meter) })),
        };
      },
    }),
    defineTool<{ clipIds: string[] }>({
      name: 'delete_clips',
      title: 'Delete clips',
      description:
        'Deletes clips (destructive; the user can Undo). Tell the user which clips were deleted.',
      inputSchema: {
        type: 'object',
        properties: { clipIds: { type: 'array', minItems: 1, items: { type: 'string' } } },
        required: ['clipIds'],
      },
      run: ({ clipIds }) => {
        const clips = clipIds.map((id) => resolveClip(session, id));
        const ids = [...new Set(clips.map((c) => c.id))];
        executeEdit(
          session,
          [{ type: 'clip.remove', clipIds: ids }],
          ids.length === 1 ? 'Delete Clip' : `Delete ${ids.length} Clips`,
        );
        session.uiStore.setState((s) => selectClips(s, []));
        return {
          deleted: clips.map((c) => ({ id: c.id, name: c.name, trackId: c.trackId })),
          undoable: true,
        };
      },
    }),
  ]);
}

function resolveTrackForClip(session: StudioSession, ref: string, clip: Clip): Track {
  const track = resolveTrack(session, ref);
  const accepts = clip.kind === 'midi' ? track.kind === 'instrument' : track.kind !== 'instrument';
  if (!accepts)
    fail(
      clip.kind === 'midi'
        ? `MIDI clips can only move to instrument tracks; "${track.name}" is an ${track.kind} track.`
        : `Audio clips cannot move to the instrument track "${track.name}".`,
    );
  return track;
}
