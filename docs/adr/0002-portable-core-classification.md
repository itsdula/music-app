# ADR 0002 — Portable cores vs host adapters vs UI, enforced by tooling

> **Update (2026-11):** the `next`-only-in-`apps/web` rule was dropped with the Next.js host;
> the remaining rules are unchanged. See [architecture.md §4](../architecture.md).

Status: Accepted (2026-10-29)

## Decision

Every package is class A (portable core: pure TS, deterministic, Rust-port candidate),
B (host adapter) or C (React UI). Enforcement: (1) class A `tsconfig.src.json` compiles
with `lib: ES2023`, `types: []` — DOM/Node APIs are type errors; (2) dependency-cruiser
allowed-dependency lists, cycle ban, framework/Node-builtin bans, `next` only in `apps/web`;
(3) ESLint `no-restricted-imports` mirroring the rules.

## Consequences

Class A code must inject clocks, timers, loggers and hashing. Structural types such as
`AbortSignalLike` and `VocalWorkerLike` replace DOM types in portable APIs.
