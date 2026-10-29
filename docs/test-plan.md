# Test plan

The test suite exists from project inception and runs in CI on every push
(`.github/workflows/ci.yml`). Failures are reported with the exact command, failing test,
root cause, fix and re-run result; tests are never skipped or weakened to pass.

## 1. Commands

| Command                 | What it runs                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| `pnpm test`             | codegen + unit, react, integration, contract projects                           |
| `pnpm test:unit`        | Node unit tests + jsdom component tests                                         |
| `pnpm test:integration` | `*.integration.test.ts(x)`                                                      |
| `pnpm test:contracts`   | shared interface suites and golden fixtures (`*.contract.test.ts`)              |
| `pnpm test:browser`     | real-Chromium Vitest browser project (`*.browser.test.ts`): Web Audio, worklets |
| `pnpm test:e2e`         | production builds of both hosts + Playwright                                    |
| `pnpm test:coverage`    | unit/react/integration/contracts with v8 coverage                               |
| `pnpm check`            | format, lint, typecheck, boundaries, tests, build                               |

Vitest projects are defined in `vitest.config.ts`; Playwright projects (`web`, `vite`) in
`playwright.config.ts`. Chromium runs with
`--autoplay-policy=no-user-gesture-required --use-fake-ui-for-media-stream --use-fake-device-for-media-stream`.

## 2. Test matrix by package

| Package                | Unit                                                                             | Contract / golden                                                      | Integration / browser                                                                                           | E2E touchpoints                 | Coverage target            |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------- |
| domain                 | time, grid, theory, params, selectors, intervals, invariants (property tests)    | —                                                                      | —                                                                                                               | —                               | ≥ 90% lines                |
| commands               | every command + errors, structural sharing, history                              | model-based random command sequences (invariants, undo/redo exactness) | —                                                                                                               | all editing specs               | ≥ 90%                      |
| engine-core            | clock, loop windows, timeline index, diff, mix math                              | exact-match tick/event fixtures (Rust parity)                          | —                                                                                                               | playback specs                  | ≥ 90%                      |
| audio-dsp              | WAV codec, peaks, drums, IR, dither                                              | WAV golden files; tolerance-based DSP fixtures                         | —                                                                                                               | export specs                    | ≥ 90%                      |
| audio-web              | —                                                                                | `AudioEngine` behaviour suite                                          | offline render pitch/timing, loops, effects audibility, mute/solo, recording with fake mic, real-time transport | playback, recording, export     | n/a (browser)              |
| vocal-dsp              | stages, metrics on synthetic fixtures, determinism                               | `runVocalProcessorContract` (inline + worker)                          | —                                                                                                               | vocal specs                     | ≥ 85%                      |
| midi-core              | parser/encoder golden bytes, mapping transforms, learn, recorder, service        | encode↔parse property tests                                            | —                                                                                                               | learn/mapping specs             | ≥ 90%                      |
| midi-akai-mpk-mini-mk3 | identify, port matching, metadata completeness                                   | —                                                                      | —                                                                                                               | MK3 panel spec (virtual device) | ≥ 90%                      |
| project-storage        | schema, migrations, bundles, autosave (fake scheduler)                           | repository contract suites (memory + IndexedDB)                        | —                                                                                                               | save/reload specs               | ≥ 90%                      |
| platform-browser       | Web MIDI adapter (fake MIDIAccess), pickers                                      | IndexedDB contract suites via fake-indexeddb                           | —                                                                                                               | portability                     | ≥ 70%                      |
| ui                     | Knob/Fader/NumberField/ToggleButton/ResizeHandle interactions, ARIA, tokens sync | —                                                                      | —                                                                                                               | keyboard specs                  | ≥ 70%                      |
| studio-react           | stores, controllers, TimeAxis, gesture state machines                            | —                                                                      | session integration with a test platform                                                                        | all studio specs                | ≥ 60% (controllers/stores) |

Mock only hardware/OS edges (MIDI devices, file pickers, microphones where unavailable),
never the domain behaviour under test.

## 3. Fixtures

- `@studio/test-fixtures`: seeded generators (sine, sweep, noise), synthetic vowels with
  exact f0 ground truth (constant, vibrato, glide, melodies), consonant bursts, known-key
  melodies. All generated at test time — no binary blobs needed, no licensing questions.
- MIDI golden byte fixtures in `packages/midi-core/tests/fixtures`.
- Real vocal recordings may be added only with compatible licences (Vocadito, VocalSet:
  CC BY 4.0) and attribution; non-commercial datasets are excluded.

## 4. Numeric tolerances

- Integer tick/MIDI logic: exact match (also required for future Rust ports).
- Float DSP: documented per test (e.g. WAV 16-bit round trip ≤ 1 LSB; render frequency
  ±1%; pitch error in cents; null tests at −60 dBFS). JS `Math.*` functions are not
  bit-specified across engines, so cross-implementation comparisons use tolerances.

## 5. E2E scenarios (Playwright)

1. Landing page loads, communicates the product, links to `/studio` (web).
2. Portability: `<Studio />` mounts on `/studio` (web) and on the Vite host; same version marker.
3. MIDI vertical slice: create instrument track + clip, draw notes, play, loop, stop, seek,
   export WAV → decode download and assert duration/non-silence.
4. Arrangement: import WAV, move/trim/split clips, add effect, save, reload → same project
   JSON (minus timestamps) and same rendered audio hash within tolerance.
5. Recording: arm, record with fake microphone, stop → clip exists at expected position.
6. MIDI: inject a virtual MIDI device (`page.addInitScript` fake `navigator.requestMIDIAccess`),
   play notes (engine receives them), learn a knob → mapping, reload → mapping restored,
   hotplug disconnect → no stuck notes.
7. Vocal: import synthetic vocal, analyse, see notes/key candidates/uncertain segments,
   move a note, A/B, export corrected WAV (pitch verified offline in the test).
8. Error states: microphone denied, MIDI unsupported/denied, corrupt bundle import.
9. Keyboard: transport shortcuts, undo/redo, focus order, escape cancels gestures.

## 6. Performance methodology

Run on CI-like hardware (4 vCPU), Chromium headless, production build:

- Offline render of a generated 16-track/100-clip project (time, peak memory).
- Scheduler tick cost (mean/p99 µs) with 16 instrument tracks playing.
- Meter read + draw cost per frame with 16 tracks.
- Arrangement draw time at min/max zoom for 100 clips with waveforms.
- MIDI software-path latency: fake input event → `noteOn` scheduled (mean/p99).
- Vocal: analysis and render real-time factors on 60 s fixtures (Node and browser worker).
- Memory growth over 30 minutes of looped playback with edits (heap snapshots).
  Baselines are recorded in `docs/benchmarks.md`; regressions beyond 20% fail review.

## 7. Hardware-in-the-loop (manual)

Physical MPK Mini MK3 protocol: [midi-integration.md](midi-integration.md) (HIL section).
Every item stays "unverified" until executed on real hardware with evidence (date, OS,
browser, firmware, observed messages). Audio latency calibration is similarly manual.

## 8. Listening evaluation (vocal)

Checklist per release: sustained vowels, vibrato, glissando, consonants/sibilants,
breathy voice, silence; shifts of ±1, ±3, ±7 semitones; A/B against original; note
artefacts (phasiness, buzz, doubled consonants, clicks at boundaries) with timestamps.
