# Studio

A local-first, portable digital audio workstation that runs in the browser: multitrack
arrangement, MIDI instruments, recording, mixing and effects, AKAI Professional MPK Mini MK3
integration, and a pitch-aware vocal editor — with no account, subscription or backend.

The whole application is **one React component**, `<Studio />`, mounted by thin hosts:
a Next.js site (landing page at `/`, the app at `/studio`), a standalone Vite app, and an
Electron shell. Audio runs on Web Audio (AudioWorklet where audio-thread code is needed);
projects and audio live in IndexedDB on your device.

> **Status:** phases 0–7 are implemented and covered by automated tests (unit,
> real-Chromium Web Audio, and Playwright end-to-end on both hosts); phase 8 polish is in
> progress. Capabilities are claimed only when tested — see
> [`docs/implementation-plan.md`](docs/implementation-plan.md) for per-phase evidence and
> limitations, and [`docs/agent-workstreams.md`](docs/agent-workstreams.md) for each merge.
> AKAI MPK Mini MK3 support has been tested only against a simulated Web MIDI port and has
> **not yet been verified on a physical unit**; see the compatibility matrix in
> [`docs/midi-device-research.md`](docs/midi-device-research.md).

## Quick start

Requirements: Node 22.12+, pnpm 10, a Chromium-based browser for Web MIDI.

```bash
pnpm install
pnpm dev            # Next.js host → http://localhost:3000 (landing) and /studio
pnpm dev:vite       # standalone Vite host → http://localhost:3001
pnpm --filter @studio/electron-host build && pnpm --filter @studio/electron-host start
                    # desktop shell (Electron)
```

## Repository layout

| Path                              | What it is                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `apps/web`                        | Next.js App Router host: landing page and the intentionally thin `/studio` route |
| `apps/vite-host`                  | Minimal Vite host proving `<Studio />` is framework-agnostic                     |
| `apps/electron-host`              | Electron shell (secure main/preload, renderer mounts `<Studio />`)               |
| `packages/domain`                 | Project model, musical time (960 PPQ), grid, theory, parameter specs, invariants |
| `packages/commands`               | Serializable edit commands, snapshot undo/redo with transactions                 |
| `packages/engine-core`            | Backend-neutral scheduling math, transport clock, project diffing, mix math      |
| `packages/audio-contracts`        | The `AudioEngine` port every audio backend implements                            |
| `packages/audio-dsp`              | WAV codec, waveform peak pyramids, drum synthesis, reverb IRs, FFT               |
| `packages/audio-web`              | Web Audio implementation of the engine (instruments, effects, recording, bounce) |
| `packages/vocal-dsp`              | pYIN pitch tracking, note segmentation, key estimation, TD-PSOLA correction      |
| `packages/midi-core`              | MIDI parsing, mapping engine, MIDI Learn, recording, device service              |
| `packages/midi-akai-mpk-mini-mk3` | Researched MPK Mini MK3 profile, layout model, capability matrix                 |
| `packages/project-storage`        | Schema validation, migrations, project bundles, autosave                         |
| `packages/platform-contracts`     | `PlatformServices`: what each host provides                                      |
| `packages/platform-browser`       | Browser services: IndexedDB, Web MIDI, file dialogs, permissions, workers        |
| `packages/ui`                     | Design tokens and accessible primitives                                          |
| `packages/studio-react`           | `<Studio />`: session, stores, editors, mixer, controller panel                  |
| `packages/test-fixtures`          | Deterministic synthetic audio/MIDI fixtures                                      |
| `docs/`                           | Architecture, ADRs, research dossiers, test plan, Rust migration map             |

Portable packages (domain, commands, engine-core, DSP, MIDI, storage, contracts) compile
without DOM or Node typings and are the candidates for a function-by-function Rust port
([`docs/rust-migration-map.md`](docs/rust-migration-map.md)). Package boundaries are enforced
by dependency-cruiser (`pnpm boundaries`).

## Embedding `<Studio />`

```tsx
import '@studio/react/styles.css';
import { Studio } from '@studio/react';

export function App() {
  return (
    <div style={{ height: '100vh' }}>
      <Studio />
    </div>
  );
}
```

`<Studio platform={…} config={…} />` accepts injected host services (see
`packages/platform-contracts`); without them it uses the browser implementations.
In Next.js, render it from a client component with `next/dynamic(..., { ssr: false })`
(see `apps/web/app/studio/studio-client.tsx`). Hosts must allow `blob:` in `script-src`
and `worker-src` when using a CSP (workers and worklets load from Blob URLs).

## Development commands

```bash
pnpm check              # format, lint, typecheck, boundaries, tests, build
pnpm lint               # ESLint (type-aware)
pnpm typecheck          # TypeScript across all packages
pnpm boundaries         # dependency-cruiser package rules
pnpm test               # unit + component + integration + contract tests
pnpm test:browser       # real-Chromium Web Audio tests (Vitest browser mode)
pnpm test:e2e           # production builds of both hosts + Playwright
pnpm test:coverage      # tests with v8 coverage
```

## Documentation

- [Architecture](docs/architecture.md) · [Domain model](docs/domain-model.md) ·
  [Audio engine](docs/audio-engine.md) · [Vocal DSP](docs/vocal-dsp.md) ·
  [MIDI integration](docs/midi-integration.md) · [Persistence](docs/persistence.md) ·
  [Hosts (Electron/Tauri)](docs/hosts.md)
- [Test plan](docs/test-plan.md) · [Implementation plan](docs/implementation-plan.md) ·
  [Rust migration map](docs/rust-migration-map.md) · [ADRs](docs/adr/README.md)
- Research: [MPK Mini MK3 dossier](docs/midi-device-research.md) ·
  [vocal DSP options](docs/research/vocal-dsp-options.md) ·
  [platform compatibility](docs/research/platform-compatibility.md)

## Browser support

Studio targets current Chromium browsers (Chrome, Edge) for the full feature set. Firefox
runs the DAW; Web MIDI there requires a site-permission add-on. Safari has no Web MIDI.
Audio latency depends on the browser and device; recording applies latency compensation
that you can adjust.

AKAI Professional and MPK Mini are trademarks of their respective owner. Studio is not
affiliated with or endorsed by AKAI Professional.
