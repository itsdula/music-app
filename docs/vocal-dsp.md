# Vocal DSP: monophonic analysis and pitch correction (`@studio/vocal-dsp`)

**Status:** implemented and tested. **Algorithm version:** `vocal-dsp/1.0.0`
(`VOCAL_ALGORITHM_VERSION`). **Design input:** [research dossier](research/vocal-dsp-options.md)
(cited as "R§n"). **Fixtures:** `@studio/test-fixtures`.

Studio's vocal editor works in the spirit of Melodyne: it shows notes, lets the user correct
pitch, and renders the result for real. The resemblance is conceptual only. No proprietary UI
or algorithm was copied. Every algorithm here was written from papers and permissively
licensed descriptions: the pYIN and YIN papers, librosa's ISC-licensed pYIN description,
Killick et al. on PELT, Moulines and Charpentier on TD-PSOLA, and published key profiles. No
GPL, AGPL or LGPL code was used. In particular, nothing comes from c4dm pyin, Tony, aubio,
essentia or the `tdpsola` crate.

## 1. Scope

- **Input:** one monophonic voice (a solo vocal take). The audio may be dry or lightly
  reverberant, at 44.1, 48 or 96 kHz (any rate from 16 kHz up works), with any number of
  channels. Analysis uses the channel mean. Rendering processes every channel with the same
  pitch marks, so the stereo image is preserved.
- **Analysis:** the package produces:
  - a pitch track (f0 and voicing every 5 ms);
  - non-pitched regions (silence, breath, sibilant, other unvoiced sound);
  - note segments, each with a centre, confidence, drift and vibrato;
  - ranked key candidates.
- **Correction:** two curves are computed per frame: the target pitch (fractional MIDI) and
  the shift ratio. Their inputs are:
  - manual targets per note;
  - snapping to a scale, scaled by an amount;
  - retune speed and humanize;
  - drift and vibrato (modulation) scaling;
  - transitions between notes.
- **Rendering:** TD-PSOLA. Formants are preserved intrinsically, and an optional formant shift
  is available. The output has exactly the input's length. Audio that is not edited is copied
  sample for sample.
- **Not in scope:**
  - time-stretching (`capabilities.timeStretch = false`);
  - polyphonic material;
  - UI;
  - creating Web Workers (the host owns the 5-line worker entry, see §11.3).

## 2. Pipeline

```
PcmAudio (planar float32, N channels)
  │ downmixToMono (channel mean)
  ▼
trackPitch ── observePitch ─ per 5 ms frame: short + long silence gate → YIN difference
  │                          function via FFT → CMNDF → troughs (parabolic) → pYIN candidate
  │                          probabilities (Beta(2,18) thresholds × Boltzmann) → voicing
  │                          evidence (logistic of min CMNDF) → frame RMS
  │           decodePitch ── HMM: 490 pitch bins (10 c) × {voiced, unvoiced}, triangular
  │                          ±22-bin transitions, 1 % voicing switch; log-domain Viterbi,
  │                          chunked at ≥ 0.25 s silences → refined YIN f0 per voiced frame
  ▼
PitchTrack {f0Hz, voicedProbability, rmsDb} ──► classifyNonPitched → NonPitchedRegion[]
  │
  ├─► segmentNotes: voiced runs → median filter → PELT (σ scaled by vibrato) → merges /
  │                 portamento transitions / min duration → describeSegment
  │                 (analyzeNoteExpression: centre, drift, vibrato) → VocalNoteSegment[]
  └─► keyCandidatesFromSegments → estimateKey (Aarden–Essen + Albrecht–Shanahan) → KeyCandidate[]

VocalAnalysis + VocalEditDoc
  │ computeTargetPitchCurve (target MIDI per frame, NaN = untouched)
  │ computePitchRatioCurve  (2^(Δ/12) ∈ [0.5, 2], 1 = untouched)
  ▼
renderPitchCorrection: detectPitchMarks → active spans (ratio ≠ 1, + margins) →
  TD-PSOLA grains → normalised overlap-add → level matching → fade in/out → PcmAudio
```

## 3. Chosen algorithms and alternatives

| Stage       | Chosen                                                                                                                                                           | Research recommendation                                               | Alternatives considered                                                 | Reason                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Pitch       | pYIN: YIN candidates with a Beta prior over thresholds, then an HMM decoded by Viterbi, reporting refined YIN frequencies                                        | pYIN (R§1.1, R§2.1, R§3.2)                                            | CREPE or FCPE through ONNX (optional "robust" mode, R§1.3); MPM; SWIPE′ | Deterministic and cheap; the strongest DSP option for singing. Measured RPA is 98.8 % on the clean fixture set (§10.2).            |
| Pitch bins  | 10-cent bins with full Viterbi, ±22 bins per 5 ms                                                                                                                | 10 c with ±25 bins (R§3.2)                                            | Banded transitions, coarser bins, candidate pruning                     | Not needed: full decoding runs at 0.040× real time against a 0.15× budget (§10.1).                                                 |
| Voicing     | Logistic evidence from the smallest CMNDF value; `voicingThreshold` is the neutral point in the HMM                                                              | Summed candidate mass with HMM voicing (R§3.2)                        | Thresholding the summed mass                                            | **Deviation**, see §3.1.                                                                                                           |
| Non-pitched | Silence gate plus "RMS frequency" (energy ratio of the first difference) plus duration rules                                                                     | (not specified)                                                       | Spectral centroid via FFT                                               | Costs O(1) per frame with prefix sums; enough to separate sibilants (≥ 3 kHz) from breath.                                         |
| Notes       | PELT change points on the median-filtered pitch curve. The noise scale σ comes from the run's vibrato extent (robust MAD). Post-rules follow.                    | Tony-style note HMM (R§3.3); PELT listed as the alternative (R§4.1)   | Tony note HMM; a heuristic jump detector                                | **Deviation**, see §3.2.                                                                                                           |
| Expression  | Median centre and least-squares drift over the stable portion. Vibrato from 81-rate sinusoid fits (4–8 Hz in 0.05 Hz steps) over 0.5 s windows with a 0.1 s hop. | As R§3.4, with a 46 ms window hop                                     | Filter-diagonalisation method (AVA)                                     | Same acceptance rules as R§3.4. The 0.1 s hop halves the cost with no measured loss.                                               |
| Key         | Aarden–Essen (correlation) plus Albrecht–Shanahan (Euclidean) ensemble; z-scores, temperature softmax, evidence shrinkage                                        | The same ensemble with calibrated softmax and an abstain rule (R§4.2) | Krumhansl–Kessler, Temperley                                            | As recommended. "Abstain" is expressed as shrinkage, because `KeyCandidate` has no abstain field (§13).                            |
| Rendering   | TD-PSOLA with correlation-tracked pitch marks                                                                                                                    | TD-PSOLA (R§1.2)                                                      | Signalsmith Stretch WASM behind `VocalProcessor` (R§1.3, §12)           | Formants preserved intrinsically; small, deterministic and portable to Rust. Measured re-analysis error is ≤ 0.7 c median (§10.4). |

### 3.1 Deviation: voicing evidence

pYIN's voiced probability is the summed candidate mass, Σp. It falls steeply because of the
Beta(2, 18) prior: 0.42 at CMNDF 0.1, 0.08 at 0.2 and 0.007 at 0.3. Thresholding it at the
contract's default `voicingThreshold` of 0.5 would mark breathy or vibrato frames unvoiced.
librosa avoids this by letting the HMM decide.

The contract defines the threshold as "frames whose voiced probability falls below this are
unvoiced". To honour that and keep breathy singing voiced, the voicing evidence is computed
as follows:

- The evidence is v = σ((0.32 − min CMNDF) / 0.06), a logistic function.
- In the HMM, voiced states get v·q(bin), where q is the normalised pYIN candidate
  distribution.
- Unvoiced states get (1 − v)·θ/(1 − θ), with θ = `voicingThreshold`.

A frame whose evidence equals θ is therefore neutral, and the HMM's 1 % switch cost smooths
the decision. `PitchTrack.voicedProbability` holds v (0 for silence-gated frames). The pitch
side of pYIN is unchanged. Measured results:

- 0 % false alarms on white noise, breath (−30 and −18 dBFS), sibilants and silence;
- ≥ 98.6 % voicing recall on clean vowels;
- 99.6 % voicing recall on a breathy vowel at about 10 dB HNR.

### 3.2 Deviation: PELT instead of the Tony note HMM

The note HMM needs about 621 states plus tuned emission parameters (R§3.3). Re-deriving and
tuning it from the paper alone was the larger risk. PELT is the alternative the research names
for the same interface (R§4.1). It has no trained parameters, its penalty is an intuitive
"sensitivity" control, and it is O(n) in practice.

Smoothing before PELT turned large steps into staircases, so PELT runs on the median-filtered
curve, z. Vibrato robustness comes from the noise scale instead: σ = max(40 c, 1.25 · 1.4826 ·
MAD(z − y)), where y suppresses vibrato. With this σ, splitting a vibrato into half-cycles
never pays. Measured note F-measure is 100 % on legato, staccato, 150 ms-note, vibrato and
portamento melodies (§10.3). Known weak spot: vibrato wider than ±100 c combined with legato
steps of two semitones or less (§9).

## 4. Parameters

### 4.1 `VocalAnalysisParams` (contract)

| Parameter            | Default   | Meaning in this implementation                                                                                                                                    |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minHz` / `maxHz`    | 65 / 1100 | YIN lag range, from ⌊fs/maxHz⌋ to ⌈fs/minHz⌉. Also the HMM bin range: 490 bins at 10 c. Validated: minHz ≥ 20, and maxHz > 1.5 · minHz.                           |
| `frameSeconds`       | 0.046     | Analysis window N. It sets the RMS window, the YIN integration window W = N/2, and the spectral features of the non-pitched classifier. Allowed range 0.01–0.2.   |
| `hopSeconds`         | 0.005     | Rounded to whole samples; `PitchTrack.hopSeconds` reports the exact value (221/44100 s at 44.1 kHz). Frame i is centred at i·hop, with zero padding at the edges. |
| `voicingThreshold`   | 0.5       | Neutral point of the voicing evidence in the HMM (§3.1). Allowed range (0, 1).                                                                                    |
| `silenceThresholdDb` | −50       | A frame is gated (unvoiced, labelled silence) if its full-window RMS or its RMS over a short centred window (N/4, at least 2 hops) is below this level.           |
| `minNoteSeconds`     | 0.06      | Minimum PELT segment length and minimum note duration.                                                                                                            |

Derived framing:

| Rate     | Hop | N    | W    | τ range | YIN span | FFT  |
| -------- | --- | ---- | ---- | ------- | -------- | ---- |
| 44.1 kHz | 221 | 2029 | 1014 | 40–679  | 1695     | 2048 |
| 48 kHz   | 240 | 2208 | 1104 | 43–739  | 1845     | 2048 |
| 96 kHz   | 480 | 4416 | 2208 | 87–1477 | 3687     | 4096 |

Rates above 48 kHz are analysed natively. They are not decimated as R§3.1 suggests, because
the cost is about 2× at 96 kHz, still well within budget.

### 4.2 Internal constants

All constants are exported for tests, documentation and Rust ports.

**Pitch tracker (`pitch/pyin.ts`).** These follow librosa unless noted.

- Thresholds: 100 thresholds over 0.01–1.00, with a Beta(2, 18) prior.
- Trough prior: Boltzmann with λ = 2.
- No-trough probability: 0.01.
- Bins: 10 c (`PITCH_BIN_CENTS`).
- Maximum transition: 35.92 octaves per second, which is ±22 bins per frame.
- Voicing switch probability: 0.01.
- Voicing logistic: midpoint 0.32, slope 0.06, chosen by hand from measurements. Noise and
  breath frames measured v ≤ 0.10 (minimum CMNDF ≥ 0.45). Voiced fixtures, breathy vowels
  included, measured v ≥ 0.99 on 95 % of frames (minimum CMNDF ≤ 0.05).
- Viterbi chunks are split at silence-gated runs ≥ 0.25 s, and capped at 60 s (backpointers use
  one byte per state: about 0.2 MB per second of audio, 12 MB for a 60 s chunk).
- Initial state: uniform. Ties go to the lowest state index.

**Non-pitched classifier (`nonpitched.ts`).**

- A frame is sibilant when its RMS frequency is ≥ 3 kHz and the run lasts ≥ 50 ms. A shorter
  run is a plosive burst and is labelled `unvoiced`.
- Breath runs must last ≥ 60 ms; shorter ones are labelled `unvoiced`.
- Label runs shorter than 20 ms are absorbed by the longer neighbour.

**Segmentation (`SEGMENTATION_PARAMS`).**

| Constant                                                         | Value                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Gap bridging (unvoiced gaps shorter than this stay inside a run) | 30 ms                                                           |
| Median filter                                                    | 5 frames                                                        |
| Vibrato-suppressing smoothing (used only to estimate σ)          | 1/5 s then 1/6.5 s moving averages                              |
| σ                                                                | max(40 c, 1.25 · 1.4826 · MAD)                                  |
| PELT penalty per note                                            | 10 (in units of σ²)                                             |
| Merge: near-unison neighbours                                    | < 35 c                                                          |
| Merge: drifting notes, continuous at the boundary                | < 80 c, with a jump of < 20 c between 25 ms medians either side |
| Merge: run-edge pieces                                           | < 0.25 s and within 80 c                                        |
| Portamento: a segment counts as a ramp when                      | ≤ 0.3 s long and absolute slope ≥ 500 c/s                       |

Ramps between stable notes are left unsegmented as transitions. A run made only of ramps
becomes one glide note. Segment ids are `vn_<index>_<firstFrame>`.

**Expression (`EXPRESSION_PARAMS`).**

- Stable portion: the first 15 % and the last 10 % of the note are trimmed when the note is
  ≥ 0.2 s long.
- Centre: median over the stable portion. Drift: least-squares slope, expressed as end minus
  start over the note.
- Vibrato windows: 0.5 s with a 0.1 s hop; the rate grid is 4–8 Hz in 0.05 Hz steps.
- A window is accepted when the depth is 15–150 c, the explained variance is ≥ 0.5, and there
  are ≥ max(3, ⌊1.2·rate·window⌋) mean crossings.
- Vibrato is reported when ≥ 50 % of windows are accepted (the medians are reported) and the
  stable portion is ≥ 0.4 s.

**Key (`key.ts`).**

- Softmax temperature 0.15 (§8).
- At most 6 candidates are returned.
- Full confidence needs ≥ 12 notes and ≥ 5 pitch classes; below that, confidences shrink
  linearly in each.
- Segments shorter than 80 ms are ignored. Each segment's weight is duration × max(0.05,
  confidence).

**Correction (`CORRECTION_PARAMS`).**

- The slow/fast split uses moving averages of 250 ms and 167 ms (nulls at 4 and 6 Hz).
- Voiced gaps up to 0.3 s between processed notes are interpolated.
- Release time: 40 ms.
- Identity epsilon: 0.01 c.

**Pitch marks (`PITCH_MARK_PARAMS`).**

- Bridging: up to 2 unvoiced frames between frames less than 1 semitone apart.
- Correlation search: ±12 % of a period. Peak snap: ±4 % of a period.
- Marking stops when a period keeps < 20 % of the previous period's energy.

**PSOLA (`PSOLA_PARAMS`).**

- Window-sum floor: 0.5.
- Level-matching window: 100 ms.
- Ratio epsilon: 1e-6.

## 5. Correction model

Notation, for one voiced frame at time t inside note n:

- c(t): the detected pitch, in fractional MIDI.
- μ: the note's `detectedMidi`; D = `driftCents`/100.
- dur and mid: the note's duration and midpoint.
- δ(t) = D·(t − mid)/dur: the note's linear trend (drift).
- e(t) = c(t) − μ − δ(t): the within-note deviation.
- e_s: the slow part of e (cascaded 250 ms and 167 ms moving averages over the note's voiced
  frames, windows shifted inward at the edges). e_f = e − e_s: the fast part (vibrato,
  jitter).
- The note edit is `doc.noteEdits[id]`, falling back to `DEFAULT_VOCAL_NOTE_EDIT`. All settings
  are clamped to their documented ranges.

Per-note offset:

```
T     = edit.targetMidi                              (manual)
      | nearestScaleNote(μ, correction.key)          (auto, key set)
      | round(μ)                                     (auto, key null)
Δ     = T − μ                (manual: applied fully, whatever the amount)
      | amount · (T − μ)     (auto)
f     = amount · (1 − humanize)              fraction of slow variation removed
o(t)  = Δ − driftCorrection·δ(t) + (modulationScale − 1)·e_f(t)
          + (modulationScale·(1 − f) − 1)·e_s(t)
```

Rules:

1. **Strength.** Automatic correction scales with `amount`: the snap and the flattening of slow
   variation both do. A manual `targetMidi` replaces the snapped target and moves the centre
   fully. Flattening still follows `amount` and `humanize`.
2. **Modulation.** `modulationScale` scales the whole deviation from the note's trend: 0 is
   flat, 1 is unchanged, 2 is doubled.
3. **Drift.** `driftCorrection` removes that fraction of the fitted linear drift.
4. **Humanize.** Keeps slow natural variation. With `amount` 1, humanize 0 flattens it fully
   and humanize 1 keeps it fully. Vibrato (e_f) is never flattened by humanize; it only
   follows `modulationScale`.
5. **Note starts.** The offset follows a raised-cosine ramp R(x) = ½ − ½cos(πx) from a start
   value to o(t): `offset(t) = start + (o(t) − start)·R((t − onset)/L)`.
   - Legato (the frame before the onset is voiced): start is the offset of that frame (0 if
     it is untouched), and L = max(`transitionMs`, auto ? `retuneSpeedMs` : 0).
   - After silence or unvoiced audio: start = 0. L = `retuneSpeedMs` for automatic notes, so
     the natural attack is kept and the target is reached after the retune time. L = 0 for
     manual notes: a dragged note starts at its new pitch.
   - L = 0 means an instant change.
6. **Transitions.** If the frames between two processed notes are all voiced and the gap is
   ≤ 0.3 s, the offset is interpolated linearly from the end of the first note to the start of
   the next. The original glide shape is kept and its end points move.
7. **Release.** If voicing continues after a processed note into unprocessed audio, the offset
   decays to 0 over 40 ms; after that the frames are untouched.
8. **Untouched (NaN).** These frames get NaN: bypassed notes (which also block interpolation
   and release), unvoiced frames, frames outside processed notes, and every frame when
   `doc.enabled === false`.
9. **Ratio.** `computePitchRatioCurve` gives ratio(t) = clamp(2^((target − c)/12), 0.5, 2).
   It is exactly 1 where the target is NaN, the frame is unvoiced, or |target − c| < 0.01 c.
   The last case keeps float32 rounding from triggering processing.
10. **Segments and defaults.** `computeTargetPitchCurve` uses the segments it is given:
    `doc.segments` in the renderer, which include the user's splits and merges. They are
    processed in time order, so their input order does not matter. With
    `DEFAULT_VOCAL_CORRECTION` (`amount` 0) and no edits, the output is the identity.

## 6. TD-PSOLA renderer

1. **Analysis.** The source is mixed to mono for analysis only.
   - Voiced runs come from the pitch track. Gaps of up to 2 frames are bridged when the pitch
     is continuous; inside a bridged gap, f0 and ratio are interpolated.
   - Pitch marks: the first mark of a run is the largest |x| in its first period. Each next
     mark is predicted one period ahead, using f0 at the midpoint. It is then refined by the
     best normalised cross-correlation with the previous period (search ±12 % of a period) and
     snapped to the largest |x| within ±4 %.
   - Marking stops when the comparison window would leave the run or the energy falls below
     20 %.
2. **Active spans.** A span covers the frames whose ratio departs from 1, plus 2 periods on
   each side. Spans closer than 4 periods are merged. When a formant shift is set, every
   voiced run is a span. Everything else is copied sample for sample: unvoiced and non-pitched
   audio, bypassed notes, and unedited voiced audio.
3. **Grains and synthesis.**
   - Each grain is two periods long with an asymmetric Hann window: a rising half over the
     previous period and a falling half over the next one, centred on an analysis mark.
   - The first synthesis mark is the first analysis mark of the span. Then s_{j+1} = s_j +
     P(s_j)/β(s_j), where P is the analysis period interpolated from the mark spacing and β is
     the ratio interpolated per sample.
   - Each synthesis mark copies the grain of the nearest analysis mark. The time scale is 1, so
     durations are exact.
4. **Overlap-add.** out = Σ w·g / max(Σ w, 0.5). For β = 1 the windows sum to 1, so
   reconstruction is exact. For β > 1 normalisation keeps the level. For β < 1 the windows
   stop overlapping below a ratio of about 0.67 (−7 st), and the floor lets the edges of each
   grain fade.
5. **Level matching.** Normalised PSOLA keeps the amplitude of each harmonic but changes how
   many harmonics there are (about −10·log10 β dB), and grains interfere. A per-sample gain,
   √(E_orig/E_out) over 100 ms windows and clamped to [¼, 4], restores the original loudness
   contour. Measured level error is ≤ 0.06 dB. Shorter windows modulate the output: 30 ms cost
   about 3 dB of harmonic-to-noise ratio.
6. **Edges.** Output fades in from the original over one period before the first mark, which
   is seamless because the first grain sits at its own position. It fades back to the original
   over one period after the last synthesis grain. At that point the time alignment can differ
   by up to half a period, which can cause a brief comb effect lasting one period.
7. **Ratio limits.** The ratio is clamped to [0.5, 2] (±12 st), the classical PSOLA range
   (R§2.3).
8. **Formants.** They are preserved intrinsically, because grains are not resampled. A formant
   shift resamples each grain by γ = 2^(shift/12) using Catmull-Rom interpolation. With
   `formantPreservation: false`, γ = β·2^(shift/12): formants follow the pitch, which
   reproduces "chipmunk" resampling.
9. **Multichannel.** Marks, spans, windows and gains are shared, and each channel's own samples
   are placed. Channel relationships are preserved exactly: a channel that is −0.5 × another
   stays −0.5 × after rendering.
10. **Artefacts at large shifts.** The shift is still accurate at large sizes; ±12 st is still
    within 0.06 c. The cost shows up as artefacts:
    - Measured harmonic-to-noise ratio (method in §10.6) falls from 36.6 dB to 31.6–33.5 dB at
      ±1 to ±7 st.
    - Pitch-down beyond −7 st leaves gaps between grains, which sound buzzy.
    - Repeating grains for large pitch-up shifts sounds metallic (R§2.3).
    - Breathy or creaky takes produce irregular marks.

## 7. Preview and final quality

| Aspect                                                    | `preview`                                | `final`                                                 |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------- |
| Musical edits, pitch marks, spans, ratios, level matching | identical                                | identical                                               |
| Grain placement                                           | synthesis marks rounded to whole samples | fractional positions, 4-point Catmull-Rom interpolation |
| Grain resampling (formant shift)                          | linear interpolation                     | Catmull-Rom interpolation                               |
| Re-analysis error, +2 st at 220 Hz                        | 0.50 c median                            | 0.16 c median                                           |
| Harmonic-to-noise ratio, +2 st at 150 Hz                  | 28.7 dB                                  | 33.5 dB                                                 |
| Speed (60 s at 48 kHz, every note corrected)              | 0.013× real time                         | 0.013× real time                                        |

In JS the speed difference is negligible. Preview is kept so that a WASM or Rust engine can
make it cheaper (for example, without interpolation). The contract promises only "same edits,
possibly cheaper processing".

## 8. Key estimation

- **Input:** duration-weighted notes, either analysed segments or MIDI notes from any clip.
  For MIDI, the weight is the duration in any unit. A global tuning offset (the weighted
  circular mean of the fractional MIDI parts) is removed first. The 12-bin histogram is
  normalised.
- **Scores:** for each of the 24 major and natural-minor keys:
  - Pearson correlation with the Aarden–Essen profile;
  - negative Euclidean distance to the Albrecht–Shanahan profile;
  - each model's 24 scores are z-normalised, then the two are averaged.
- **Probabilities:** a softmax with temperature T = 0.15. The maximum-likelihood T on
  `KNOWN_MELODIES` is 0.10 (in-sample NLL 0.118). T = 0.15 (NLL 0.141, mean top-1 confidence
  0.92 at 93 % top-1 accuracy) leaves headroom for noisier real-vocal notes. The probabilities
  are then multiplied by an evidence factor, min(1, notes/12) · min(1, pitch classes/5). The
  missing mass means "no confident key". At most 6 candidates are returned, and their
  confidences sum to ≤ 1.
- **Product rule:** the key is a suggestion. Scale snapping uses `correction.key`, which the
  user confirms.
- **Limitations, to show in the UI:**
  - **Relative major/minor:** these share all seven pitch classes. Tonal weighting decides, and
    melodies that dwell on the third get close scores (Jingle Bells: G 0.56 vs Em 0.41).
    Always show the relative key next to the top suggestion.
  - **A cappella and short excerpts:** there is no harmony to anchor the tonic. Fewer than 12
    notes or 5 pitch classes shrinks confidences.
  - **Modal, pentatonic, blues and chromatic lines:** only major and minor are modelled. Modal
    tunes get their parent family; D dorian, for example, gets D minor. Chromatic inflections
    can flip the result: "In the Hall of the Mountain King" gives D major over B minor.
  - **Modulation:** the estimate is global. There is no windowed key tracking yet.

## 9. Known limitations to disclose in the UI

1. **Monophonic only.** Doubled vocals, harmonies, accompaniment bleed and heavy reverb break
   pitch tracking and pitch marks.
2. **Time resolution.** The pitch is averaged over a 38 ms YIN span:
   - vibrato extent reads 2–10 % low (median error 10 c at ±60 c / 5.5 Hz);
   - very fast glides (≈ 60 st/s) blur at the corners, with RPA 94.6 % on that fixture;
   - voicing boundaries can be 1–2 frames late or early.
3. **Octave and voicing errors.** Possible on creaky or fry voice, whisper, very high soprano
   notes and strongly breathy singing. None occurred on the fixtures, octave traps included,
   but real takes are harder.
4. **Segmentation.** Repeated notes of the same pitch sung legato are one note (there is no
   onset detector yet; use split). Vibrato wider than ±100 c combined with legato steps of
   ≤ 2 semitones can produce an extra short note at the transition. Notes under 60 ms are
   dropped.
5. **Large shifts sound processed.** About ±3 st is near-transparent on clean takes (to be
   confirmed by listening tests, R§6.5). Beyond ±7 st artefacts are audible, and ±12 st is an
   effect. Formant shift is offered for ±3 st; it was measured objectively only.
6. **Unvoiced audio is never shifted.** Sibilants and breath stay as recorded, by design.
7. **Rendering is offline.** An edit re-renders the affected regions (preview quality) before
   playback reflects it.
8. **No time-stretching.**
9. **Numerics.** Results are bit-identical on one JS engine and build. Other engines may differ
   in the last bits because `Math.*` transcendentals are implementation-approximated (R§6.4).

## 10. Measured results

Method: Node 22.22, one thread, a 4-core container, Vitest 5. Fixtures come from
`@studio/test-fixtures` and are deterministic. Each fixture is a band-limited Rosenberg glottal
source through a 5-formant Klatt cascade, with exact ground-truth f0. Metrics follow mir_eval
conventions (`computePitchMetrics`). The numbers are printed by the tests listed in each
section. The benchmark runs with `VOCAL_BENCH=1 pnpm exec vitest run --project unit
packages/vocal-dsp/tests/benchmark.test.ts`.

### 10.1 Performance

Test: `benchmark.test.ts`. Input: 60 s at 48 kHz mono, a melody with vibrato and detuning,
100 notes. Each figure is the best of 3 runs after warm-up.

| Stage                                                   | Time    | × real time | Target |
| ------------------------------------------------------- | ------- | ----------- | ------ |
| `analyzeVocal`, full (pitch, classes, notes, key)       | 2.37 s  | **0.040**   | ≤ 0.15 |
| ↳ YIN and candidates (`observePitch`)                   | ≈ 1.4 s | 0.024       |        |
| ↳ Viterbi over 980 states (`decodePitch`)               | ≈ 1.0 s | 0.017       |        |
| `renderPitchCorrection` preview (`amount` 1, all notes) | 0.79 s  | **0.013**   | ≤ 0.1  |
| `renderPitchCorrection` final                           | 0.77 s  | **0.013**   | ≤ 0.1  |

Test suite: 138 tests in 12 s, or 51 s with coverage. Line coverage of `vocal-dsp/src` is
97.8 %.

### 10.2 Pitch tracking

Test: `pitch.test.ts`. Fixtures are 1.6 s each, at 48 kHz unless noted.

| Fixture                                                     | RPA (50 c)        | GPE           | Octave errors | Voicing recall    | Median error        |
| ----------------------------------------------------------- | ----------------- | ------------- | ------------- | ----------------- | ------------------- |
| Steady 70 / 110 / 220 / 440 / 880 Hz (vowels o, a, e, i, u) | 98.9–100 %        | 0 %           | 0 %           | 98.9–100 %        | ≤ 0.11 c            |
| Vibrato 220 Hz, ±60 c at 5.5 Hz                             | 99.6 %            | 0 %           | 0 %           | 99.6 %            | 10.3 c              |
| Vibrato 330 Hz, ±120 c at 6.5 Hz                            | 99.3 %            | 0 %           | 0 %           | 99.6 %            | 23.3 c              |
| Glide 150→600 Hz in 1 s                                     | 99.3 %            | 0 %           | 0 %           | 99.3 %            | 15.9 c              |
| Glide 500→180 Hz in 0.3 s (≈ 59 st/s)                       | **94.6 %**        | 0 %           | 0 %           | 99.6 %            | 0.09 c (p95 49.8 c) |
| Melody with vibrato                                         | 98.3 %            | 0 %           | 0 %           | 98.6 %            | 5.6 c               |
| **Aggregate, clean set**                                    | **98.8 %** (≥ 95) | **0 %** (≤ 2) | 0 %           | **99.3 %** (≥ 95) | 0.11 c              |
| Breathy (HNR ≈ 10 dB) / jitter 0.5 % with shimmer 5 %       | 99.6 / 99.3 %     | 0 %           | 0 %           | 99.6 / 99.3 %     | 0.65 / 1.5 c        |
| Octave trap: /i/ at 135 Hz, H2 on F1                        | 98.9 %            | 0 %           | 0 %           | 98.9 %            | 0.0 c               |
| 44.1 kHz vibrato / 96 kHz steady                            | 99.6 / 99.3 %     | 0 %           | 0 %           | 99.6 / 99.3 %     | 10.6 / 0.0 c        |

Voicing false alarms are **0.00 %** on white noise (−26 dBFS), breath (−30 and −18 dBFS), a
sibilant (−24 dBFS) and digital silence; the target is ≤ 10 %.

On vowel fixtures, 0–10 % of the ground-truth unvoiced frames are reported voiced. These are
frames within about 20 ms of a voicing edge, where the window still overlaps the vowel or its
decaying formant resonance. They are not noise detections.

### 10.3 Notes and expression

Test: `segmentation.test.ts`. A note matches when its onset is within ±50 ms and its pitch
within ±50 c. Repeated legato notes of the same pitch are merged in the reference.

| Melody (Twinkle Twinkle, first 21 notes) | Reference notes | Segments | F-measure |
| ---------------------------------------- | --------------- | -------- | --------- |
| Legato, 100 bpm                          | 12              | 12       | 100 %     |
| Staccato, 120 bpm                        | 21              | 21       | 100 %     |
| 200 bpm (150 ms notes)                   | 12              | 12       | 100 %     |
| Vibrato ±60 c at 5.5 Hz                  | 12              | 12       | 100 %     |
| 80 ms portamento                         | 12              | 12       | 100 %     |

Vibrato measurement on 2 s notes:

| True vibrato   | Measured         | Explained variance |
| -------------- | ---------------- | ------------------ |
| 5.5 Hz, ±60 c  | 5.50 Hz, ±58.6 c | 1.00               |
| 6.5 Hz, ±30 c  | 6.50 Hz, ±29.0 c | 1.00               |
| 4.5 Hz, ±100 c | 4.50 Hz, ±98.6 c | 1.00               |

A drift of +80 c/s is measured as 80 ± 10 c/s, with no vibrato reported.

### 10.4 Correction accuracy

Test: `render.test.ts`. Fixture: a 0.2 s sibilant, a 1.4 s vowel and a 0.2 s breath. The note
gets a manual target of +2 or −3 semitones. The output is re-analysed, and the error is
measured on 0.45–1.45 s.

| Shift and fixture               | Median error, preview / final | p95, final | Sibilant and breath difference | Level change |
| ------------------------------- | ----------------------------- | ---------- | ------------------------------ | ------------ |
| +2 st, 220 Hz /a/               | 0.50 / 0.16 c                 | 0.90 c     | bit-identical (−∞ dB)          | −0.03 dB     |
| −3 st, 220 Hz /a/               | 0.18 / 0.13 c                 | 0.70 c     | bit-identical                  | −0.06 dB     |
| +2 st, 131 Hz /e/               | 0.59 / 0.41 c                 | 0.92 c     | bit-identical                  | −0.06 dB     |
| −3 st, 175 Hz /o/               | 0.64 / 0.23 c                 | 0.82 c     | bit-identical                  | −0.04 dB     |
| ±12 st (150 Hz up, 300 Hz down) | ≤ 0.06 c                      |            |                                |              |

Targets: median error ≤ 10 c, unchanged regions ≤ −60 dB. Duration is preserved exactly; the
output length always equals the input length.

Automatic mode (`amount` 1, retune 20 ms) on a 6-note melody: the notes were detuned by
+35, −28, +22, −40, +18 and −24 c, with ±25 c vibrato. They were detected at +29.7, −32.5,
+17.7, −45.5, +13.0 and −29.2 c. After rendering and re-analysis they measure −1.3 to −3.1 c.

### 10.5 Formant preservation evidence

Test: `render.test.ts`. Method: LPC envelope of order 14 on the signal decimated to 12 kHz,
with the autocorrelation averaged over 30 ms frames between 0.5 and 1.0 s; the strongest peak
is taken in each band. Fixture: /e/ at 120 Hz.

| Shift | Envelope peak | TD-PSOLA            | Naive resampling |
| ----- | ------------- | ------------------- | ---------------- |
| +2 st | F1 510 Hz     | 530 Hz (**4.0 %**)  | 565 Hz (10.9 %)  |
| +2 st | F2 1846 Hz    | 1838 Hz (**0.4 %**) | 2055 Hz (11.3 %) |
| −3 st | F1 510 Hz     | 523 Hz (**2.6 %**)  | 420 Hz (17.5 %)  |
| −3 st | F2 1846 Hz    | 1849 Hz (**0.2 %**) | 1551 Hz (16.0 %) |

Targets: under 5 % for TD-PSOLA, over 10 % for naive resampling. Formant shift of +3 st moves
F2 by +18.7 %; the expected value is +18.9 %, and the pitch error is 0.00 c.

Caveat: at higher f0, or for vowels whose F1 and F2 are close (/a/, /o/), LPC peaks lock onto
harmonics. That reflects the measurement, not the renderer, so the evidence uses /e/ at
120 Hz.

### 10.6 Artefact proxy: harmonic-to-noise ratio

Method: energy within ±3 % of each harmonic versus all other energy, 100 Hz–5 kHz, from a
Hann DFT over 0.34 s. Fixture: /a/ at 150 Hz; the original measures 36.6 dB. This is an
objective proxy only; no listening test has been run (R§6.5).

| Edit                                     | Preview               | Final                 |
| ---------------------------------------- | --------------------- | --------------------- |
| +1 / +2 st                               | 29.6 / 28.7 dB        | 33.4 / 33.5 dB        |
| −3 / +5 / −7 st                          | 28.4 / 28.2 / 28.5 dB | 31.6 / 31.9 / 32.4 dB |
| Formant +2 / −3 / +5 st, pitch unchanged | 34.1 / 33.7 / 31.9 dB | 34.1 / 33.7 / 31.9 dB |
| +3 st pitch with +3 st formant           | 27.2 dB               | 31.0 dB               |

### 10.7 Key estimation

Test: `key.test.ts`. On 29 `KNOWN_MELODIES` (20 major, 9 minor), top-1 accuracy is **93.1 %**
(target ≥ 80 %) and top-3 accuracy is **100 %** (target ≥ 95 %).

The two misses are both in the top 3:

- "Canon in D", upper line: B minor 0.52 vs D major 0.42.
- "In the Hall of the Mountain King": D major 0.63 vs B minor 0.26.

The relative key appears in the top 3 with comparable confidence for the ambiguous tunes:
Jingle Bells (ratio 0.74) and Mary Had a Little Lamb (0.37). The estimate is
transposition-invariant. The temperature was fitted on the same set (§8), so expect lower
accuracy on unseen and real data.

## 11. Processors, worker protocol and integration

### 11.1 Processors

- `createInlineVocalProcessor()` runs the same stage generators as the synchronous API. It
  yields to the event loop every 4 chunks (chunks are 256 frames or one span), reports
  progress, and checks the `AbortSignal` at every chunk boundary. On cancellation it rejects
  with `VocalJobCancelledError`.
- `createWorkerVocalProcessor(createWorker, { transferInputs = true })` behaves as follows:
  - Jobs run one at a time, in order. A queued job keeps its buffers until it is dispatched.
  - Cancelling a queued job only removes it.
  - Cancelling the running job terminates the worker and rejects the job. The next job spawns
    a new worker lazily.
  - Messages from a terminated worker, and responses for any job id other than the running
    job, are ignored as stale.
  - `dispose()` terminates the worker and rejects all pending jobs with
    `VocalProcessorDisposedError`.

Both processors pass the same contract suite, `runVocalProcessorContract(name,
createProcessor)`. It lives in `tests/helpers/vocal-processor-contract.ts` and is re-exported
from `tests/vocal-processor.contract.test.ts`. Run it against any future engine.

### 11.2 Protocol and buffer ownership

- **Requests:**
  - `{type: 'analyze', jobId, source, params}`
  - `{type: 'render', jobId, request}`
  - `{type: 'cancel', jobId}`, which is acknowledged with `cancelled`. Jobs run synchronously,
    so hosts cancel a running job by terminating the worker.
- **Responses:**
  - `progress`, throttled to steps of ≥ 1 %;
  - `result` with `kind: 'analysis'` or `kind: 'render'`;
  - `error` with `name` and `message`;
  - `cancelled`.
- **Guards:** `isVocalWorkerRequest` and `isVocalWorkerResponse` validate structured clones.
- **Ownership:**
  - The processor **transfers** request PCM. The caller's `source.channels` are detached once
    the job is dispatched, and must not be reused; copy first, or pass
    `{transferInputs: false}`.
  - The `analysis` passed with a render is **copied**, never transferred, because callers keep
    it for later renders.
  - Results come back with their buffers transferred: the pitch-track arrays and the rendered
    channels.

### 11.3 Worker entry (for `@studio/platform-browser`, owned by the lead)

```ts
import { handleVocalWorkerRequest, isVocalWorkerRequest } from '@studio/vocal-dsp';
self.onmessage = (event: MessageEvent<unknown>) => {
  if (isVocalWorkerRequest(event.data))
    handleVocalWorkerRequest(event.data, (r, t) => self.postMessage(r, { transfer: t ?? [] }));
};
```

Then:
`createWorkerVocalProcessor(() => new Worker(new URL('./vocal.worker.ts', import.meta.url), { type: 'module' }))`.

### 11.4 Caching keys

- **Analysis:** `analysisKey = contentHash + '|' + VOCAL_ALGORITHM_VERSION + '|' +
JSON(resolveVocalAnalysisParams(params))`. Store it in `VocalEditDoc.analysisKey` and
  `algorithmVersion`. Re-analyse when either changes.
- **Render:** hash of analysisKey, quality, `enabled`, `correction`, `segments` and
  `noteEdits`. Renders are deterministic, so equal keys mean identical audio. To cache by
  region, key on the span: the renderer only changes active spans, so splitting by voiced runs
  is safe.

### 11.5 Data for the UI

- **Detected pitch contour:** `pitchTrack.f0Hz`, where 0 marks a gap, drawn at
  `firstFrameSeconds + i·hopSeconds`. Use `voicedProbability` for opacity and `rmsDb` for an
  optional loudness ribbon.
- **Notes ("blobs"):** `segments`, with start, end, `detectedMidi` and `confidence`. Draw low
  confidence dashed. Show vibrato depth and rate and drift in the note inspector.
- **Corrected contour:** `computeTargetPitchCurve(track, doc.segments, doc)`, with NaN as a
  gap. It is cheap enough to recompute on every edit (about 4 ms per minute of audio).
- **Shading:** `nonPitched` regions (silence, breath, sibilant, unvoiced).
- **Key suggestions:** `keyCandidates`. Show at least the top candidate and its relative key.
- **Note editing:** `splitSegment` and `mergeSegments` re-estimate the centre and expression.
  The caller supplies ids, for example from `createIdFactory(...).create('vocalNote')`.

## 12. Plugging in an alternative engine

`VocalProcessor` is the only seam the session uses. A Signalsmith Stretch engine (MIT, R§1.3)
would work like this:

1. Compile `signalsmith-stretch.h` with Emscripten for a plain Worker, using the seeded
   constructor for determinism (R§2.2).
2. Implement `render(request)` as follows:
   - Compute the ratio with `computeTargetPitchCurve` and `computePitchRatioCurve` from this
     package, so the musical semantics stay identical.
   - Convert it to semitones per block for `setTransposeSemitones`, or build a frequency map.
   - Set the formant options from `correction.formantPreservation` and
     `formantShiftSemitones`.
   - Keep the untouched-region guarantee by cross-fading back to the source outside active
     spans, reusing `voicedRunsForRendering` logic.
3. Reuse `analyzeVocal` for analysis, or delegate it.
4. Declare `capabilities = {algorithm: 'signalsmith-stretch', formantPreservation: true,
formantShift: true, timeStretch: true}`.
5. Run `runVocalProcessorContract` against it. The tests that compare against TD-PSOLA's exact
   samples need an engine-specific tolerance; keep the rest as they are.

## 13. Contract notes

These are proposed changes; the frozen `types.ts` was left unchanged.

- `KeyCandidate` has no abstain flag. Thin evidence is expressed as confidences summing to
  less than 1. An explicit `abstain` field (or `evidence: number`) would be clearer for the UI.
- `PitchTrack.voicedProbability` is voicing _evidence_, not an HMM posterior (§3.1). The doc
  comment "Probability that the frame is voiced" should say so.
- `VocalNoteSegment` cannot represent transitions or glides. Portamento frames between notes
  stay unsegmented, and the correction model interpolates across them (§5, rule 6). A future
  `transitionInMs` field could round-trip the detected glide time.
- `@studio/vocal-dsp` does not declare `@studio/test-fixtures` as a devDependency, and
  `@studio/test-fixtures` does not depend on `@studio/audio-dsp`. Tests therefore import the
  fixtures by relative path (`../../test-fixtures/src/index`), and fixtures use a structural
  `FixturePcm`.
  **Suggested change (lead):** add `"devDependencies": {"@studio/test-fixtures": "workspace:*"}`
  to vocal-dsp.

## 14. Rust migration

Rules that apply to every function below:

- **Sample format:** planar `f32` in and out; internal accumulation is `f64`.
- **Determinism:** no randomness; IEEE operations only; deterministic tie-breaks; WASM
  without relaxed SIMD or threads.
- **Tolerances:** follow R§6.4.
- **Golden fixtures:** generated by `@studio/test-fixtures`, whose mulberry32 PRNG and
  synthesiser are pure arithmetic. Store generator, seed and parameters, plus the expected
  outputs as float32 files.

| Function                                             | I/O contract                                                                | Determinism notes                                                       | Tolerance vs TS golden                                            | Golden fixture                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| `fft` (internal)                                     | In-place complex radix-2                                                    | Twiddle table from `cos`/`sin`                                          | 1e-12 relative                                                    | Random vectors, seed 3                    |
| `analyzeYinFrame`                                    | Frame span → CMNDF troughs (period, height)                                 | FFT cross-correlation; clamp d ≥ 0                                      | Periods ±1e-6 samples                                             | Steady 220 Hz /e/                         |
| `observePitch`                                       | mono f32, fs, params → candidates (bin, prob, Hz), voicing evidence, RMS dB | Beta CDF in closed form; Boltzmann table                                | Probabilities 1e-9; same bins                                     | Clean fixture set (§10.2)                 |
| `decodePitch`                                        | Observations → bin and voicing per frame                                    | Log domain; strict `>` over ascending indices; chunking rules identical | Identical path                                                    | Clean set and noise set                   |
| `trackPitch`                                         | mono, fs, params → `PitchTrack`                                             | Composition of the above                                                | f0 ±0.1 c on ≥ 99.9 % of voiced frames; voicing equal on ≥ 99.9 % | §10.2 fixtures                            |
| `classifyNonPitched`                                 | mono, track, params → regions                                               | Prefix sums in f64                                                      | Boundaries ±1 frame                                               | Mixed consonant fixture                   |
| `peltChangePoints`                                   | f64 series, σ, β, m → change points                                         | Conservative pruning (keep τ while F(τ)+C ≤ F(t)+β)                     | Identical (property test vs brute force)                          | Random step series, seed 17               |
| `segmentNotes`                                       | track, params → segments                                                    | Fixed post-rule order; ids `vn_<i>_<frame>`                             | Boundaries ±1 frame; centres ±0.1 c                               | Melody set (§10.3)                        |
| `analyzeNoteExpression`                              | track, segment → centre, drift, vibrato                                     | Fixed 81-rate grid; median of window fits                               | Rate ±0.05 Hz; depth ±0.5 c                                       | Vibrato fixtures                          |
| `estimateKey`                                        | (midi, weight)[] → ranked keys                                              | Stable ranking by probability, then key index                           | Probabilities 1e-9                                                | `KNOWN_MELODIES`                          |
| `computeTargetPitchCurve` / `computePitchRatioCurve` | track, segments, doc → f32 per frame                                        | Time-ordered segments; ramps in closed form                             | 1e-6 semitones                                                    | Hand-built tracks in `correction.test.ts` |
| `detectPitchMarks`                                   | mono, fs, track → i32 marks                                                 | Integer search; strict `>`                                              | Identical marks                                                   | Steady and vibrato fixtures               |
| `renderPitchCorrection`                              | PCM, analysis, doc, quality → PCM of the same length                        | Shared marks; fixed span merge; f64 accumulators                        | SNR ≥ 90 dB vs golden; untouched regions bit-identical            | ±2/−3 st fixtures, detuned melody         |
| `handleVocalWorkerRequest`                           | Request → responses                                                         | Pure; one result per job                                                | Structural equality                                               | Contract suite                            |
