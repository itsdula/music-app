# Vocal DSP options: monophonic pitch analysis and pitch correction

**Status:** research input for an ADR. Not a decision. **Agent:** research-vocal-dsp. **Date:** 2026-10-29.
**Scope:** a Melodyne-*style* (conceptual only) monophonic vocal editor for Studio: analysis (pitch tracking, voicing, notes, vibrato and drift, key) and transformation (pitch correction with formant preservation; optional time-stretch). Analysis and transformation are evaluated separately, because a pitch tracker does not change audio.

## How to read the citations

Every factual claim carries a source tag `[Rn]` (see section 7). Each source is marked with how it was checked:

- **V**: verified this session from the primary artefact: the repository LICENSE or source file, the npm tarball, or crates.io metadata.
- **S**: verified only from search-engine extracts of the paper or page. The session's network policy blocked direct fetches of arxiv.org, core.ac.uk, qmul.ac.uk, sigport.org, zenodo.org, dafx.de and most publisher sites. Only GitHub, npm and crates.io could be read directly. Re-check S figures against the PDF before quoting them externally.
- **D**: derived here (arithmetic from a verified source, such as FLOP counts from a model topology). The method is stated inline.
- **P**: design proposal or engineering judgement. Not a sourced fact. Validate it with the evaluation plan in section 6.

---

## 1. Executive recommendation

### 1.1 Analysis stack (primary): in-house pYIN in TypeScript, in a Web Worker

1. **Pitch:** pYIN [R2]. Stage 1 is YIN [R1] with a Beta prior over thresholds, which yields several f0 candidates per frame, each with a probability [R2][R4]. Stage 2 is HMM Viterbi decoding over pitch bins × {voiced, unvoiced} [R2][R3][R4]. Implement it clean-room from the paper and from librosa's ISC-licensed implementation [R4]. Do **not** port the GPL-2.0 reference C++ in c4dm/pyin [R3].
   - **Why pYIN:** it is deterministic and cheap (well under 5% of one core, D, §2.1). It is the front end of Tony, a purpose-built singing-note transcription tool [R5]. YIN-family methods had the best fine accuracy in a large singing-voice comparison [R21]. pYIN's candidate set has higher pitch recall than any single YIN threshold [R2]. It has a direct Rust analogue: the `pyin` crate (MIT, a librosa port) [R74][R75].
2. **Notes:** a Tony-style note HMM, with attack, stable and silent states per pitch, decoded by Viterbi [R3][R5]. Deterministic post-rules follow: minimum duration, gap splitting, near-unison merging (P). PELT change-point segmentation [R54] is the alternative behind the same interface.
3. **Expression:** per note, a robust centre pitch, a low-order drift trend, and vibrato rate and extent from a least-squares sinusoid fit on a fixed 4–8 Hz grid. The search ranges come from published vibrato detectors [R55][R56] (P for the exact method).
4. **Key:** profile matching on duration-weighted pitch classes. The default is an ensemble of Aarden–Essen and Albrecht–Shanahan profiles. Albrecht and Shanahan report that this combination is significantly more accurate than other models [R60][R58]. Scores go through a calibrated softmax with an abstain rule (§4.2).

### 1.2 Transformation stack (primary): in-house TD-PSOLA offline renderer

- TD-PSOLA [R44] re-spaces pitch-synchronous grains. Because the vocal-tract response inside each grain is kept, **formants are preserved intrinsically**. No envelope estimation is needed [R44][R45].
- Pitch marks come from the pYIN path, refined by waveform cross-correlation. Glottal epoch detectors such as zero-frequency filtering [R77] are an alternative mark source to evaluate. Unvoiced audio (sibilants, breath) passes through untouched (P). The published MIT `@audio/tune-curve` README describes the same approach [R43].
- **Formant shift** (optional): resample each grain before overlap-add (P, standard PSOLA practice).
- **Time edits:** PSOLA or WSOLA time-scaling on monophonic voice [R46][R49].
- Renders run in a Worker into cached buffers per edited region. Playback is plain buffer playback, so no real-time DSP runs in the AudioWorklet (P).
- **Why build rather than adopt:**
  - PSOLA is small, cheap and deterministic, and it ports cleanly to Rust function by function.
  - Signalsmith's own README says its formant correction "is not as sharp as monophonic algorithms (such as PSOLA)" [R38].
  - The only permissive JS TD-PSOLA "retune along a curve" package (`@audio/tune-curve`, MIT) was first published on 2026-10-03 and is at v0.4.0 [R43]. That is too young to depend on, but valuable as a test oracle and design reference.

### 1.3 Alternative strategy behind the same interface

- **`SignalsmithRenderer`** uses Signalsmith Stretch (MIT; C++ core and its FFT dependency are both MIT) [R37][R38][R39]. It is phase-vocoder based, handles multi-octave shifts, and has formant compensation, formant shift and a time-varying frequency map [R38]. Use it when pitch marks are unreliable (breathy or growled takes, bleed) and for larger time-stretches.
  - The npm package is **AudioWorklet-only**. It can be driven inside an `OfflineAudioContext`, but for Worker rendering we should compile the MIT C++ to WASM ourselves (§2.2).
- **Optional "robust tracking" mode:** a neural tracker run through onnxruntime-web WASM in a Worker, offered as an opt-in download. Candidates:
  - CREPE-tiny: MIT, ~0.49 M parameters (D) [R8][R9].
  - FCPE: MIT, 96.79% RPA on MIR-1K per the paper [R15][R16].
  - Avoid PESTO for bundling: its code and weights are LGPL-3.0 [R12].
- **Interface sketch (P):**
  - `PitchAnalyzer.analyze(pcm, sr, opts) → PitchTrack`, with frames of `{t, f0Hz, voicedProb, rms}`.
  - `NoteSegmenter.segment(track) → Note[]`, where each note is `{start, end, centreCents, driftCentsPerSec, vibrato: {rateHz, extentCents} | null}`.
  - `KeyEstimator.estimate(notes) → {ranked: [{key, p}], abstain}`.
  - `PitchRenderer.render(pcm, sr, track, targetCurve, opts) → pcm`, implemented by `PsolaRenderer` and `SignalsmithRenderer`.

### 1.4 Licence posture in one line

Keep the shipped bundle permissive: MIT, BSD, ISC, Apache-2.0, 0BSD, with MPL-2.0 acceptable as file-level copyleft. Exclude GPL, AGPL and LGPL code **and weights** from the bundle unless a commercial licence is bought. Details are in §2.2 and §5.

---

## 2. Comparison tables

### 2.1 A. Pitch analysis methods (monophonic singing, 44.1/48 kHz, 60–1100 Hz)

The CPU figures for DSP methods are D estimates. YIN or MPM through an FFT of size 4096 per frame costs about 3 × 5·N·log₂N ≈ 0.75 MFLOP per frame. At hop 256 (172 frames/s) that is about 130 MFLOP per second of audio, roughly 1–3% of one core in JS. Benchmark before committing.

| Method | Quality evidence (vocal-relevant) | Cost | Frame / latency | Octave and voicing behaviour | Licence of reference impl. | Browser / Worker | Determinism | Rust path |
|---|---|---|---|---|---|---|---|---|
| Plain autocorrelation / AMDF | YIN's authors report YIN's error rates are about 3× lower than the best competing methods [R1]. pitchfinder documents AMDF as accurate only to about ±2% [R23] | Lowest | ≥2 periods of fmin | Prone to octave errors; no voicing model [R1] | n/a | Trivial | Yes | Trivial |
| **YIN** [R1] | Best fine accuracy among 6 methods on a large EGG-annotated singing database, but the strongest degradation under reverberation [R21] | ~130 MFLOP per s of audio (D) | 2048 @44.1k (46 ms); offline, so no latency constraint | Threshold-dependent; a strong 2nd harmonic can be taken for the period [R43]; single threshold, so brittle voicing [R2] | Many; paper | Yes | Yes (FFT plus IEEE arithmetic) | `pitch-detection` (MIT/Apache) [R74] |
| **pYIN** [R2] | Clearly beats YIN with any of the Beta priors tested on synthesised RWC singing; candidate recall ≈0.99 [R2]. One later comparison found roughly 2× more unvoiced→voiced errors than CREPE [R64] | YIN plus 100-threshold scan plus sparse Viterbi: about 9 M ops per s of audio for 1010 states × ±25-bin transitions (D) | Same as YIN; Viterbi is global, so offline only (or fixed-lag) | HMM continuity strongly suppresses octave jumps; explicit voiced/unvoiced states [R2][R3] | c4dm C++ **GPL-2.0** [R3]; librosa **ISC** [R4] | Yes | Yes, with a fixed tie-break | `pyin` crate (MIT, librosa port) [R74][R75] |
| **MPM** (McLeod) [R6] | Normalised square difference function with "key maximum" picking; designed for fast response [R6]. The k = 0.9 default is an implementation choice, not the paper's [R6] | ≈ YIN | Short frames possible (real-time tuners) [R22] | Picking the greatest NSDF peak causes octave errors; mitigated by the relative threshold k [R6]; clarity value usable as voicing | pitchy (MIT on npm) [R22] | Yes | Yes | `pitch-detection` crate (MIT/Apache) [R74] |
| Cepstrum | No vocal benchmark found this session | Low (1 FFT + log + IFFT) | Needs long frames for low f0 | Weak at high f0 with few harmonics (P) | n/a | Yes | Yes | realfft |
| **SWIPE / SWIPE′** [R7] | Better than the compared algorithms on speech, disordered voice and instrument databases; SWIPE′ uses only the first and prime harmonics to cut subharmonic errors [R7]. On MDB-stem-synth: 0.925 RPA vs CREPE 0.967 [R8]. On MIR-1K: 86.6% vs CREPE-full 90.1% (SPICE paper) [R17] | Moderate to high: multi-resolution spectra (P) | Multi-window | Good subharmonic rejection [R7]; collapses in loud music noise (27.2% RPA at 0 dB) [R17] | Paper; MATLAB and libf0 ports [R7] | Feasible | Yes | Port by hand |
| Harmonic summation / HPS | No vocal benchmark found this session | Low | Long frames | Octave-up bias without correction (P) | n/a | Yes | Yes | realfft |
| **CREPE** [R8] | MDB-stem-synth RPA (50 c) 0.967 vs pYIN 0.919 and SWIPE 0.925; at 10 c: 0.995 / 0.908 / 0.833 [R8]. RWC-synth: 99.98% vs pYIN 99.19% [R8]. Released weights were trained on MIR-1K, MDB-stem-synth, MedleyDB and others, so evaluations on those sets are contaminated [R9] | Full: ~2.8 GFLOP per frame, about 280 GFLOP per s at 10 ms hop (D, from the topology in [R9]). Native CPU: 12 min for a 2 min 51 s file [R12]. **Tiny**: ~74 MFLOP per frame, ~0.49 M params (D) | 1024 samples @16 kHz (64 ms), 10 ms hop [R9] | Strong; confidence output; optional Viterbi [R9] | Code and weights **MIT** [R9]; training data includes NC-licensed sets [R9][R67] | The TF.js demo model in marl/crepe gh-pages is the *tiny* capacity (verified from model.json) [R9]; ONNX ports exist (MIT) [R9] | WASM single-thread: yes within one build; WebGPU: not guaranteed (P) | `ort` / `tract` [R74] |
| **PESTO** [R10][R11] | v1 (28.9k params): 96.1% RPA on MIR-1K, 94.6% on MDB [R10]. Journal version (130k params): 97.7% / 97.0%, slightly above CREPE on MIR-1K (97.5%) [R11] | Very low: about 13 s for a 171 s file on a laptop CPU [R12] | Streaming variant exists [R12] | Good; confidence output | **LGPL-3.0** (code and shipped weights) [R12] | ONNX export possible | As CREPE | `ort` / `tract` |
| **RMVPE** [R13] | Designed for vocal pitch *in polyphonic music*; reports RPA/RCA gains over pYIN and CREPE and robustness at all SNRs [R13] | GPU RTF 0.0329 [R15] | Mel-spectrogram U-Net + GRU [R13] | Robust to accompaniment [R13] | Repo **Apache-2.0** [R14]; provenance of the commonly used weights not verified | Large model; heavy for the browser (P) | As CREPE | `ort` |
| **FCPE** [R15] | 96.79% RPA on MIR-1K, comparable to RMVPE; GPU RTF 0.0062 vs CREPE 0.4775 [R15] | 10.64 M params [R15] | 16 kHz, hop 160 [R16] | V/UV threshold 0.006 [R16] | **MIT** [R16] | Needs ONNX export (P) | As CREPE | `ort` |
| **SPICE** [R17] | MIR-1K: 91.4% vs CREPE-tiny 90.7% and CREPE-full 90.1% (clean); 81.6% vs 80.8% at 0 dB [R17] | ~2.38 M params [R10] | — | Self-supervised; confidence output | Google, Apache (TF Hub) (P: verify the model card) | TF.js | As CREPE | `ort` |
| **basic-pitch** [R18] | Instrument-agnostic *polyphonic* note transcription; generalises to vocals [R18] | TF.js model about 0.9 MB (V, npm tarball) [R19] | Resamples to 22.05 kHz [R19] | Outputs notes and pitch bends, not a fine f0 track [R19] | **Apache-2.0** [R19] | `@spotify/basic-pitch` (TF.js) [R19]; last npm release 2022-08 [R19] | As CREPE | `ort` (ONNX export shipped) [R19] |

**Also noted:** PENN/FCNF0++ (MIT) reports 11.2× faster than real time on a desktop CPU at 10 ms hop [R20], showing that small neural trackers can be practical on CPU.

**Verdict for A:**
- Primary: pYIN (DSP, deterministic, permissive clean-room path).
- Optional neural second opinion: CREPE-tiny or FCPE (both MIT).
- basic-pitch is not an f0 tracker for editing. It is at most a seeding aid for note segmentation.

### 2.2 B. JS / WASM library survey (licences verified)

"Last publish" is from npm metadata on 2026-10-29 [R22–R43].

| Package (version) | Licence (where verified) | What it is | Worker / offline | Determinism notes | Maintenance | Verdict |
|---|---|---|---|---|---|---|
| `pitchy` 4.1.0 | npm tarball LICENSE: **MIT**. The repo's main branch has since moved to **0BSD** text [R22] | MPM, pure JS [R22] | Yes | Pure JS arithmetic | Last publish 2024-01 [R22] | OK as a reference or real-time tuner; not needed for the offline pass |
| `pitchfinder` 2.3.4 | package.json says "GNU v3" (**GPL-3.0**); **no LICENSE file** in the tarball or at the repo root [R23] | YIN, AMDF, McLeod, dynamic wavelet [R23] | Yes | — | Publish 2025-12 | **Avoid**: GPL-3 and ambiguous licence text |
| `essentia.js` 0.1.3 | **AGPL-3.0** (tarball LICENSE) [R24] | Essentia C++ → WASM: YIN, pYIN, Melodia and more [R24] | Yes | — | Last publish 2022-05 [R24] | **Avoid in the shipped app**: AGPL network clause; Essentia offers a commercial licence (link in [R24]) |
| `aubiojs` 0.2.1 | Wrapper **MIT** [R25], but it compiles **aubio (GPL-3.0)** into the WASM [R25], so the effective licence is GPL-3 | aubio pitch and tempo [R25] | Yes | — | Last publish 2022-11 | **Avoid** |
| `meyda` 5.6.3 | **MIT** [R26] | Feature extraction, no f0 tracker | Yes | — | 2024-04 | Not relevant for f0 |
| ml5 (`ml5` 1.4.0) | npm metadata says MIT, but the repo LICENSE is the custom **"ml5.js License"**, with conduct-conditioned terms and contributions reverting to Blue Oak after 3 years [R27] | v1 **no longer ships pitch detection**; the old ml5-library had a CREPE-based PitchDetection [R27] | — | — | Active | **Do not use**: non-OSI terms and no pitch module |
| `onnxruntime-web` 1.31.1 | **MIT** [R28] | ONNX inference: WASM, WebGPU [R28][R29] | Yes (Worker) | WASM without threads or relaxed SIMD is deterministic per build [R72]; WebGPU/fp16 not guaranteed (P) | Very active (2026-10) [R28] | **Use** for the optional neural mode |
| `@tensorflow/tfjs` 4.22.0 | **Apache-2.0** [R30] | TF.js | Yes | As above | Last publish 2024-10, slowing [R30] | Prefer ONNX Runtime |
| `@spotify/basic-pitch` 1.0.1 | **Apache-2.0** [R19] | Note transcription | Yes | — | 2022 [R19] | Optional, low priority |
| `rubberband-wasm` 3.3.0 | **GPL-2.0** (repo LICENSE); commercial licence from Breakfast Quay [R31][R32] | Rubber Band → WASM | Yes | — | 2024-12 | **Only with a purchased licence.** R3 engine is best quality, with formant preservation [R32][R33] |
| `soundtouchjs` 0.3.0 | **LGPL-2.1** (tarball LICENSE) [R35] | SoundTouch port (WSOLA-like tempo, rate transposer) [R34] | Yes | — | 2026-02 | Avoid (LGPL; no formant handling) |
| `@soundtouchjs/*` 2.1.1 | **MPL-2.0** [R36]. The repo says it moved "off of the LGPL to the MPL-2.0" after rewrites; no record of the original author's consent [R36] | AudioWorklet SoundTouch, phase vocoder, **LPC formant-correction worklet**, `processOffline()` [R36] | AudioWorklet / offline | — | Active (2026-08) | **Provenance risk**: legal review before use |
| **`signalsmith-stretch` 1.3.2** | **MIT** (package.json; upstream LICENSE.txt MIT; Signalsmith Linear MIT) [R37][R38][R39] | See the detail below | AudioWorklet node; usable in `OfflineAudioContext`; not a plain-Worker API [R37] | See the detail below | npm 2025-06; C++ active [R37][R38] | **Adopt as the alternative renderer**; build our own Worker WASM from the C++ |
| Bungee (C++, GitHub) | **MPL-2.0** (repo LICENSE) [R41]. Note: npm `bungee` is an **unrelated** 2013 package [R41] | Phase-vocoder grains about 100 per second; per-grain pitch and position, so continuously variable pitch [R41] | Build WASM ourselves; vendor's "Bungee Pro" is a separate commercial WASM/AudioWorklet product [R42] | — | Active | Viable time-stretch alternative; the README does not mention formant preservation [R41] |
| `@audio/tune-curve` 0.4.0, `@audio/pitch-pyin` 2.1.0, `@audio/stretch-psola` 1.2.3 (audiojs) | **MIT** (repo LICENSE files; the npm tarballs of tune-curve and pitch-pyin ship **no LICENSE file**) [R43] | TD-PSOLA retune along a pitch curve, with pYIN-driven marks; PSOLA/WSOLA stretch [R43] | Pure JS; streaming and offline [R43] | Pure JS (Math.* caveat [R73]) | **Created 2026-07 to 10; 0.x** [R43] | Use as **oracle and reference** in tests; do not depend on it yet |
| `fast-phase-vocoder` 1.0.1 | MIT [R43] | Phase vocoder | Yes | — | Created 2026-04, single maintainer | Not recommended |
| TD-PSOLA / WSOLA JS | Only the audiojs packages above are maintained; `waa-play` (MIT, WSOLA) is new [R43] | — | — | — | — | Implement in-house |

**Signalsmith Stretch, in detail.** This is what the brief asked us to pin down. All of it was verified by reading the npm 1.3.2 bundle and the upstream header [R37][R38]. Nothing was executed.

- **Licence:** MIT, for both the npm package and the upstream C++. Its dependency Signalsmith Linear is also MIT [R37][R38][R39].
- **Form:**
  - The package is an Emscripten build with the WASM inlined, wrapped in an `AudioWorkletProcessor`. `SignalsmithStretch(audioContext)` returns an `AudioWorkletNode` with extra methods. The worklet module is injected via a `blob:` URL, which needs a CSP allowance [R37].
  - There is no documented plain-Worker API. Offline rendering works by creating the node on an `OfflineAudioContext`, because AudioWorklet is available on offline contexts. For Worker rendering we would compile `signalsmith-stretch.h` (MIT) with Emscripten ourselves (P).
- **Time-varying transpose:** yes, through `schedule({output, semitones, formantSemitones, formantCompensation, formantBaseHz, rate, …})`. The processor reads the current segment once per `process()` call, so pitch changes are **piecewise-constant per 128-sample render quantum** with no interpolation inside a segment [R37]. In buffer mode it calls `seek()` on every render quantum [R37]. In C++ there is also `setFreqMap()`, an arbitrary frequency map [R38].
- **Formants:** `setFormantFactor` / `setFormantSemitones`, each with a `compensatePitch` flag, plus `setFormantBase(f0/sr)` (0 means auto-detect) [R38]. Per its own README the formant correction is less sharp than PSOLA and needs a rough f0 hint [R38].
- **Latency:** the default preset is a 120 ms block with a 30 ms interval; the "cheaper" preset is 100 ms / 40 ms [R38]. Latency is reported as `inputLatency()` (STFT analysis) plus `outputLatency()` (synthesis, plus one interval if `splitComputation`) [R38]. The web node exposes `latency()` [R37].
- **Quality claims:** it uses the final approach from the ADC22 talk "Four Ways to Write a Pitch-Shifter" [R38][R40]. It claims "a wide-range of pitch-shifts (multiple octaves)", while time-stretch "sounds best … between 0.75x and 1.5x" [R38]. Python and Rust bindings exist [R38].
- **Determinism:**
  - The default C++ constructor seeds its RNG from `std::random_device`. A `SignalsmithStretch(long seed)` constructor exists [R38].
  - Randomisation is only used when the time-stretch factor exceeds `maxCleanStretch = 2` [R38]. Pure pitch-shifting at rate 1 is therefore deterministic.
  - Our own WASM build must use the seeded constructor (P).

**Copyleft and LGPL in web bundles.**
- GPL and AGPL code in a distributed app forces the whole app's licence (P, standard reading).
- LGPL in a bundled web or WASM app is a **known grey area**. The relinking obligation is hard to satisfy for a single minified JS or WASM bundle. Practitioners split the LGPL part into a separately loaded module with source and relinking instructions, or buy a commercial licence. No authoritative ruling was found [R78].
- MPL-2.0 is file-level copyleft. Modified MPL files must be published, but it does not reach the rest of the app (P, licence text).

### 2.3 C. Pitch transformation methods for monophonic vocals

| Method | Quality evidence | Cost | Latency | Formants | Licence of candidate impl. | Browser feasibility | Determinism | Rust path |
|---|---|---|---|---|---|---|---|---|
| **TD-PSOLA** [R44] | Standard pitch/time method for speech synthesis. Analysis windows are pitch-synchronous, two periods long. Pitch scaling is classically limited to a factor of about 0.5–2 [R45]. Drawbacks under large prosodic changes; "metallic" artefacts when unvoiced segments are repeated [R45] | Very low: one OLA per period (P) | One to two periods plus mark look-ahead | **Preserved intrinsically** (the vocal-tract response stays in the grain) [R44][R45] | In-house (P); MIT oracle `@audio/tune-curve` [R43]; Rust `tdpsola` is **AGPL** [R74] | Excellent (pure TS, Worker) | Yes | Own port |
| **WSOLA** [R46] | High-quality time-scale modification of speech; blocks of about 20 ms with 50% overlap [R46]. Time-domain methods can beat phase-locked PV on some signals [R47] | Low | ~20–40 ms | Unchanged (time-scale only); pitch needs a resample step, which then shifts formants (P) | SoundTouch LGPL-2.1 [R34]; in-house | Yes | Yes | Own port |
| **Phase vocoder + phase locking** [R47] | Identity and scaled phase locking reduce "phasiness" [R47]. Transient smearing is a known PV issue [R49] | Medium (FFT per hop) | Block (~50–120 ms) | Not preserved unless an envelope is applied | Signalsmith (MIT) [R38]; Bungee (MPL-2.0) [R41] | Yes (WASM) | Yes if seeded or no randomisation [R38] | `signalsmith-stretch` crate (MIT) [R74] |
| **PV + spectral-envelope formant preservation** (cepstral, LPC, true envelope) [R48] | Röbel & Rodet select an iterative cepstral **true envelope** estimator as the most promising for envelope-preserving pitch shifting [R48]. Rubber Band offers `OptionFormantPreserved` ("retaining the original timbre of vocals") [R33]. Classical methods produce formant shifts and robotic colouring that grow with transposition size (tested ±12 st) [R79] | Medium to high | Block | Preserved approximately; the cepstral order must track f0 [R48] | Rubber Band R3 (GPL/commercial) [R32]; Signalsmith formant compensation (MIT) [R38]; SoundTouchJS LPC worklet (MPL, provenance risk) [R36] | Yes | Yes | Signalsmith crate; own |
| **Formant shifting** | PSOLA: resample grains (P). PV: warp the envelope (`setFormantFactor`) [R38] | Low (PSOLA) | — | Controlled | — | Yes | Yes | Own |
| Neural resynthesis (DDSP / NSF) | Out of scope for v1; DDSP is Apache-2.0 [R80] | High | — | Modelled | — | Heavy | Backend-dependent | `ort` / `candle` |

**Practical quality limits (to disclose and verify):**
- The classical TD-PSOLA range is a factor of 0.5–2, i.e. ±12 semitones [R45]. Artefacts grow with the size of the shift for all classical methods [R79].
- Rule of thumb, to be confirmed by our MUSHRA test (§6): ±1–3 st is near-transparent for PSOLA on clean takes; ±3–7 st sounds acceptable but audibly processed; beyond ±7 st it is clearly processed; ±12 st is an effect (P).
- Time-stretch: Signalsmith recommends 0.75–1.5× [R38].

**"Auto-tune" style correction, from public descriptions only:**
- *Retune speed* is a time in ms for how fast correction is applied; 0 means an instant jump [R51]. Secondary sources list Auto-Tune Access presets of 3 / 25 / 65 ms [R51].
- *Humanize* applies a slower retune speed only to the sustained part of longer notes [R51].
- Hildebrand's patent argues that quality correction needs continuously varying pitch change rather than a constant shift [R50].
- Autotalent (GPL-2) exposes allowed notes, correction strength and smoothness, and formant correction and warp [R52].
- A data-driven alternative predicts note-wise shifts from the accompaniment [R53] (future).

**Proposed model (P):**
- For note *n* with centre *cₙ* (cents) and snapped target *Tₙ*, the correction offset is *Δₙ = Tₙ − cₙ*.
- The output pitch curve is `f0'(t) = f0(t) + Σₙ Δₙ·wₙ(t) − k_drift·driftₙ(t) + (k_vib − 1)·vibₙ(t)`.
- `wₙ` ramps over the transitions with a one-pole time constant τ = retune speed.
- Humanize: τ grows to τ_h on the sustained portion of notes longer than 300 ms.
- Snapping hysteresis: keep the previous target unless the centre moves more than 50 + h cents from it, with h ≈ 15–25 cents.
- The renderer receives `ratio(t) = 2^((f0'(t) − f0(t))/1200)` at each pitch mark.

---

## 3. Recommended parameters (offline, Worker-based pass)

All values are P unless cited. They are tuned to match published defaults where those exist.

### 3.1 Sample-rate handling

- Mix to mono by channel mean, the same as `@audio/tune-curve` [R43]. Process internally in `Float64Array`. IEEE + − × ÷ √ give identical results across engines; `Math.sin/cos/exp/log/pow` are only "implementation-approximated" in ECMA-262 [R73], so precompute windows and tables once and test with tolerances (§6.4).
- **44.1 / 48 kHz:** analyse at the native rate.
- **88.2 / 96 / 176.4 / 192 kHz:** decimate by 2 or 4 with a fixed linear-phase FIR whose coefficients are committed as constants, so TS and Rust share them exactly.
- Never use a general resampler in the analysis path.
- Neural mode resamples to the model rate: 16 kHz for CREPE and FCPE [R9][R16].

### 3.2 pYIN front end

| Parameter | 44.1 kHz | 48 kHz | Rationale |
|---|---|---|---|
| Frame N | 2048 (46.4 ms) | 2048 (42.7 ms) | Matches the pYIN Vamp default block 2048 [R3] and the librosa time scale (2048 @22.05k ≈ 93 ms) [R4]; covers ≥2.7 periods at 60 Hz |
| YIN integration window W | N/2 = 1024 | 1024 | Must exceed τ_max (735 / 800 samples) [R4] |
| Hop H | 256 (5.80 ms) | 256 (5.33 ms) | Matches the pYIN Vamp default step 256 [R3]; fine editing resolution |
| Pitch range | 60–1100 Hz default; presets Low 55–520, Mid 75–880, High 130–1400 | same | The brief's range; librosa recommends ≥ C2 (65 Hz) [R4] |
| Difference function | FFT autocorrelation, size 4096; CMNDF; parabolic interpolation | | [R1] |
| Threshold prior | 100 thresholds 0.01…1.00, Beta(2, 18) (mean 0.10) | | librosa defaults [R4]; c4dm default is Beta mean 0.15 [R3]. Tune on fixtures |
| Boltzmann parameter / no-trough prob | 2 / 0.01 | | librosa [R4] |
| Pitch bins | 10 cents (60–1100 Hz → 505 bins; ×2 voicing = 1010 states) | | librosa resolution 0.1 st [R4]; c4dm uses 20 c (5 bins/st) [R3] |
| Max transition | 35.92 oct/s, i.e. about 2.5 st per 5.8 ms frame (±25 bins, triangular weights) | | librosa default [R4]; c4dm uses ±1 st per frame [R3] |
| Voicing switch prob | 0.01 | | librosa [R4]; c4dm self-transition 0.99 [R3] |
| Decoding | Full offline Viterbi in log domain, tie-break to the lowest state index; chunk at unvoiced gaps ≥ 0.5 s to bound memory | | Backpointers for 3 min × 1010 states as int16 ≈ 62 MB without chunking (D) |
| f0 refinement | Report the nearest genuine YIN candidate (parabolic) to the chosen bin; fall back to the bin centre if none within ±50 c | | pYIN reports real YIN estimates, not averages [R2] |
| Extra unvoiced evidence | Force unvoiced if frame RMS < −60 dBFS or < track-peak RMS − 50 dB | | c4dm has a "low amplitude suppression" parameter (default 0.1) [R3] |

### 3.3 Note segmentation

- **Tony-style note HMM** [R3][R5], using the published defaults:
  - 69 semitones from MIDI 35, 3 pitches per semitone, 3 states per pitch (attack, stable, silent): 621 states.
  - Self-transitions: attack 0.9, stable 0.99, stable→silent 0.01, silent 0.9999.
  - σ²_note 0.7; maximum jump 13 st [R3].
  - These were tuned for hop 256 @44.1k, which matches §3.2 [R3].
- **Post-rules (P):**
  - Split at unvoiced gaps ≥ 30 ms.
  - Minimum note length 60 ms; shorter notes merge into the closer-pitched neighbour.
  - Merge adjacent notes whose centres differ by < 35 c with a gap < 30 ms.
- **PELT alternative** [R54]:
  - Signal: cents per voiced run after a 9-frame moving median (~50 ms) and a 3 Hz low-pass to suppress 5–7 Hz vibrato.
  - Gaussian mean-change cost; penalty β = c·σ̂²·ln n, with σ̂ from the MAD of first differences and c ∈ [2, 4] tuned on fixtures.
  - Minimum segment length 10 frames.
- **Note centre (P):** median cents over the stable portion. Drop HMM attack frames, else the first 20% and last 15%.

### 3.4 Vibrato, drift and transitions

- **Eligibility:** stable portion ≥ 0.5 s, i.e. ≥ 2 cycles at 4 Hz (P).
- **Detrend:** remove an order-1 (or order-2, if it lowers BIC) least-squares fit. The slope is the drift in cents/s (P).
- **Vibrato fit:**
  - Least-squares sinusoid on a fixed grid of 4.00–8.00 Hz in 0.05 Hz steps (81 candidates), over sliding 512 ms windows with an 8-frame hop (~46 ms) (P).
  - Accept when the rate is in 4–8 Hz, the half-extent is in 15–150 c, there are ≥ 5 mean-crossings and the explained variance is ≥ 0.5. This is adapted from Nakano et al. (5–8 Hz, 30–150 c, more than 5 crossings) [R55].
  - Typical sung values: rate about 5.5–6.7 Hz, extent about ±60 c (Prame, secondary source) [R57].
  - An alternative is the filter diagonalisation method (AVA): vibrato rate accuracy > 92.5% and extent accuracy about 85% [R56].
- **Transitions:** keep the original glide shape and shift its endpoints. Optionally parameterise portamento with a logistic curve, as AVA does [R56].

### 3.5 Correction defaults (P)

- Retune τ 25 ms; humanize τ_h 150 ms on notes > 300 ms.
- Snapping hysteresis h = 20 c.
- Drift reduction k_drift 0 (off); vibrato scale k_vib 1.
- Crossfade 5 ms at voiced/unvoiced edges.

---

## 4. Segmentation and key estimation

### 4.1 Segmentation recommendation and complexity

- **Primary:** note HMM plus post-rules. T = frames, S = 621, K = admissible predecessors per state (about 13 st × 3 × 3 ≈ 117 worst case).
  - Viterbi costs O(T·S·K): about 172 × 621 × 117 ≈ 12.5 M ops per second of audio (D). Memory is O(T·S) backpointers, chunked at silences.
  - Why: it models attack and stable phases and was evaluated as a singing transcriber [R5].
- **Alternative:** PELT [R54].
  - Expected O(n), worst case O(n²) per voiced run [R54]. Runs are typically < 3000 frames, so even the worst case is ~10⁷ ops (D).
  - It is simpler to explain, has no trained parameters, and its penalty gives users an intuitive "sensitivity" knob (P).
- **Heuristic baseline** (split on jumps > 70 c sustained ≥ 30 ms, plus voicing gaps) is O(T). Keep it for tests and as a fallback (P).
- **Vibrato grid fit:** O(L·G) per window with G = 81. Negligible.

### 4.2 Key and scale estimation

- **Inputs:**
  - Notes from §3.3, or MIDI notes.
  - First estimate global tuning as the circular mean of (cents mod 100), and subtract it (P).
  - Pitch-class weight = duration × min(1, RMS/RMS_median). Drop notes < 80 ms (P).
- **Profiles:**
  - Krumhansl–Kessler: major [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], minor [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17] [R58].
  - Temperley–Kostka–Payne [R58][R59].
  - Aarden–Essen, derived from a *melodic* folk corpus [R58].
  - Albrecht–Shanahan: major [.238, .006, .111, .006, .137, .094, .016, .214, .009, .080, .008, .081], minor [.220, .006, .104, .123, .019, .103, .012, .214, .062, .022, .061, .052], matched by **Euclidean distance** rather than correlation [R60].
- **Default:** an ensemble of Aarden–Essen (correlation) and Albrecht–Shanahan (Euclidean). Albrecht & Shanahan report this meta-algorithm is significantly more accurate than other extant models, and that most models are less accurate on minor-mode works [R60].
- **Calibration (P):**
  - Map each model's 24 scores to z-scores, average them, and apply a softmax with temperature T fitted on labelled melodies (temperature scaling). Check calibration with reliability diagrams and ECE.
  - Report the top key, its probability and the margin to second place. **Always show the relative major/minor alternative.**
  - **Abstain** if total weighted duration < 8 s, fewer than 12 notes, fewer than 5 distinct pitch classes, or margin < 0.1.
- **Scoring for evaluation:** MIREX weighted score: correct 1.0, fifth 0.5, relative 0.3, parallel 0.2 [R61].
- **Known failure modes:**
  - Relative major/minor share every pitch class, which is why MIREX gives partial credit [R61].
  - Title or annotated keys may not match perceived keys [R61].
  - Modal, pentatonic, blues and chromatic lines (P).
  - Modulation: windowed estimation over 8–16 s with change detection (P).
  - Short excerpts (abstain rule).
  - No melody-only accuracy figure for KK, Temperley or AS was retrievable this session. Measure our own (§6).
- **Complexity:** O(N) to accumulate the histogram, plus 24 × 12 per profile. Negligible.
- **Product rule (P):** the key is a *suggestion*. Scale snapping uses the user-confirmed key.

---

## 5. Known limitations to disclose to users

1. **Monophonic only.** Polyphony, doubled vocals, reverb and accompaniment bleed degrade tracking. YIN degraded most under reverberation in a singing study [R21]. RMVPE-class models target polyphonic input but are large [R13].
2. **Octave and voicing errors** on vocal fry or creak, breathy or whispered singing, very high soprano notes, and vowels with a strong second harmonic [R43][R21]. pYIN's voicing can produce more unvoiced→voiced false alarms than CREPE [R64].
3. **Large shifts sound processed.** Classical methods degrade with shift size [R79]; PSOLA is classically limited to factors of 0.5–2 [R45]. Gender-change and formant effects are intentionally artificial.
4. **Unvoiced sounds are not pitch-shifted** (sibilants, breath). This is by design (P).
5. **Time-stretching** beyond about 0.75–1.5× has audible artefacts [R38].
6. **Vibrato detection** needs notes of at least about 0.5 s (P).
7. **Key suggestions** can confuse relative keys and fail on modal or chromatic melodies [R60][R61].
8. **Rendering is offline.** Edits re-render a region before playback reflects them (P).
9. **Tiny cross-browser numeric differences** are possible because JS math functions are approximated [R73]. Results are reproducible on the same engine and build.
10. **Optional neural mode** downloads model weights and is slower on low-end devices (D, §2.1).

---

## 6. Evaluation plan and fixture strategy

### 6.1 Objective metrics

- **Frame level** (mir_eval conventions) [R61][R62]:
  - RPA (within 50 c), RCA (octave-folded), Voicing Recall, Voicing False Alarm, Overall Accuracy.
  - GPE (relative error > 20% on frames voiced in both reference and estimate) and FPE (spread of non-gross errors) [R64].
  - Plus the median and P95 absolute cents error on voiced frames.
- **Note level:** mir_eval transcription matching with onset ±50 ms, pitch ±50 c, offset max(20% of duration, 50 ms) [R61]. Add Molina et al.'s singing-specific error categories [R63].
- **Key:** accuracy and MIREX weighted score [R61], plus ECE for the calibrated probabilities (P).
- **Transformation** (P):
  - Re-analyse the output and measure |measured − target| in cents on steady notes. Proposed target: median ≤ 5 c for shifts ≤ ±7 st.
  - Formant preservation: log-spectral distance between true-envelope or cepstral envelopes [R48] of matched vowel frames, input vs output.
  - RMS change ≤ 0.5 dB.
  - Click detector at grain and region boundaries.
  - **Identity test:** ratio 1 must return the input sample-for-sample. `@audio/tune-curve` documents this property [R43].

### 6.2 Deterministic, licence-free synthetic fixtures (`@studio/test-fixtures`)

- **Source:** additive harmonic synthesis of an LF-style glottal flow derivative spectrum [R76], or a Rosenberg pulse, driven by an analytic f0(t) through a float64 phase accumulator. Harmonics are band-limited below Nyquist. The ground-truth f0 and voicing are exact (P).
- **Vocal tract:** cascade second-order resonators F1–F5 per vowel (P). `klatt-syn` (MIT, npm) can be a reference [R43].
- **Seeded PRNG** (mulberry32 or xorshift128+) for noise, jitter and shimmer (P).
- **Fixture families (P):**
  - F1: steady vowels × 12 pitches across 60–1100 Hz × 5 vowels.
  - F2: vibrato at 4–8 Hz, 10–150 c.
  - F3: glissandi ±12 st over 0.2–2 s.
  - F4: note sequences, legato and staccato, with known boundaries.
  - F5: consonants (fricative noise 3–8 kHz, plosive bursts).
  - F6: breathiness, aspiration noise at HNR 30→5 dB.
  - F7: jitter and shimmer.
  - F8: octave traps (strong H2, missing fundamental, F1 on H2).
  - F9: seeded synthetic reverb.
  - F10: noise at SNR 30/20/10 dB.
  - F11: 44.1/48/96 kHz.
  - F12: key melodies (scale-generated, relative-minor and modal adversarial cases).
- Store the **generator plus seed plus parameters**, not large WAVs. Commit small golden output files: CSV or float32 of f0, voicing and notes.

### 6.3 Real datasets (licences checked)

| Dataset | Content | Licence | Use |
|---|---|---|---|
| **Vocadito** | 40 solo monophonic singing excerpts; f0, two note annotations, lyrics [R65] | **CC BY 4.0** [R65] | Primary real benchmark; may be redistributed with attribution |
| **VocalSet** | 10.1 h, 20 singers, techniques (vibrato, breathy, fry and more) [R66] | **CC BY 4.0** (paper and catalogue; check the Zenodo record field) [R66] | Robustness and listening-test stimuli (no f0 ground truth assumed) |
| **PTDB-TUG** | 4720 *speech* recordings with laryngograph ground truth [R68] | **ODbL** with DbCL contents (share-alike on derived databases) [R68] | Voicing and GPE on speech; keep derived data separate |
| **MDB-stem-synth** | 230 resynthesised stems with exact f0 [R67] | **CC BY-NC 4.0** [R67] | Eval-only, outside the repo; legal check for a commercial product |
| **MIR-1K** | Karaoke clips sung by lab members [R69] | **No explicit licence found**; the Zenodo mirror is restricted ("contact the author") [R69] | Avoid unless licence obtained; CREPE, PESTO and FCPE trained or evaluated on it [R9][R12][R15] |
| **NUS-48E** | 169 min sung and spoken lyrics [R70] | **No licence found** [R70] | Avoid |

Real datasets are fetched by a script into a git-ignored cache and run as an optional CI benchmark. They are never committed, except possibly Vocadito with attribution (P).

### 6.4 Cross-implementation golden fixtures (TS ↔ Rust)

- **WebAssembly arithmetic is deterministic** except for NaN bit patterns, relaxed-SIMD instructions and shared-memory threads [R72]. Avoid relaxed SIMD and threaded reductions in DSP code (P).
- **JS `Math.*` transcendentals are approximated** [R73]. Golden tests therefore compare with tolerances (P):
  - f0 |Δ| ≤ 0.1 c on ≥ 99.9% of voiced frames.
  - Voicing equal on ≥ 99.9% of frames.
  - Note boundaries within ±1 frame.
  - Rendered audio: SNR vs golden ≥ 90 dB, plus the identity test.
- **Function-by-function port:** golden vectors for each stage (difference function, candidates, observation probabilities, Viterbi path, note HMM, vibrato fit, PSOLA marks, PSOLA output) (P).

### 6.5 Listening tests

- **MUSHRA** (ITU-R BS.1534-3) for intermediate-quality impairments, with a hidden reference and low-pass anchors. Screen out listeners who rate the hidden reference below 90 on more than 15% of items [R71].
- **Conditions (P):** PSOLA vs Signalsmith vs a low anchor (plain resampling shift without formant preservation) at ±1, ±3, ±5, ±7 and ±12 st. Four or more voices (low and high male and female). 5–10 s items. 12–20 listeners.
- **ABX** at ±1 st to establish transparency (P).
- Pre-register acceptance thresholds before running the test (P).

---

## 7. Sources

Source columns: Ref; Source; Type; Licence (where relevant); Check (V/S/D as defined at the top).

| Ref | Source | Type | Licence | Check |
|---|---|---|---|---|
| R1 | de Cheveigné & Kawahara, "YIN…", JASA 111(4):1917–1930, 2002, doi:10.1121/1.1458024 | paper | — | S |
| R2 | Mauch & Dixon, "pYIN…", ICASSP 2014, doi:10.1109/ICASSP.2014.6853678 (https://qmro.qmul.ac.uk/xmlui/handle/123456789/6040) | paper | — | S |
| R3 | c4dm/pyin: MonoPitchHMM.cpp, MonoNoteParameters.cpp, PYinVamp.cpp, YinUtil.cpp, COPYING (https://github.com/c4dm/pyin) | repo | GPL-2.0 | V |
| R4 | librosa `pyin`/`yin` source (https://github.com/librosa/librosa/blob/main/librosa/core/pitch.py), LICENSE.md | repo | ISC | V |
| R5 | Mauch et al., "Computer-aided Melody Note Transcription Using the Tony Software…", 2015 (https://zenodo.org/record/1289636) | paper | — | S |
| R6 | McLeod & Wyvill, "A Smarter Way to Find Pitch", ICMC 2005 (https://www.cs.otago.ac.nz/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf); pitch-estimate crate docs on k | paper/docs | — | S |
| R7 | Camacho & Harris, "A sawtooth waveform inspired pitch estimator…", JASA 124(3):1638–1652, 2008 | paper | — | S |
| R8 | Kim et al., "CREPE…", ICASSP 2018 (https://arxiv.org/abs/1802.06182); table values via par.nsf.gov copy and ICASSP slides | paper | — | S |
| R9 | marl/crepe README and LICENSE; gh-pages crepe.js and model/model.json (https://github.com/marl/crepe) | repo | MIT | V |
| R10 | Riou et al., "PESTO…", ISMIR 2023 (https://arxiv.org/abs/2309.02265) | paper | — | S |
| R11 | Riou et al., "PESTO: Real-Time Pitch Estimation…", TISMIR 2025 (https://arxiv.org/abs/2508.01488) | paper | — | S |
| R12 | SonyCSLParis/pesto README (benchmarks) and LICENSE.md (https://github.com/SonyCSLParis/pesto) | repo | LGPL-3.0 | V |
| R13 | Wei et al., "RMVPE…", Interspeech 2023 (https://arxiv.org/abs/2306.15412) | paper | — | S |
| R14 | Dream-High/RMVPE LICENSE (https://github.com/Dream-High/RMVPE) | repo | Apache-2.0 | V |
| R15 | Luo et al., "FCPE…", 2025 (https://arxiv.org/abs/2509.15140) | paper | — | S |
| R16 | CNChTu/FCPE README and LICENSE (https://github.com/CNChTu/FCPE) | repo | MIT | V |
| R17 | Gfeller et al., "SPICE…", 2020 (https://arxiv.org/abs/1910.11664) | paper | — | S |
| R18 | Bittner et al., "A Lightweight Instrument-Agnostic Model…", ICASSP 2022 (https://arxiv.org/abs/2203.09893) | paper | — | S |
| R19 | spotify/basic-pitch and basic-pitch-ts README and LICENSE; npm `@spotify/basic-pitch` 1.0.1 tarball | repo/npm | Apache-2.0 | V |
| R20 | Morrison et al., "Cross-domain Neural Pitch and Periodicity Estimation" (https://arxiv.org/abs/2301.12258); interactiveaudiolab/penn | paper/repo | MIT | S |
| R21 | Babacan et al., "A Comparative Study of Pitch Extraction Algorithms on a Large Variety of Singing Sounds" (https://arxiv.org/abs/1912.12609) | paper | — | S |
| R22 | npm `pitchy` 4.1.0 tarball; ianprime0509/pitchy README and LICENSE | npm/repo | MIT (npm) / 0BSD (repo main) | V |
| R23 | npm `pitchfinder` 2.3.4 tarball; peterkhayes/pitchfinder README | npm/repo | "GNU v3", no LICENSE file | V |
| R24 | npm `essentia.js` 0.1.3 tarball LICENSE; MTG/essentia.js README | npm/repo | AGPL-3.0 | V |
| R25 | npm `aubiojs` 0.2.1 (license file MIT); qiuxiang/aubiojs readme; aubio/aubio COPYING | npm/repo | MIT wrapper + GPL-3.0 core | V |
| R26 | meyda/meyda LICENSE.md | repo | MIT | V |
| R27 | ml5js/ml5-next-gen LICENSE.md and src/index.js; ml5js/ml5-library src/PitchDetection | repo | ml5.js License (custom) | V |
| R28 | npm `onnxruntime-web` 1.31.1 metadata | npm | MIT | V |
| R29 | Microsoft Open Source blog, "ONNX Runtime Web unleashes generative AI in the browser using WebGPU", 2024-02-29 | blog | — | S |
| R30 | npm `@tensorflow/tfjs` 4.22.0 metadata | npm | Apache-2.0 | V |
| R31 | npm `rubberband-wasm` 3.3.0; Daninet/rubberband-wasm LICENSE and README | npm/repo | GPL-2.0 | V |
| R32 | breakfastquay/rubberband README and COPYING (R2/R3 engines, commercial licence) | repo | GPL-2.0+ / commercial | V |
| R33 | Rubber Band docs: RubberBandLiveShifter, `OptionFormantPreserved`; rubberband(1) man page | docs | — | S |
| R34 | SoundTouch (codeberg.org/soundtouch/soundtouch) README mirrors | repo | LGPL-2.1 | S |
| R35 | npm `soundtouchjs` 0.3.0 tarball LICENSE | npm | LGPL-2.1 | V |
| R36 | npm `@soundtouchjs/audio-worklet` 2.1.1 tarball; cutterbl/SoundTouchJS README and LICENSE | npm/repo | MPL-2.0 | V |
| R37 | npm `signalsmith-stretch` 1.3.2 tarball (README, SignalsmithStretch.mjs inspected, not executed) | npm | MIT | V |
| R38 | Signalsmith-Audio/signalsmith-stretch README, LICENSE.txt, signalsmith-stretch.h | repo | MIT | V |
| R39 | Signalsmith-Audio/linear LICENSE.txt | repo | MIT | V |
| R40 | Luff, "Four Ways to Write a Pitch-Shifter", ADC22 (https://www.youtube.com/watch?v=fJUmmcGKZMI) | talk | — | S |
| R41 | bungee-audio-stretch/bungee README and LICENSE; npm `bungee` (unrelated 2013 package) | repo/npm | MPL-2.0 | V |
| R42 | Parabola Research Bungee Pro web demo (https://bungee.parabolaresearch.com/bungee-web-demo) | vendor page | commercial | S |
| R43 | audiojs: npm `@audio/tune-curve` 0.4.0, `@audio/pitch-pyin` 2.1.0, `@audio/stretch-psola` 1.2.3 tarballs and READMEs; audiojs/tune and audiojs/pitch LICENSE; npm search results (`klatt-syn`, `waa-play`, `fast-phase-vocoder`) | npm/repo | MIT | V |
| R44 | Moulines & Charpentier, "Pitch-synchronous waveform processing techniques for text-to-speech synthesis using diphones", Speech Communication 9:453–467, 1990 | paper | — | S |
| R45 | Gutierrez-Osuna, TAMU speech processing lecture L19 (PSOLA) (https://people.engr.tamu.edu/rgutier/lectures/sp/l19.pdf); EP1500080 patent text | lecture/patent | — | S |
| R46 | Verhelst & Roelands, "An overlap-add technique based on waveform similarity (WSOLA)…", ICASSP 1993, vol. 2, pp. 554–557 | paper | — | S |
| R47 | Laroche & Dolson, "Improved phase vocoder time-scale modification of audio", IEEE TSAP 7(3):323–332, 1999 | paper | — | S |
| R48 | Röbel & Rodet, "Efficient spectral envelope estimation and its application to pitch shifting and envelope preservation", DAFx 2005 | paper | — | S |
| R49 | Driedger & Müller, "A Review of Time-Scale Modification of Music Signals", Appl. Sci. 6(2):57, 2016 (https://www.mdpi.com/2076-3417/6/2/57) | paper | CC BY | S |
| R50 | Hildebrand, US 5,973,252, "Pitch detection and intonation correction apparatus and method", 1999 | patent | — | S |
| R51 | Antares Auto-Tune 5 owner's manual (Humanize, Retune Speed); Antelope Audio product page; retailer and MusicRadar descriptions of Auto-Tune Access presets | manual/secondary | — | S |
| R52 | Baran, Autotalent (Debian package description; MLT plugin page; Fedora spec) | software docs | GPL-2.0 | S |
| R53 | Wager et al., "Deep Autotuner…", ICASSP 2020 (https://arxiv.org/abs/2002.05511) | paper | — | S |
| R54 | Killick, Fearnhead & Eckley, "Optimal detection of changepoints with a linear computational cost", JASA 107(500):1590–1598, 2012 | paper | — | S |
| R55 | Nakano, Goto & Hiraga, Interspeech 2006 (https://www.isca-archive.org/interspeech_2006/nakano06_interspeech.pdf) | paper | — | S |
| R56 | Yang, Rajab & Chew, "AVA…", ISMIR 2016, pp. 108–114; Yang PhD thesis (QMUL) | paper/thesis | — | S |
| R57 | Prame 1994 (JASA) vibrato rates, via a secondary summary (MMD digest 1999.10.13); Sundberg definition via a choral review | secondary | — | S |
| R58 | music21 `analysis/discrete.py` (KK, Aarden–Essen, Bellman–Budge, Temperley–Kostka–Payne profile values) (https://github.com/cuthbertLab/music21) | repo | BSD-3 | V |
| R59 | Temperley, "What's Key for Key?…", Music Perception 17(1):65–100, 1999 | paper | — | S |
| R60 | Albrecht & Shanahan, Music Perception 31(1):59–67, 2013; profile values from AMADS `amads/pitch/key/profiles.py` (https://github.com/music-computing/amads) | paper/repo | AMADS MIT | S (paper) / V (values) |
| R61 | mir_eval `melody.py`, `transcription.py` and key docs (https://github.com/mir-evaluation/mir_eval) | repo/docs | MIT | V (code) / S (key docs) |
| R62 | Salamon et al., "Melody Extraction from Polyphonic Music Signals…", IEEE SPM 31(2), 2014 (cited in mir_eval) | paper | — | V (citation) |
| R63 | Molina et al., "Evaluation framework for automatic singing transcription", ISMIR 2014 | paper | — | S |
| R64 | Drugman & Alwan, residual-harmonics paper (https://arxiv.org/abs/2001.00459) and arXiv 2206.14357 (GPE/FPE/VDE definitions; pYIN voicing comparison) | paper | — | S |
| R65 | Bittner et al., "vocadito…" (https://arxiv.org/abs/2110.05580); mirdata loader | paper/docs | CC BY 4.0 | S |
| R66 | Wilkins et al., "VocalSet…", ISMIR 2018; Zenodo 1193957 | paper/dataset | CC BY 4.0 | S |
| R67 | MDB-stem-synth, Zenodo 1481172 | dataset | CC BY-NC 4.0 | S |
| R68 | PTDB-TUG, TU Graz SPSC page | dataset | ODbL / DbCL | S |
| R69 | MIR-1K, Zenodo 3532216 (restricted) and mirlab.org | dataset | none stated | S |
| R70 | Duan et al., NUS sung and spoken lyrics corpus, APSIPA 2013 | paper/dataset | none found | S |
| R71 | ITU-R BS.1534-3 (MUSHRA), 2015 | standard | — | S |
| R72 | WebAssembly design, Nondeterminism.md (https://github.com/WebAssembly/design) | spec | — | V |
| R73 | ECMA-262 spec.html, "Function Properties of the Math Object" note (https://github.com/tc39/ecma262) | spec | — | V |
| R74 | crates.io metadata: pyin 1.2.0 (MIT), rubato 5.0.1 (MIT/Apache), realfft 3.5.1 (MIT), rustfft 6.4.1 (MIT/Apache), signalsmith-stretch 0.1.3 (MIT), ssstretch 0.1.0 (MIT), bungee-rs 0.1.1 (MPL-2.0), rubberband 0.1.5 (GPL-2.0+), tdpsola 0.1.0 (AGPL-3.0), irapt 0.2.0 (AGPL-3.0), aubio-rs 0.2.0 (GPL-3.0), pitch-detection 0.3.0 (MIT/Apache), pitch_shift 2.1.0 (MIT), ort 2.0.0-rc.15, tract-onnx 0.23.9, candle-core 0.11.0 (MIT/Apache) | registry | as listed | V |
| R75 | Sytronik/pyin-rs README ("based on librosa") | repo | MIT | V |
| R76 | Fant, Liljencrants & Lin, "A four-parameter model of glottal flow", STL-QPSR 4/1985 | paper | — | S |
| R77 | Murty & Yegnanarayana, "Epoch extraction from speech signals", IEEE TASLP 16(8), 2008 (zero-frequency filtering) | paper | — | S |
| R78 | Informal LGPL/WASM compliance discussions (OpenCascade forum, Qt forum, LibRaw WASM relinking page, JxBrowser LGPL page) | forums | — | S |
| R79 | Liu & Akama, "Self-supervised restoration of singing voice degraded by pitch shifting…" (https://arxiv.org/abs/2601.10345) | preprint | — | S |
| R80 | magenta/ddsp LICENSE | repo | Apache-2.0 | V |

### 7.1 Rust portability summary (G)

| Component | Rust path | Licence | Note |
|---|---|---|---|
| FFT | `realfft` / `rustfft` [R74] | MIT / MIT-Apache | Direct |
| Decimation / resampling | Shared FIR constants; `rubato` [R74] if general resampling is needed | MIT/Apache | Keep the analysis path FIR-only |
| YIN / MPM | Own port; `pitch-detection` as oracle [R74] | MIT/Apache | Small |
| pYIN | Own port; `pyin` crate as oracle (librosa-derived) [R74][R75] | MIT | Same parameters as §3.2 |
| Note HMM, Viterbi, PELT, vibrato fit, key | Own (small, pure arithmetic) | — | Golden vectors per stage |
| TD-PSOLA / WSOLA | Own; avoid `tdpsola` (AGPL) [R74] | — | ~1k LOC (P) |
| Signalsmith alternative | `signalsmith-stretch` (MIT wrapper) or `ssstretch` [R74] | MIT | Use the seeded constructor [R38] |
| Bungee | `bungee-rs` [R74] | MPL-2.0 | Optional |
| Rubber Band | `rubberband` crate [R74] | GPL-2.0+ | Commercial licence only |
| Neural trackers | `ort` / `tract` / `candle` [R74] | MIT/Apache | Same ONNX file as the web build |

**Method note.** No downloaded code was executed. npm tarballs were unpacked into separate scratch folders and only read. Primary PDFs on arxiv.org, qmul.ac.uk, core.ac.uk, sigport.org, zenodo.org and dafx.de were unreachable under this session's network policy. Those figures are marked S and should be re-checked before external citation.
