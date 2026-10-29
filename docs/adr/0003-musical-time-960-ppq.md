# ADR 0003 — Integer ticks at 960 PPQ, single global tempo for v1

Status: Accepted (2026-10-29)

## Decision

All musical positions are integer ticks with PPQ = 960 (= 2⁶·3·5), so 1/4…1/64 straight
and triplet grids are integers. BPM means quarter notes per minute. v1 has one global tempo
and meter; conversion functions take `bpm` so a `TempoMap` can replace it later. Audio clip
lengths are stored in source frames; their tick length is derived from tempo (no implicit
time-stretch).

## Alternatives

Float beats (accumulated error, inexact triplets); 480 PPQ (no 1/64 triplets); seconds as
canonical (tempo edits move everything).
