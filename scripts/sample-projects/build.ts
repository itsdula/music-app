/**
 * Builds the sample projects in `projects/<genre>/<nn-slug>/song.json` into importable
 * `.studio` bundles next to each spec, validating everything on the way.
 *
 *   pnpm samples                       build every song
 *   pnpm samples -- projects/edm/01-x  build (and validate) only the given folder(s)
 *   pnpm samples -- --check            validate without writing bundles
 *
 * Song spec (all times in 16th-note steps, 4/4):
 * {
 *   "title": "Neon Rush", "genre": "edm", "bpm": 128,
 *   "key": { "tonic": 9, "scale": "naturalMinor" },        // tonic: 0 = C … 11 = B
 *   "bars": 32,                                            // song length (sets the loop)
 *   "master": { "gainDb": 0, "effects": [] },              // optional
 *   "tracks": [{
 *     "name": "Drums", "instrument": "drums",              // "drums" | "synth"
 *     "preset": "synth.bass",                              // synth only, optional
 *     "params": { "cutoffHz": 900 },                       // instrument param overrides
 *     "gainDb": -3, "pan": 0,                              // mixer, optional
 *     "effects": [{ "kind": "reverb", "params": { "mix": 0.2 } }],
 *     "clips": [{
 *       "name": "Beat", "startBar": 0, "lengthBars": 8,
 *       "loopBars": 1,                                     // optional: repeat the notes
 *       "notes": [[0, 36, 1, 110], [4, 38, 1, 100]]        // [step, pitch, steps, velocity]
 *     }]
 *   }]
 * }
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { GM_DRUM_MAP } from '@studio/audio-dsp';
import {
  EFFECT_KINDS,
  EFFECT_PARAM_SPECS,
  INSTRUMENT_PARAM_SPECS,
  PPQ,
  SCALES,
  SYNTH_PRESETS,
  createEffectSlot,
  createEmptyProject,
  createInstrumentConfig,
  createMidiClip,
  createSequentialIdFactory,
  createTrack,
  type EffectKind,
  type MidiClip,
  type ParamSpec,
  type Project,
  type Track,
} from '@studio/domain';
import { exportProjectBundle, validateProjectForSave } from '@studio/project-storage';

const GENRES = ['edm', 'rock', 'rap', 'house', 'pop', 'techno'] as const;
const STEP = PPQ / 4;
const STEPS_PER_BAR = 16;

interface NoteSpec extends Array<number> {
  0: number;
  1: number;
  2: number;
  3: number;
}
interface ClipSpec {
  name?: string;
  startBar: number;
  lengthBars: number;
  loopBars?: number;
  notes: NoteSpec[];
}
interface EffectSpec {
  kind: string;
  params?: Record<string, number>;
  bypass?: boolean;
}
interface TrackSpec {
  name: string;
  instrument: 'drums' | 'synth';
  preset?: string;
  params?: Record<string, number>;
  gainDb?: number;
  pan?: number;
  effects?: EffectSpec[];
  clips: ClipSpec[];
}
interface SongSpec {
  title: string;
  genre: string;
  bpm: number;
  key?: { tonic: number; scale: string };
  bars: number;
  master?: { gainDb?: number; effects?: EffectSpec[] };
  tracks: TrackSpec[];
}

class SpecError extends Error {}

function fail(where: string, message: string): never {
  throw new SpecError(`${where}: ${message}`);
}

function checkParams(
  where: string,
  specs: readonly ParamSpec[],
  params: Record<string, number> = {},
) {
  for (const [id, value] of Object.entries(params)) {
    const spec = specs.find((s) => s.id === id);
    if (!spec) fail(where, `unknown param "${id}" (known: ${specs.map((s) => s.id).join(', ')})`);
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < spec.min ||
      value > spec.max
    ) {
      fail(where, `param "${id}" = ${String(value)} is outside ${spec.min}..${spec.max}`);
    }
  }
}

function buildEffects(
  where: string,
  list: EffectSpec[] = [],
  ids: ReturnType<typeof createSequentialIdFactory>,
) {
  return list.map((e, i) => {
    const at = `${where}.effects[${i}]`;
    if (!EFFECT_KINDS.includes(e.kind as EffectKind)) {
      fail(at, `unknown effect "${e.kind}" (known: ${EFFECT_KINDS.join(', ')})`);
    }
    const kind = e.kind as EffectKind;
    checkParams(at, EFFECT_PARAM_SPECS[kind], e.params);
    const slot = createEffectSlot(ids.create('effect'), kind);
    return { ...slot, bypass: e.bypass ?? false, params: { ...slot.params, ...e.params } };
  });
}

export function songToProject(song: SongSpec, where: string): Project {
  const ids = createSequentialIdFactory();
  if (!song.title || typeof song.title !== 'string') fail(where, 'missing title');
  if (!GENRES.includes(song.genre as (typeof GENRES)[number]))
    fail(where, `genre must be one of ${GENRES.join(', ')}`);
  if (!(song.bpm >= 40 && song.bpm <= 220)) fail(where, 'bpm must be 40..220');
  if (!Number.isInteger(song.bars) || song.bars < 4 || song.bars > 128)
    fail(where, 'bars must be an integer 4..128');
  if (
    song.key &&
    (!(song.key.scale in SCALES) ||
      !Number.isInteger(song.key.tonic) ||
      song.key.tonic < 0 ||
      song.key.tonic > 11)
  ) {
    fail(where, `key must be { tonic: 0..11, scale: ${Object.keys(SCALES).join('|')} }`);
  }
  if (!Array.isArray(song.tracks) || song.tracks.length < 2 || song.tracks.length > 12)
    fail(where, 'need 2..12 tracks');

  const base = createEmptyProject({
    id: ids.create('project'),
    name: song.title,
    now: '2026-10-29T00:00:00.000Z',
    bpm: song.bpm,
  });
  const songTicks = song.bars * STEPS_PER_BAR * STEP;
  const tracks: Record<string, Track> = {};
  const clips: Record<string, MidiClip> = {};
  const order: Track['id'][] = [];

  song.tracks.forEach((t, ti) => {
    const at = `${where}.tracks[${ti}] "${t.name}"`;
    if (t.instrument !== 'drums' && t.instrument !== 'synth')
      fail(at, 'instrument must be "drums" or "synth"');
    if (t.preset && !SYNTH_PRESETS.some((p) => p.id === t.preset && p.kind === t.instrument)) {
      fail(
        at,
        `unknown preset "${t.preset}" (synth presets: ${SYNTH_PRESETS.map((p) => p.id).join(', ')})`,
      );
    }
    checkParams(at, INSTRUMENT_PARAM_SPECS[t.instrument], t.params);
    const instrument = createInstrumentConfig(t.instrument, t.preset);
    const trackId = ids.create('track');
    const track = createTrack({
      id: trackId,
      kind: 'instrument',
      index: ti,
      name: t.name,
      instrument: { ...instrument, params: { ...instrument.params, ...t.params } },
    });
    if (t.gainDb !== undefined && !(t.gainDb >= -60 && t.gainDb <= 6))
      fail(at, 'gainDb must be -60..6');
    if (t.pan !== undefined && !(t.pan >= -1 && t.pan <= 1)) fail(at, 'pan must be -1..1');
    tracks[trackId] = {
      ...track,
      mixer: { ...track.mixer, gainDb: t.gainDb ?? track.mixer.gainDb, pan: t.pan ?? 0 },
      effects: buildEffects(at, t.effects, ids),
    };
    order.push(trackId);

    if (!Array.isArray(t.clips) || t.clips.length === 0) fail(at, 'needs at least one clip');
    t.clips.forEach((c, ci) => {
      const cat = `${at}.clips[${ci}]`;
      const start = c.startBar * STEPS_PER_BAR * STEP;
      const length = c.lengthBars * STEPS_PER_BAR * STEP;
      if (!(
        Number.isInteger(c.startBar) &&
        c.startBar >= 0 &&
        Number.isInteger(c.lengthBars) &&
        c.lengthBars >= 1
      )) {
        fail(cat, 'startBar/lengthBars must be integers (>= 0 / >= 1)');
      }
      if (start + length > songTicks) fail(cat, `ends after bar ${song.bars}`);
      const contentSteps = (c.loopBars ?? c.lengthBars) * STEPS_PER_BAR;
      if (
        c.loopBars !== undefined &&
        !(Number.isInteger(c.loopBars) && c.loopBars >= 1 && c.loopBars <= c.lengthBars)
      ) {
        fail(cat, 'loopBars must be an integer 1..lengthBars');
      }
      if (!Array.isArray(c.notes) || c.notes.length === 0) fail(cat, 'needs notes');
      const notes = c.notes.map((n, ni) => {
        const nat = `${cat}.notes[${ni}]`;
        if (!Array.isArray(n) || n.length !== 4 || n.some((v) => typeof v !== 'number'))
          fail(nat, 'must be [step, pitch, steps, velocity]');
        const [step, pitch, steps, velocity] = n;
        if (!(step >= 0 && step < contentSteps))
          fail(nat, `step ${step} outside 0..${contentSteps - 1}`);
        if (!(steps > 0 && step + steps <= contentSteps + 0.0001))
          fail(nat, `length ${steps} runs past the clip/loop end`);
        if (!(Number.isInteger(pitch) && pitch >= 0 && pitch <= 127))
          fail(nat, 'pitch must be 0..127');
        if (t.instrument === 'drums' && GM_DRUM_MAP[pitch] === undefined) {
          fail(
            nat,
            `drum pitch ${pitch} is not mapped (use ${Object.keys(GM_DRUM_MAP).join(', ')})`,
          );
        }
        if (!(Number.isInteger(velocity) && velocity >= 1 && velocity <= 127))
          fail(nat, 'velocity must be 1..127');
        return {
          id: ids.create('note'),
          startTick: Math.round(step * STEP),
          durationTicks: Math.round(steps * STEP),
          pitch,
          velocity,
        };
      });
      notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
      const clip = createMidiClip({
        id: ids.create('clip'),
        trackId,
        startTick: start,
        lengthTicks: length,
        name: c.name ?? t.name,
        notes,
      });
      clips[clip.id] =
        c.loopBars !== undefined
          ? { ...clip, loopLengthTicks: c.loopBars * STEPS_PER_BAR * STEP }
          : clip;
    });
  });

  const project: Project = {
    ...base,
    trackOrder: order,
    tracks,
    clips,
    loop: { enabled: false, startTick: 0, endTick: songTicks },
    master: {
      gainDb: song.master?.gainDb ?? 0,
      effects: buildEffects(`${where}.master`, song.master?.effects, ids),
    },
  };
  return validateProjectForSave(project);
}

function songDirs(root: string, only: string[]): string[] {
  if (only.length > 0) return only.map((p) => resolve(p));
  const dirs: string[] = [];
  for (const genre of GENRES) {
    const g = join(root, genre);
    if (!existsSync(g)) continue;
    for (const name of readdirSync(g).sort()) {
      const d = join(g, name);
      if (statSync(d).isDirectory() && existsSync(join(d, 'song.json'))) dirs.push(d);
    }
  }
  return dirs;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const check = args.includes('--check');
  const root = join(process.cwd(), 'projects');
  const dirs = songDirs(
    root,
    args.filter((a) => !a.startsWith('--')),
  );
  const sha256 = (bytes: Uint8Array) =>
    Promise.resolve(createHash('sha256').update(bytes).digest('hex'));
  let failures = 0;
  for (const dir of dirs) {
    const where = relative(process.cwd(), dir) || dir;
    try {
      const song = JSON.parse(readFileSync(join(dir, 'song.json'), 'utf8')) as SongSpec;
      const project = songToProject(song, where);
      const notes = Object.values(project.clips).reduce(
        (n, c) => n + (c.kind === 'midi' ? c.notes.length : 0),
        0,
      );
      if (!check) {
        const bytes = await exportProjectBundle({ project, assets: [] }, { sha256 });
        writeFileSync(join(dir, `${basename(dir)}.studio`), bytes);
      }
      process.stdout.write(
        `ok   ${where}  (${song.bpm} BPM, ${song.bars} bars, ${project.trackOrder.length} tracks, ${notes} notes)\n`,
      );
    } catch (error) {
      failures++;
      process.stderr.write(
        `FAIL ${where}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  process.stdout.write(
    `${dirs.length - failures}/${dirs.length} songs valid${check ? '' : ', bundles written'}\n`,
  );
  if (failures > 0 || dirs.length === 0) process.exitCode = 1;
}

await main();
