# ADR 0005 — Web Audio engine: native nodes, lookahead scheduling, shared offline graph

Status: Accepted (2026-10-29)

## Decision

Instruments and effects use native Web Audio nodes; AudioWorklet is used where audio-thread
code is required (recording capture). A lookahead scheduler (≈25 ms period, ≈100–150 ms
horizon) driven by a Worker timer converts tick positions to `AudioContext` times. Offline
bounce runs the same graph-construction code in an `OfflineAudioContext`. The engine
implements the backend-neutral `AudioEngine` port and consumes `diffProjects` changes.

## Alternatives

A single AudioWorklet engine rendering everything in JS/WASM (maximum control and Rust
parity, but far more code and risk for v1); Tone.js (extra abstraction, less control over
offline parity and licensing of a large dependency).

## Consequences

Voice/node lifecycle management is explicit; parity is tested by rendering. A Rust backend
implements the port semantics natively (cpal callbacks), not Web Audio node mimicry.
