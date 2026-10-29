# ADR 0004 — Immutable normalized model, commands, snapshot undo

Status: Accepted (2026-10-29)

## Decision

The project is immutable, normalized plain data. All persistent changes are serializable
commands applied by a pure `applyCommand`. Undo history stores `{before, after}` snapshot
roots; structural sharing keeps memory proportional to changes. Gestures use transactions
(one entry per drag); MIDI-driven parameter changes coalesce by key. The audio engine and
autosave consume reference-identity diffs.

## Alternatives

Inverse commands (risk of asymmetric bugs), Immer patches (extra dependency; same
semantics), CRDTs (collaboration out of scope).

## Consequences

Command handlers must preserve identity for untouched entities and return the same root
for no-ops. Memory is bounded by entry count (default 200).
