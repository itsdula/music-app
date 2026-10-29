# ADR 0010 — Tailwind v4 compiled to a prebuilt, scoped stylesheet

Status: Accepted (2026-10-29)

## Decision

`@studio/react` ships `dist/studio.css` built by the Tailwind CLI from `src/styles/studio.css`
(theme + utilities only; no global preflight). Base styles are scoped to `.studio-root`;
Radix portals render into a container inside it. Tokens live in `@studio/ui` (`tokens.css`
with `@theme static`, mirrored in `tokens.ts` for canvas code). Inter is bundled.

## Consequences

Hosts import one stylesheet and need no Tailwind setup; Studio can be embedded without
leaking resets. The CSS build is a Turbo `build`/`dev` task.
