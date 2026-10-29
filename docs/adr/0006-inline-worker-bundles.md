# ADR 0006 — Inline Worker/AudioWorklet bundles loaded from Blob URLs

Status: Accepted (2026-10-29)

## Context

`audioWorklet.addModule(new URL('./x.ts', import.meta.url))` is not handled uniformly:
Turbopack copies the raw `.ts` (MIME error); Vite-specific `?worker&url` is not portable.

## Decision

`scripts/inline-bundles.mjs` (esbuild) bundles each Worker/worklet entry into a string
exported from `src/generated/` (gitignored, rebuilt by `pnpm codegen`). Runtime creates a
Blob URL and calls `addModule` / `new Worker`. CSP must allow `blob:` for `script-src` and
`worker-src`.

## Consequences

No host bundler configuration; identical behaviour in Next, Vite and Electron. Codegen is a
Turbo dependency of typecheck/build/dev.
