# Audio engine

Status: implemented for milestone M2 (vertical slice). Every capability listed here is backed by a
passing test or a measurement; known gaps are listed under [Limitations](#limitations).

| Package               | Role                                                                                                                             | Typings                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `@studio/engine-core` | Pure, deterministic engine math: `diffProjects`, transport clock, window planning, timeline index, mix/pan law, tails, voices    | ES2023 only (Rust-portable) |
| `@studio/audio-dsp`   | Deterministic DSP primitives: WAV codec, peak pyramid, drum and reverb synthesis, curves, FFT, levels, seeded random             | ES2023 only (Rust-portable) |
| `@studio/audio-web`   | Web Audio implementation of the frozen `AudioEngine` port (`createWebAudioBackendFactory`, `WebAudioEngine`, `decodeAudioBytes`) | DOM                         |

## 1. Architecture

```
UI session ──diffProjects(prev, next)──► AudioEngine.applyChanges(changes)
                                              │
                    EngineModel (mirror of the audio-relevant project state, per-track timelines)
                                              │
 Heartbeat (Worker, 25 ms) ─► tick(): plan [scheduledUntil, now + 120 ms) in unwrapped ticks
                                              │   engine-core planScheduleSegments (loop split)
                                              ▼
                     EventScheduler ─► Instrument.scheduleNote / TrackChannel.playAudio / Metronome
                                              │
 ProjectGraph: TrackChannel × N ─► MasterBus ─► destination      (same code on OfflineAudioContext)
```

- **One construction path.** `ProjectGraph` (channels, instruments, effects, master, metronome) and
  `EventScheduler` are used unchanged by realtime playback and by `render()`; only the context and
  the driver differ (heartbeat windows vs. chunks between `suspend()` points). A bounce therefore
  sounds like playback by construction.
- **No UI clocks.** Scheduling uses `AudioContext.currentTime` only. React, `requestAnimationFrame`
  and UI timers are never involved. The heartbeat only wakes the scheduler.
- **Portable cores.** engine-core and audio-dsp compile with `types: []` and no DOM lib, use no
  timers/console/Node built-ins, and are what a native (Rust) backend would port first (§12).

### Source map (`packages/audio-web/src`)

| File                                                     | Responsibility                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `engine.ts`                                              | `WebAudioEngine`: lifecycle, transport, tick loop, changes, live input, recording   |
| `model.ts`                                               | `EngineModel`: applies `AudioGraphChange`s, lazily rebuilt per-track timelines      |
| `scheduler/event-scheduler.ts`, `scheduler/heartbeat.ts` | Window → Web Audio events; Worker/`setInterval` heartbeat                           |
| `graph/*`                                                | `ProjectGraph`, `TrackChannel`, `MasterBus`, `BalancePanner`, `MeterTap`, metronome |
| `instruments/*`                                          | `SynthInstrument`, `DrumKitInstrument`, `SamplerInstrument`                         |
| `effects/*`                                              | `EffectUnit` (bypass crossfade), six processors, `EffectChain` reconciliation       |
| `render.ts`                                              | Offline bounce                                                                      |
| `recording/*`                                            | Shared microphone input (`InputManager`) and `RecorderSession`                      |
| `worklets/studio-worklet.ts`, `workers/clock-worker.ts`  | Inline bundles built by `pnpm codegen` into `src/generated/inline-bundles.ts`       |
| `decode.ts`, `assets.ts`                                 | File decoding; asset AudioBuffer cache with overrides                               |

Worker and worklet code is pre-bundled to strings by `packages/audio-web/scripts/codegen.mjs`
(esbuild via `scripts/inline-bundles.mjs`) and loaded from Blob URLs, which works identically in
Next.js, Vite, Electron and Tauri. Hosts with a CSP need `script-src blob:` (worklet) and
`worker-src blob:` (heartbeat); without them the heartbeat falls back to `setInterval` and meters
fall back to `AnalyserNode` (recording then reports `recording: false`).

## 2. Clocks and transport

Clock domains (from the frozen contract): musical time in **ticks** (PPQ 960), engine time in
**seconds** (`AudioContext.currentTime`), host time (ms) and frame time (UI only).

A run is anchored when playback starts or the position jumps:

```
u(t)  = anchorTick + (t − anchorTime) · bpm · PPQ / 60          (unwrapped, monotonic)
tick  = u                                   if no active loop or u < loop.end
      = loop.start + ((u − loop.end) mod (loop.end − loop.start))   otherwise
```

- The loop is **active** when enabled and the anchor is before `loop.endTick` (starting after the
  loop end ignores it — DAW convention). Starting before `loop.startTick` plays into the loop.
- `play()` anchors at `currentTime + 30 ms` and schedules the first window synchronously.
  `getTransportPosition().ticks` is the position at `currentTime` (clamped to the anchor during the
  start delay); `engineTime` is `currentTime`. A UI that wants the _audible_ playhead can subtract
  `outputLatencySeconds` (§9).
- `stop()` returns to the last play-start position (initially 0). `pause()` keeps the position;
  `play()` after a pause continues and keeps the original play-start for a later `stop()`.
  `seek()` while playing restarts the run there and makes it the new play-start.
- Tempo and loop edits while playing **rebase** the clock at `currentTime + 10 ms`, keeping the
  position continuous (`rebaseClock`), cancel not-yet-started events and reschedule.

### Scheduling constants

| Constant                      | Value  | Why                                                                                                                                |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SCHEDULER_INTERVAL_MS`       | 25 ms  | Worker timer period. ~5 wake-ups per lookahead window, so 3–4 missed ticks are tolerated without late events.                      |
| `LOOKAHEAD_SECONDS`           | 120 ms | Horizon scheduled ahead of `currentTime`. Long enough to ride out main-thread stalls; short enough that edits apply within ~0.1 s. |
| `START_DELAY_SECONDS`         | 30 ms  | play/seek → first sample; the first window is planned synchronously inside it.                                                     |
| `MIN_LEAD_SECONDS`            | 10 ms  | Earliest time for events created by edits/rebases (never schedule in the past).                                                    |
| `LATE_NOTE_TOLERANCE_SECONDS` | 50 ms  | Late notes up to 50 ms are played immediately, later ones dropped (counted in `getDiagnostics().lateEventsDropped`).               |
| `PARAM_TIME_CONSTANT`         | 12 ms  | `setTargetAtTime` constant for parameter glides (settled in ≈ 60 ms).                                                              |
| `BYPASS_CROSSFADE_SECONDS`    | 10 ms  | Effect bypass and chain-rewire crossfade.                                                                                          |
| `STOP_FADE_SECONDS`           | 10 ms  | Fade applied to sounding voices on stop/pause/seek. `STEAL_FADE_SECONDS` = 5 ms for voice stealing.                                |
| `RENDER_CHUNK_SECONDS`        | 2 s    | Offline render suspend interval (scheduling, progress, abort checks). `RENDER_LEAD_SECONDS` = 0.25 s scheduling margin per chunk.  |

Windows are planned in the unwrapped coordinate `u`, so consecutive windows share exact
boundaries even across loop wraps. Times are computed as `startTime + Δticks / ticksPerSecond`
(division, not a rounded reciprocal), so musically round positions map to exact seconds and every
loop pass starts on identical sample offsets (`scheduling.browser.test.ts` asserts that windows of
25 ms, 120 ms, 370 ms and 5 s produce sample-identical output).

### Loops, seeks and edits

- A window crossing the loop end is split into one segment per pass (`planScheduleSegments`); a
  segment that begins at a wrap, a play start or a seek is a **discontinuity**.
- Notes crossing the loop end (or a render end) get their note-off at the boundary
  (`boundaryTick`). Notes are never "chased": a note that started before a seek/wrap is not
  retriggered mid-way (same convention as `expandMidiClipNotes`).
- Audio clips crossing the loop end stop there with a 5 ms de-click ramp; at a discontinuity, clips
  overlapping the segment start are started mid-clip with the correct source offset (tested with a
  sawtooth source so the offset is visible sample by sample).
- `stop`/`pause`/`seek` cancel not-yet-started voices silently and fade sounding ones over 10 ms.
- `applyChanges` while playing: changed clips are **resynced** — their pending voices are dropped,
  sounding audio voices of those clips fade out, and only those clips are re-planned from
  `currentTime + 10 ms` (audio restarts mid-clip). Sounding notes of an edited clip ring out; notes
  of a deleted clip are faded. Instrument-kind changes, asset arrival and overrides resync the
  whole track.

## 3. Mixer graph

```
instrument / audio-clip voices / input monitor
  → channel input (2 ch, mono up-mixed) → effects → fader → pan → mute/solo gate → [meter] → master
master: input → master effects → master fader → [meter] → destination;   metronome → destination
```

- **Fader law:** `gain = 10^(dB/20)`, with ≤ −60 dB treated as silence (`faderGain`), matching the
  parameter spec's "min is −∞".
- **Pan law:** equal-power `θ = (pan + 1)·π/4`, `L = cos θ`, `R = sin θ`, scaled by √2 so the centre
  is unity (0 dB) and hard-pan is +3.01 dB on one side / silent on the other. Implemented with a
  splitter → two gains → merger (`BalancePanner`) rather than `StereoPannerNode`, so the law is
  identical on every backend; on stereo sources it acts as a balance control.
- **Mute/solo:** `trackGateGain` — muted tracks are silent; when any track is soloed only soloed,
  unmuted tracks pass (mute wins over solo). Gates are smoothed (6 ms).
- **Meters:** `readMeters()` returns, per track and master, per-channel linear peak and RMS **since
  the previous read** plus a clip flag (any |sample| ≥ 1.0). A `studio-meter` AudioWorklet sink
  accumulates on the audio thread; each read returns what has arrived and posts the next request,
  so values lag by one round trip (≈ one UI frame) but no sample is missed or counted twice and no
  messages flow while nobody reads. Without AudioWorklet, an AnalyserNode fallback inspects the
  last 2048 samples. Cost: §11.

## 4. Instruments

### Poly synth (`INSTRUMENT_PARAM_SPECS.synth`)

- Voice: osc1 + osc2 (waveform, `osc2Mix` crossfade, `osc2Detune` cents, `osc2Octave`) → lowpass
  biquad → amp envelope → instrument level (`gainDb`). Web Audio's band-limited oscillators.
- **Envelope:** linear attack; decay is an exponential approach to `sustain` with τ = decay/4;
  release τ = release/7 (≈ −61 dB at `release`); voices stop at release + 20 ms and disconnect all
  nodes on `ended` (verified: active voice count returns to 0).
- **Filter:** cutoff and `resonance` (linear Q mapped to the Web Audio lowpass `Q` in dB:
  `20·log10(Q)`), filter envelope from `cutoff · 2^(4·filterEnvAmount)` (≤ 0.45·fs) decaying to the
  cutoff with τ = filterDecay/4.
- **Velocity:** amplitude `(v/127)^1.6`, voice peak 0.5.
- **Polyphony:** `polyphony` voices; the oldest sounding voice is stolen with a 5 ms fade
  (`selectVoicesToSteal`). With polyphony = 1: overlapping notes are legato (same voice, no
  envelope retrigger) and `glideMs` portamento applies (exponential frequency ramp).
- **Pitch bend** ±2 semitones and **mod wheel** vibrato (5.5 Hz LFO, up to ±50 cents) are shared
  per instrument (ConstantSource/LFO connected to every oscillator's `detune`).
- Parameter changes apply smoothly to sounding voices (waveform, detune, octave, mix, cutoff, Q,
  level); envelope times apply to new notes.
- Presets in `SYNTH_PRESETS` render pairwise > 30 % different (relative RMS difference), tested.
- Chromium detail handled: a `setTargetAtTime` following a ramp takes its start value from the last
  rendered frame when the boundary falls between samples, so ramp ends are re-anchored with
  `setValueAtTime` (otherwise identical notes differed by up to one ramp step depending on their
  absolute time).

### Drum kit

Eleven voices synthesized by `synthesizeDrumVoice` (original synthesis, seeded, deterministic) at
the context sample rate, cached per (sample rate, tune, decay, tone) in an LRU shared by realtime
and offline graphs. GM map: 36/35 kick, 37 rim, 38/40 snare, 39 clap, 41/43 low tom, 45/47 mid
tom, 48/50 high tom, 42/44 closed hat, 46 open hat, 49/57 crash, 56 cowbell. Closed/pedal hats (and
a new open hat) choke a sounding open hat (8 ms). `tune` shifts pitch without changing length,
`decayScale` scales every decay constant, `tone` controls brightness, `gainDb` is the level (all
verified audibly). Parameter changes re-render the kit after a 60 ms debounce; sounding hits keep
their buffers.

### Sampler

Plays `instrument.sampleAssetId` with `playbackRate = 2^((note − rootNote)/12)` (duration scales
with pitch), linear attack, exponential release. Gate mode releases at note-off; one-shot plays to
the end of the sample. Max 32 voices (oldest stolen). No pitch bend.

## 5. Effects (`EFFECT_PARAM_SPECS`)

Every unit is `input → (bypassGain ∥ processor → activeGain) → output`; bypass is a 10 ms linear
crossfade and settles to exactly the dry signal (tested for all six kinds). All parameter changes
glide with `setTargetAtTime`. Each parameter of each kind is tested to change the output by

> 5 % relative RMS (`mix.browser.test.ts`, 26 cases).

| Kind         | Implementation                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gain`       | GainNode, `10^(dB/20)` (exact, tested).                                                                                                                                                                                                                                                                                                                                           |
| `eq3`        | low shelf (`lowFreq`, `lowGainDb`) → peaking (`midFreq`, `midQ`, `midGainDb`) → high shelf (`highFreq`, `highGainDb`).                                                                                                                                                                                                                                                            |
| `compressor` | `DynamicsCompressorNode` (threshold, ratio, attack, release, knee) → makeup gain. The browser compressor has a fixed ~6 ms lookahead and, in Chromium, its own automatic makeup stage; `makeupDb` is applied on top.                                                                                                                                                              |
| `reverb`     | pre-delay → `ConvolverNode` (normalization off) with a seeded stereo IR from `generateReverbImpulse` (unit energy per channel, −60 dB at `decaySeconds`, damping lowpass falling 3 octaves over the decay); equal-power dry/wet `mix`. Decay/damping changes regenerate the IR after a 150 ms debounce and crossfade old → new convolver over 60 ms (tested). IRs are LRU-cached. |
| `delay`      | DelayNode (≤ 2.5 s) with feedback through a lowpass tone filter (`toneHz`) inside the loop; equal-power mix; time changes glide (tape-style, click-free).                                                                                                                                                                                                                         |
| `distortion` | drive = 0–36 dB input gain into a fixed 4×-oversampled tanh WaveShaper curve (`makeDistortionCurve(0.25)`), partial level compensation (−12 dB at full drive), tone lowpass, equal-power mix, `outputDb`. Driving the input gain avoids curve swaps.                                                                                                                              |

Chain reconciliation (`EffectChain`) updates units in place by effect id; adding, removing or
reordering slots rewires behind a 10 ms output dip.

## 6. Metronome

Synthesized clicks (`synthesizeMetronomeClick`: 1760 Hz accent on bar starts, 1320 Hz otherwise,
60 ms) on every beat of `project.meter` (`metronomeClicksInRange`), level `metronome.gainDb`, summed
after the master bus (not metered, not processed). Realtime: scheduled while `metronome.enabled`.
Offline: only when `RenderRequest.includeMetronome` (regardless of `enabled`).

## 7. Offline render

`render(request, { signal, onProgress })`:

1. Snapshot the model (edits during a render do not affect it); load referenced assets.
2. Length = `(endTick − startTick)` at the project tempo + tail. `tailSeconds: 'auto'` uses
   `estimateTailSeconds`: the longest audible track's instrument release (drums: longest voice ×
   decayScale) plus its serial effect tails (reverb decay + pre-delay; delay time × echoes to −60 dB),
   plus master effect tails, capped at 12 s.
3. Build `ProjectGraph` on an `OfflineAudioContext(channelCount, frames, sampleRate)`; schedule
   `[startTick, startTick + 2.25 s)`, then at each 2 s `suspend()` point check the AbortSignal,
   report progress and schedule the next chunk. Mono renders use the destination down-mix
   (`(L + R)/2`).
4. Notes and audio are cut at `endTick` (note-off/de-click there); the tail renders releases and
   effect tails. Audio clips overlapping `startTick` start mid-clip.
5. Abort rejects with `render-cancelled` immediately; the context is left suspended at its next
   suspend point and garbage-collected. Invalid requests reject with `render-failed`.

`RenderedAudio.pcm` can be encoded with `encodeWav(pcm, { bitDepth: 16, dither: 'tpdf' })` (or 24
or 32-bit float); render → encode → decode round trips are tested.

## 8. Assets

- `loadProject` loads every asset referenced by audio clips and samplers through
  `config.assets.load(assetId)` (once per asset; concurrent requests share the promise), converts PCM
  to AudioBuffers at the asset's native rate (playback resamples), and resolves when all have
  settled. Failures emit `asset` (`status: 'error'`) and `error` (`asset-missing`) events and are not
  thrown; clips of a failed asset are silent and the asset is retried on the next request.
- `applyChanges` loads assets introduced by `clip.add/update`, sampler changes and `asset.add`
  (awaited), then resyncs playing clips of those assets.
- `setAssetOverride(assetId, pcm | null)` swaps the buffer used wherever the asset plays (clips,
  samplers, renders). While playing, sounding sources of that asset fade out (10 ms) and restart from
  the current position with the new buffer; when stopped it applies to the next playback. `null`
  restores the original. Overrides are aligned in time by the asset's sample rate (an override with a
  different rate still plays in sync).
- `decodeAudioBytes(bytes, hint)`: WAV (magic, MIME or extension) via `decodeWav` at its native
  rate with exact samples; unsupported WAV codecs and all other formats via `decodeAudioData` on an
  `OfflineAudioContext` at **48 kHz** — browsers always resample decoded audio to the context rate,
  so such assets are stored at 48 kHz (browser resampler, implementation-defined quality). The input
  is copied first (the browser detaches it). Failures throw `AudioEngineError('asset-decode-failed')`.

## 9. Recording and monitoring

- `startRecording({ trackIds, deviceId?, channelCount, latencyCompensationSeconds? })` opens the
  input with `getUserMedia({ audio: { deviceId, channelCount: { ideal }, echoCancellation: false,
noiseSuppression: false, autoGainControl: false } })`, connects it to a `studio-recorder`
  AudioWorklet sink and starts the transport if it is not playing. Status events:
  `requesting-permission → recording → finalizing → idle` (or `error`).
- The worklet posts 4096-frame chunks (buffers transferred) stamped with `currentFrame` of their
  first sample, so the take's engine time is exact regardless of message latency; gaps are filled
  with silence by frame.
- **Latency model.** A sample captured at context time `Tc` was played by a performer reacting to
  what they heard, which the engine produced `outputLatency` earlier, and it reached the graph
  `inputLatency` after it was played:
  `take.startTick = tickAt(clockAtRecordStart, Tc(first sample) − compensation)`, with
  `compensation = latencyCompensationSeconds ?? (baseLatency + outputLatency + trackSettings.latency)`.
  The value used is reported on each take.
- **Caveats (honest):** `outputLatency` is 0 in headless Chromium and is only an estimate elsewhere;
  `MediaTrackSettings.latency` is Chromium-only and often a nominal value; Bluetooth outputs and OS
  mixers add latency the browser does not report. The default is therefore a starting point — hosts
  should offer a loopback calibration and pass `latencyCompensationSeconds`. `channelCount` is only
  honoured by Chromium. Recording across a loop wrap yields one linear take positioned at its start.
- Errors: `NotAllowedError`/`SecurityError` → `microphone-denied`; everything else (no device,
  `NotReadableError`, overconstrained) → `microphone-unavailable`; emitted as `error` events and
  thrown.
- `stopRecording()` resolves with one take per track id (the first owns the captured arrays, others
  get copies). It does not stop the transport.
- `setInputMonitoring(trackId, enabled)` routes the (shared, reference-counted) input through the
  track's channel input → effects → fader → pan → gate, so monitoring is heard with the track chain.
  Monitoring is explicit: the engine does not interpret `Track.monitor` (`auto`/`on`) — the session
  decides when to call it. Beware feedback with speakers.

## 10. Live input, lifecycle, errors

- `live.noteOn/noteOff/sustain/pitchBend/modulation/allNotesOff` act immediately on instrument
  tracks, also while the transport is stopped. Sustain follows CC64 semantics (`SustainPedal`):
  key-ups while the pedal is down are deferred, re-pressed keys stay held. `noteOn` with velocity 0
  is a note-off. `allNotesOff` releases live voices with their normal release. Pitches are used as
  given — channel filtering and `MidiInputRouting.transpose` are the router's job.
- `initialize()` creates `AudioContext({ latencyHint: config.latencyHint ?? 'interactive' })`,
  loads the worklet module, builds the graph and reports capabilities (sample rate, base/output
  latency when the browser exposes them, recording availability). The context may be `suspended`
  until `resume()` is called from a user gesture; `play()` also attempts `resume()`. `lifecycle`
  events mirror the context state.
- `dispose()` stops scheduling, terminates the heartbeat worker, releases inputs, disconnects the
  graph, closes the context, emits `lifecycle: closed` and removes all listeners.
- `getDiagnostics()` (not part of the port) exposes heartbeat mode, scheduler tick statistics,
  dropped late events and the active voice count.

## 11. Benchmarks

Environment: 4-vCPU Linux container, headless Chromium 153 (Playwright 1.63), Node 22.22.
Measured by `packages/audio-web/tests/benchmarks.browser.test.ts` (prints a `BENCHMARK {…}` line);
ranges are over four to six runs. `performance.now()` is clamped to 100 µs without cross-origin isolation,
so per-call costs are means over many calls.

| Benchmark                                           | Method                                                                                                                                                                                                                                          | Result                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Offline render, 16 tracks / 100 clips               | 8 synth tracks (presets, 16 notes per 2-bar clip), 4 drum tracks (32 hits per clip), 4 audio tracks (4 s stereo loops); EQ+compressor / reverb / delay / distortion+gain on every track; 32 bars at 120 bpm + auto tail (72.5 s), 48 kHz stereo | 19.2–21.5 s → **3.4–3.8× realtime**                      |
| Same arrangement without effects                    | 64 s                                                                                                                                                                                                                                            | 8.6–9.2 s → **7.0–7.5× realtime**                        |
| Scheduler tick cost                                 | Realtime playback of the same project for 3 s (≈ 120 ticks, 52–60 sounding voices); time of each `tick()` measured inside the engine                                                                                                            | mean **0.17–0.35 ms**, max 1.9–7.1 ms; 0 late events     |
| `readMeters()` cost, 16 tracks + master (17 meters) | 2000 back-to-back reads (no worklet requests posted)                                                                                                                                                                                            | **2.5–3.8 µs** per read                                  |
|                                                     | 300 reads spaced 4 ms apart (each posts 17 `read` requests)                                                                                                                                                                                     | **58–133 µs** per read                                   |
| Drum kit synthesis (11 voices, 48 kHz)              | `synthesizeDrumVoice` for every kind; decayScale 1 / 4                                                                                                                                                                                          | 110–173 ms / 298–364 ms (main thread; cached afterwards) |
| Reverb IR generation (stereo, 48 kHz)               | `generateReverbImpulse` 2.2 s / 10 s                                                                                                                                                                                                            | 20–29 ms / 69–96 ms (cached afterwards)                  |

The scheduler budget (25 ms period) is used at < 2 % on average. A UI reading meters once per
animation frame spends ≈ 0.1 ms per frame.

## 12. Rust migration notes

Tolerance: **exact** for tick/integer logic (bit-identical results required); **numeric** for
float DSP (libm differences in the last ulp; compare with the stated absolute tolerance). Golden
fixtures are to be generated from this TypeScript implementation into `@studio/test-fixtures`
under the listed names.

| Function                                                                                                                         | Inputs → outputs                                                                                  | Tolerance                                    | Golden fixture                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| `diffProjects`                                                                                                                   | (Project, Project) → ordered `AudioGraphChange[]`                                                 | exact (order and payload identity)           | `engine-core/diff-cases.json`       |
| `createTransportClock`, `tickAtTime`, `wrapTick`, `rebaseClock`                                                                  | anchor (s, ticks, bpm, loop), time → ticks                                                        | exact for integer ticks; 1e-9 for fractional | `engine-core/clock-cases.json`      |
| `planScheduleSegments`, `segmentTimeAtTick`                                                                                      | clock, unwrapped window [u0, u1), options → segments (ticks, start time, boundary, discontinuity) | exact ticks/flags; times 1e-12 s             | `engine-core/windows.json`          |
| `IntervalTree`, `TrackTimeline` queries                                                                                          | events, window → event lists                                                                      | exact (sets)                                 | `engine-core/timeline-queries.json` |
| `buildTrackTimeline`                                                                                                             | clips, assets, bpm → note/audio events                                                            | exact ticks for MIDI; 1e-9 ticks for audio   | `engine-core/timeline-build.json`   |
| `resolveTrackGates`, `trackGateGain`                                                                                             | tracks → 0/1 per track                                                                            | exact                                        | `engine-core/mute-solo.json`        |
| `equalPowerPanGains`, `mixerPanGains`, `faderGain`                                                                               | pan / dB → gains                                                                                  | 1e-12                                        | `engine-core/mix-laws.json`         |
| `estimateTailSeconds`, `effectTailSeconds`, `instrumentTailSeconds`                                                              | tracks, master → seconds                                                                          | 1e-12                                        | `engine-core/tails.json`            |
| `metronomeClicksInRange`                                                                                                         | tick range, meter → clicks                                                                        | exact                                        | `engine-core/metronome.json`        |
| `selectVoicesToSteal`, `SustainPedal`                                                                                            | voice spans / pedal events → ids / pitches                                                        | exact                                        | `engine-core/voices.json`           |
| `adsrLevelAt`, `releaseLevelAt`, `velocityToGain`, `midiToFrequency`, `filterEnvelopePeakHz`, `resonanceToQDb`, `pitchBendCents` | scalars → scalars                                                                                 | 1e-12 relative                               | `engine-core/instrument-math.json`  |
| `audioVoiceGainEnvelope`, `gainEnvelopeAt`                                                                                       | clip/fade frames → gain breakpoints                                                               | 1e-12                                        | `engine-core/fades.json`            |
| `createSeededRandom`, `deriveSeed`                                                                                               | seed → u32-derived floats                                                                         | exact (pure 32-bit integer ops)              | `audio-dsp/random.json`             |
| `encodeWav` / `decodeWav`                                                                                                        | PcmAudio + options ↔ bytes                                                                        | exact bytes (incl. seeded TPDF dither)       | `audio-dsp/wav/*.wav`               |
| `buildPeakPyramid`, `readPeaks`                                                                                                  | PcmAudio, options / frame range, columns → min/max arrays                                         | exact (min/max only)                         | `audio-dsp/peaks.json`              |
| `synthesizeDrumVoice`                                                                                                            | kind, sample rate, params → mono buffer                                                           | 1e-6 absolute                                | `audio-dsp/drums/<kind>-48k.f32`    |
| `generateReverbImpulse`                                                                                                          | sample rate, decay, damping, seed → stereo IR                                                     | 1e-6 absolute                                | `audio-dsp/reverb-2s-48k.f32`       |
| `makeDistortionCurve`, `synthesizeMetronomeClick`                                                                                | params → curve / click                                                                            | 1e-7 absolute                                | `audio-dsp/curves.json`             |
| `biquadCoefficients`, `applyBiquad`, `fftInPlace`, `dominantFrequency`                                                           | params / samples → coefficients / spectra                                                         | 1e-9 relative                                | `audio-dsp/filters-fft.json`        |
| `dbToGain`, `gainToDb`, `peakAmplitude`, `rmsLevel`                                                                              | scalars / PcmAudio → scalars                                                                      | 1e-12 relative                               | `audio-dsp/levels.json`             |

### Native backend contract

A native backend implements the same `AudioEngine` port semantically (not by mimicking Web Audio
nodes); the TypeScript adapter becomes a thin IPC client.

- **Commands** (host → engine, JSON): `initialize`, `resume`, `loadProject { project }`,
  `applyChanges { changes: AudioGraphChange[] }` (produced by `diffProjects` on the host),
  `setAssetOverride { assetId, pcmHandle | null }`, `play { fromTick? }`, `pause`, `stop`,
  `seek { tick }`, `live.* { trackId, … }`, `startRecording { options }`, `stopRecording`,
  `setInputMonitoring { trackId, enabled }`, `render { request, jobId }`, `cancelRender { jobId }`,
  `dispose`. Each returns a result or an `EngineError { code, message, detail? }` using the frozen
  error codes.
- **Events** (engine → host): exactly the `AudioEngineEvent` union (`lifecycle`, `transport`,
  `recording`, `asset`, `error`), plus `render.progress { jobId, fraction }`.
- **Clock sync.** The engine owns the audio clock. It publishes `(engineTime, ticks, state)` at
  ≥ 30 Hz together with the host monotonic time at which that sample is expected to be **heard**
  (engine output timestamp). The host answers `getTransportPosition()` by extrapolating the last
  publication with the tempo (no round trip), exactly like `tickAtTime` on a `TransportClock`
  anchored at the published pair. Scheduling stays inside the engine (lookahead computed from its
  own callback clock with the same `planScheduleSegments` logic) — IPC is never on the audio path.
- **PCM transfer and ownership.** Planar float32 (`PcmAudio`). Bulk transfers (asset PCM, takes,
  renders, overrides) move as shared-memory handles or transferred ArrayBuffers in ≥ 100 ms chunks;
  the sender must not touch a buffer after sending (same rule as `pcmTransferables`). Assets are
  addressed by `assetId`; the engine pulls PCM through the host's `AssetPcmSource` equivalent and owns
  its decoded copies. Takes are delivered as chunks stamped with the engine frame of their first
  sample.
- **Latency compensation.** The native engine knows its device input/output latencies exactly
  (e.g. CoreAudio/WASAPI/ASIO report them); it computes
  `take.startTick = tickAt(firstFrameTime − (inputLatency + outputLatency))` itself, reports the value
  used on the take, and still honours `latencyCompensationSeconds` overrides. Transport positions it
  publishes are tagged with the output timestamp so UIs can draw the audible playhead.

## 13. Integration guide (UI session)

```ts
const engine = createWebAudioBackendFactory().create({ assets: assetPcmSource, logger });
engine.subscribe(onEngineEvent); // lifecycle, transport, recording, asset, error
await engine.initialize(); // may stay 'suspended'
button.onclick = () => void engine.resume(); // inside a user gesture (autoplay policy)

await engine.loadProject({ project }); // resolves when referenced assets settled
let current = project;
store.subscribe((next) => {
  // after every command
  const changes = diffProjects(current, next); // from @studio/engine-core
  current = next;
  if (changes.length) void engine.applyChanges(changes);
});

await engine.play(fromTick);
await engine.pause();
await engine.stop();
await engine.seek(tick);
requestAnimationFrame(function frame() {
  // UI only: never used for scheduling
  const { ticks, state } = engine.getTransportPosition();
  const meters = engine.readMeters(); // peak/RMS since the previous read
  draw(ticks, state, meters);
  requestAnimationFrame(frame);
});

engine.live.noteOn(trackId, pitch, velocity); // from the MIDI router (already filtered/transposed)

await engine.startRecording({ trackIds: [trackId], channelCount: 1 });
const takes = await engine.stopRecording(); // [{ trackId, pcm, startTick, latencyCompensationSeconds }]
// store take.pcm as a new asset (encodeWav), then add an audio clip at take.startTick via commands

const rendered = await engine.render(
  {
    startTick: 0,
    endTick,
    sampleRate: 48000,
    channelCount: 2,
    tailSeconds: 'auto',
    includeMetronome: false,
  },
  { signal: abortController.signal, onProgress: ({ fraction }) => setProgress(fraction) },
);
const wav = encodeWav(rendered.pcm, { bitDepth: 24, dither: 'tpdf' }); // from @studio/audio-dsp
await engine.dispose();
```

Vocal correction previews: render with the vocal processor, then
`engine.setAssetOverride(assetId, previewPcm)`; `null` switches back (A/B).

## 14. Tests

| Suite                                                                           | Project   | Content                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine-core/tests/*.test.ts`                                          | `unit`    | clock anchoring/wrap, window planning edge cases + tiling property, interval tree and timeline vs brute force (fast-check), every `diffProjects` change type and order, mute/solo, pan/fader laws, tails, metronome, voices, envelopes, fades |
| `packages/audio-dsp/tests/*.test.ts`                                            | `unit`    | WAV round trips and hand-built headers, dither statistics, peaks vs brute force, drum/IR determinism and character, FFT, filters, seeded random golden values                                                                                 |
| `packages/audio-web/tests/render.browser.test.ts`                               | `browser` | A4 = 440 Hz ± 1 % with sample-exact onset and silence outside the note, WAV round trip, mono/offset renders, auto tail, progress and cancellation                                                                                             |
| `packages/audio-web/tests/mix.browser.test.ts`                                  | `browser` | audio clip offset/gain/fades sample-exact, clip loops, missing assets, overrides, mute/solo/fader, pan law, master, every effect parameter, bypass ≈ dry                                                                                      |
| `packages/audio-web/tests/instruments.browser.test.ts`                          | `browser` | tuning, presets distinct, synth params, voice stealing, glide, drum map/params/choke, sampler pitch and modes, metronome, MIDI clip loops                                                                                                     |
| `packages/audio-web/tests/scheduling.browser.test.ts`                           | `browser` | loop-end note-off, audio resume mid-clip after wrap, window-size invariance, click-free stop, param glide, bypass crossfade, IR regeneration, live bend/vibrato/legato                                                                        |
| `packages/audio-web/tests/realtime.browser.test.ts`                             | `browser` | real AudioContext: lifecycle, transport ≈ real time, pause/stop/seek, loop wrap, edits while playing, tempo/loop rebase, live input, fake-microphone recording, latency override, permission errors, monitoring                               |
| `packages/audio-web/tests/decode.browser.test.ts`, `benchmarks.browser.test.ts` | `browser` | WAV/Opus decoding, error mapping; benchmarks (§11)                                                                                                                                                                                            |

Commands: `pnpm codegen`, then `pnpm exec vitest run --project unit packages/engine-core packages/audio-dsp`
and `pnpm exec vitest run --project browser packages/audio-web`.

## Limitations

- **Count-in** (`metronome.countInBars`) is not implemented by the engine; recording starts at the
  current position. It needs a decision on negative transport positions or a pre-roll API.
- Tempo changes while playing re-anchor the clock; notes already sounding keep the note-off time
  computed at the old tempo, and sounding audio clips restart at the new position.
- Notes are not chased after seeks/loop wraps (a note that began earlier is not retriggered).
- Live mono legato has no last-note priority (releasing the newer key does not return to an older
  held key).
- The sampler ignores pitch bend and modulation.
- Drum kit and reverb IR synthesis run on the main thread (≈ 110–170 ms per new kit, cached).
- The compressor inherits the browser's fixed lookahead and Chromium's automatic makeup gain.
- Meter values lag by one request round trip; the AnalyserNode fallback can miss peaks.
- Recording latency defaults are estimates (§9); headless Chromium reports `outputLatency = 0`.
- Only Chromium is exercised by tests. Browsers without `cancelAndHoldAtTime` use an analytic
  envelope fallback that is not tested here.
