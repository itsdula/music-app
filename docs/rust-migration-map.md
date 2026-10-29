# Rust migration map

The Rust path is a **function-by-function, contract-preserving port**, never a rewrite.
Only class A (portable) code is in scope; React components, Next routing and browser
adapters are never ported. Each entry keeps its TypeScript implementation until the Rust
implementation passes the same golden fixtures and contract suites.

## Rules

- Inputs/outputs are plain data: numbers, strings, plain objects, and planar `Float32Array`
  PCM (`PcmAudio`: one array per channel, equal lengths, nominal [-1, 1], integer Hz).
- No closures, browser handles, React state or Web Audio objects cross a port boundary.
- High-throughput paths use typed arrays with explicit **transfer** semantics (ownership
  moves; the sender must not reuse the buffer). JSON is never used per-sample.
- Real-time audio callbacks stay native (cpal) in a Rust backend; Tauri IPC/events carry
  commands, state and bulk PCM (imports, renders), not per-callback audio.
- Determinism: integer logic must match exactly; float DSP matches within documented
  tolerances (JS `Math.sin/exp/pow` are not bit-specified).

## Port interfaces (TypeScript today, Rust later)

```ts
interface AudioEngine {
  /* packages/audio-contracts/src/engine.ts */
} // backend port
interface VocalProcessor {
  analyze(pcm, params, opts);
  render(req, opts);
} // vocal-dsp/src/types.ts
interface WaveformAnalyzer {
  buildPyramid(pcm): PeakPyramid;
} // audio-dsp
interface PitchAnalyzer {
  trackPitch(mono, sampleRate, params): PitchTrack;
} // vocal-dsp stage
interface PitchCorrector {
  render(pcm, analysis, doc, quality): PcmAudio;
} // vocal-dsp stage
interface MidiCodec {
  parse(bytes): Result<MidiMessage>;
  encode(msg): Uint8Array;
} // midi-core
```

### Example: swapping one function for Rust/WASM without touching callers

```ts
// packages/vocal-dsp/src/pitch/index.ts — the only place that knows the implementation
import { trackPitchTs } from './pyin';
let impl: typeof trackPitchTs = trackPitchTs;

/** Called once at startup by a host that has loaded the WASM module. */
export function useNativePitchTracker(wasm: {
  track_pitch(m: Float32Array, sr: number, p: string): PitchTrackWire;
}) {
  impl = (mono, sampleRate, params) =>
    fromWire(wasm.track_pitch(mono, sampleRate, JSON.stringify(params)));
}

export const trackPitch: typeof trackPitchTs = (mono, sampleRate, params, hooks) =>
  impl(mono, sampleRate, params, hooks);
// Callers (analyzeVocal, workers, tests) keep calling trackPitch(...) unchanged.
// CI runs the same golden fixtures against both implementations (contract test).
```

## Registry

Status values: `ts` (TypeScript only) · `fixtures` (golden fixtures ready) · `rust-wip` ·
`rust-parity` (passes contracts) · `rust-default`.

| Package         | Exported function                                                    | Input → output contract                      | TS implementation              | Target crate/module                            | Fixtures                                | Perf baseline     | Risk                            | Status |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------- | ------------------------------ | ---------------------------------------------- | --------------------------------------- | ----------------- | ------------------------------- | ------ |
| domain          | `ticksToSeconds`, `secondsToTicks`, `ticksToFrames`, `framesToTicks` | numbers (ticks int, seconds f64, frames int) | `domain/src/time.ts`           | `studio_time`                                  | property tests (exact for ints)         | trivial           | low                             | ts     |
| domain          | `gridDivisionTicks`, `snapTick`, `quantizeTick`                      | ints → int                                   | `domain/src/grid.ts`           | `studio_time::grid`                            | unit tests (exact)                      | trivial           | low                             | ts     |
| domain          | `expandMidiClipNotes`                                                | MidiClip → ExpandedNote[] (sorted)           | `domain/src/selectors.ts`      | `studio_model::clips`                          | unit/property (exact)                   | O(n·loops)        | low                             | ts     |
| domain          | `nearestScaleNote`, `frequencyToMidi`                                | f64 → f64                                    | `domain/src/theory.ts`         | `studio_theory`                                | unit (1e-9)                             | trivial           | low                             | ts     |
| commands        | `applyCommand`                                                       | Project × Command → Project (JSON)           | `commands/src/apply/*`         | `studio_model::commands`                       | model-based sequences (exact JSON)      | per command       | medium (immutability semantics) | ts     |
| engine-core     | `diffProjects`                                                       | Project × Project → AudioGraphChange[]       | `engine-core/src/diff.ts`      | `studio_engine::diff`                          | exact                                   | O(entities)       | low                             | ts     |
| engine-core     | transport clock, window planning, timeline index queries             | ticks/seconds → segments/events              | `engine-core/src/*`            | `studio_engine::schedule`                      | exact tick fixtures                     | O(log n + k)      | medium (loop edges)             | ts     |
| audio-dsp       | `encodeWav` / `decodeWav`                                            | PcmAudio ↔ bytes                             | `audio-dsp/src/wav.ts`         | `studio_dsp::wav` (or `hound`)                 | golden WAV files (exact for PCM)        | O(n)              | low                             | ts     |
| audio-dsp       | `buildPeakPyramid`, `readPeaks`                                      | PcmAudio → PeakPyramid (f32 arrays)          | `audio-dsp/src/peaks.ts`       | `studio_dsp::peaks`                            | exact min/max                           | O(n)              | low                             | ts     |
| audio-dsp       | `synthesizeDrumVoice`, `generateReverbImpulse`                       | params + seed → f32                          | `audio-dsp/src/*`              | `studio_dsp::synth`                            | tolerance 1e-6                          | O(n)              | low                             | ts     |
| vocal-dsp       | `trackPitch` (pYIN)                                                  | mono f32 + sr + params → PitchTrack          | `vocal-dsp/src/pitch/*`        | `studio_vocal::pitch` (ref: `pyin` crate, MIT) | synthetic f0 fixtures (cents tolerance) | ≤ 0.15× RT (Node) | medium                          | ts     |
| vocal-dsp       | `segmentNotes`, `analyzeNoteExpression`                              | PitchTrack → segments                        | `vocal-dsp/src/segmentation/*` | `studio_vocal::notes`                          | exact ids, tolerance on floats          | O(frames·states)  | medium                          | ts     |
| vocal-dsp       | `estimateKey`                                                        | weighted MIDI notes → KeyCandidate[]         | `vocal-dsp/src/key/*`          | `studio_vocal::key`                            | known melodies                          | trivial           | low                             | ts     |
| vocal-dsp       | `computeTargetPitchCurve`, `computePitchRatioCurve`                  | PitchTrack × doc → f32 per frame             | `vocal-dsp/src/correction/*`   | `studio_vocal::correction`                     | tolerance 1e-4 st                       | O(frames)         | low                             | ts     |
| vocal-dsp       | `renderPitchCorrection` (TD-PSOLA)                                   | PcmAudio × analysis × doc → PcmAudio         | `vocal-dsp/src/psola/*`        | `studio_vocal::psola`                          | re-analysis cents error, null tests     | ≤ 0.1× RT         | high (quality parity)           | ts     |
| midi-core       | `parseMidiMessage`, `encodeMidiMessage`, `MidiStreamParser`          | bytes ↔ MidiMessage                          | `midi-core/src/*`              | `studio_midi::codec` (ref: `midly`/`wmidi`)    | golden bytes (exact)                    | O(1)              | low                             | ts     |
| midi-core       | `MappingEngine.process`                                              | event × mappings × values → effects          | `midi-core/src/mapping*`       | `studio_midi::mapping`                         | exact (ints) / 1e-9                     | O(m)              | low                             | ts     |
| midi-core       | `MidiNoteRecorder`                                                   | timestamped events → notes                   | `midi-core/src/recorder*`      | `studio_midi::recorder`                        | exact                                   | O(1)/event        | low                             | ts     |
| project-storage | `parseProject`, `migrateProjectData`                                 | JSON → Project                               | `project-storage/src/*`        | `studio_model::serde` (serde + validation)     | fixtures per schema version             | O(size)           | medium (zod parity)             | ts     |

Agents append rows and per-function notes in their subsystem docs
([audio-engine.md](audio-engine.md), [vocal-dsp.md](vocal-dsp.md),
[midi-integration.md](midi-integration.md)); this registry is the index.

## Native backend contract (Tauri)

Commands: `engine_load(project_json)`, `engine_apply(changes_json)`, `engine_play(tick)`,
`engine_pause()`, `engine_stop()`, `engine_seek(tick)`, `engine_render(request) → pcm`,
`engine_set_asset_override(asset_id, pcm)`, `midi_list()`, `midi_send(port, bytes, ts)`.
Events: `transport` (state changes), `meters` (≈30 Hz, compact f32 array), `midi_input`
(raw bytes + host timestamp), `recording`, `error`.
Clock sync: the backend reports `(engineTimeSeconds, hostTimeMs)` pairs; the UI maps
positions as in the Web engine. Bulk PCM crosses as binary (`tauri::ipc::Response` /
channels), never JSON arrays. The TypeScript adapter implements the same `AudioEngine`
port, so the UI does not change.
