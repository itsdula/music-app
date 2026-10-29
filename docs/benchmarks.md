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

## Audio engine (real Chromium 153, headless, 4 vCPU)

Source: `packages/audio-web/tests/benchmarks.browser.test.ts` (`pnpm test:browser`); ranges
over several runs. Details in [audio-engine.md](audio-engine.md).

| Measurement                                                 | Result                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| Offline bounce, 16 tracks / 100 clips with effects (72.5 s) | 19.2–21.5 s (3.4–3.8× real time)                    |
| Same arrangement without effects                            | 7.0–7.5× real time                                  |
| Scheduler pass (every 25 ms, 120 ms lookahead)              | mean 0.17–0.35 ms, max 7.1 ms, 0 late events        |
| `readMeters()`, 17 meters                                   | 2.5–3.8 µs back-to-back; 58–133 µs at frame cadence |
| Drum kit synthesis for a new parameter set (main thread)    | 110–173 ms, then cached                             |

## Vocal DSP (Node 22, one thread)

Source: `VOCAL_BENCH=1 pnpm exec vitest run --project unit packages/vocal-dsp/tests/benchmark.test.ts`
and the vocal-dsp metric tests. Details in [vocal-dsp.md](vocal-dsp.md).

| Measurement                                    | Target   | Result                                                |
| ---------------------------------------------- | -------- | ----------------------------------------------------- |
| Analysis (60 s at 48 kHz, full Viterbi)        | ≤ 0.15×  | 0.040× real time (2.37 s)                             |
| TD-PSOLA render (preview and final)            | ≤ 0.1×   | 0.013× real time                                      |
| Raw pitch accuracy (clean synthetic set)       | ≥ 95%    | 98.8% (worst fixture 94.6%, an extreme 59 st/s glide) |
| Octave errors                                  | ≤ 2%     | 0%                                                    |
| Median error after +2/−3 st moves, re-analysed | ≤ 10 ¢   | 0.13–0.64 ¢                                           |
| Key estimation top-1 / top-3 (29 melodies)     | 80 / 95% | 93.1% / 100%                                          |

End to end in the browser (`e2e/studio/vocal.spec.ts`): Auto Tune at 100% moved notes
detuned by −30/+20/−15 ¢ to −0.1/0.0/−0.3 ¢ in the exported WAV (re-analysed in Node).

## Not yet measured

- End-to-end MIDI input → note-on latency in a real browser with hardware (needs a device).
- Memory growth over a 30-minute session (planned Playwright soak test).
- Arrangement draw time in the browser at extreme zoom with waveforms (planned trace).
