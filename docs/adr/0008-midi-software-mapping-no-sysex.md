# ADR 0008 — MIDI: software mapping first; no SysEx without a documented protocol

Status: Accepted (2026-10-29). Evidence: docs/midi-device-research.md.

## Decision

`midi-core` is device-independent; device knowledge lives in profile packages
(`midi-akai-mpk-mini-mk3`). Studio interprets standard MIDI (notes, CC, pitch bend) and maps
it in software (learn, mappings, takeover). AKAI publishes no SysEx program protocol for the
MPK Mini MK3 and community implementations are GPL-licensed, so Studio never sends SysEx and
hardware program editing is shown as unsupported with software equivalents. The feature
flag `hardwareProgramEditing` is typed as `false`.

## Consequences

Program changes made on the device are invisible to Studio unless they change transmitted
messages; mapping by learning is the recommended workflow. Physical verification follows the
HIL protocol; nothing is labelled verified without it.
