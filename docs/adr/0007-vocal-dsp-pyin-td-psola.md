# ADR 0007 — Vocal DSP: pYIN-style analysis, TD-PSOLA correction

Status: Accepted (2026-10-29). Evidence: docs/research/vocal-dsp-options.md.

## Decision

Analysis: own TypeScript pYIN (YIN CMNDF, threshold distribution, HMM/Viterbi voicing and
pitch), note segmentation (Tony-style HMM/rules; change-point alternative), per-note
vibrato/drift, key estimation from duration-weighted pitch-class profiles with calibrated,
ranked candidates. Transformation: own TD-PSOLA renderer (formants preserved by
construction; unvoiced regions passed through), behind the `VocalProcessor` port, with
Signalsmith Stretch (MIT) as an alternative strategy. Time-stretch edits are deferred.
Preview = fast offline render played via `AudioEngine.setAssetOverride`.

## Alternatives rejected for primary use

Rubber Band / aubio / essentia (GPL/AGPL), phase vocoder (formant smearing), naive
resampling (formants + duration change), CREPE (model size, training-data licensing; may be
an optional mode later).

## Consequences

Quality limits (large shifts, breathy voice, fry) are disclosed in UI/docs; objective
metrics and listening checklists gate releases.
