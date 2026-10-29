# Benchmarks

Baselines recorded on the development container (4 vCPU, Node 22.22, Linux). Targets
are set from these baselines; CI budgets in the tests are ≈10× looser so they catch
regressions rather than noise. Re-measure on reference hardware before publishing numbers.

## Core (non-audio) hot paths — 16 tracks, 100 clips, ~3,900 notes

Source: `packages/studio-react/tests/performance.integration.test.ts`
(`pnpm exec vitest run --project integration packages/studio-react/tests/performance.integration.test.ts --silent=false`).

| Operation                                       | Baseline | CI budget | Notes                                     |
| ----------------------------------------------- | -------- | --------- | ----------------------------------------- |
| `diffProjects` after moving one clip            | 0.042 ms | 2 ms      | reference-identity diff, 1 change emitted |
| `applyCommand` `notes.update` (64-note clip)    | 0.008 ms | 2 ms      | structural sharing                        |
| `serializeProject` (autosave payload)           | 5.8 ms   | 100 ms    | 671 KiB stable JSON                       |
| `parseProject` (migrate + zod + invariants)     | 5.6 ms   | 400 ms    | project open / bundle import              |
| `clipBoxes` (visible clips, 1600×1000 viewport) | 0.016 ms | 2 ms      | per arrangement redraw                    |
| `buildPeakPyramid` (3 min stereo, 48 kHz)       | 30.6 ms  | 3 s       | once per asset, cached by content hash    |
| `readPeaks` 1,600 columns, whole file           | 0.042 ms | 10 ms     | waveform draw at minimum zoom             |
| `readPeaks` 1,600 columns, 1 s window           | 0.028 ms | 10 ms     | waveform draw at maximum zoom             |

## Audio engine

See [audio-engine.md](audio-engine.md) (offline render of a 16-track/100-clip project,
scheduler tick cost, meter read cost) — measured in real Chromium by the engine test suite.

## Vocal DSP

See [vocal-dsp.md](vocal-dsp.md) (analysis and TD-PSOLA render real-time factors, accuracy
metrics on synthetic fixtures).

## Not yet measured

- End-to-end MIDI input → note-on latency in a real browser with hardware (needs a device).
- Memory growth over a 30-minute session (planned Playwright soak test).
- Arrangement draw time in the browser at extreme zoom with waveforms (planned trace).
