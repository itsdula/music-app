# ADR 0011 — Zustand for editor state; frame-rate data outside React

Status: Accepted (2026-10-29)

## Decision

Zustand stores hold project (wrapping CommandHistory) and editor state (selection, viewport,
panels). Transport position, meters, playhead and live MIDI activity are read in a single
`requestAnimationFrame` loop and drawn directly to canvases/DOM nodes via refs; they never
trigger React renders. Canvas renderers are plain TS classes sharing a `TimeAxis`.

## Alternatives

Redux (more ceremony), React context only (re-render storms), signals libraries (another
paradigm in the codebase).
