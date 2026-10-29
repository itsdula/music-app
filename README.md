# Studio

A local-first, portable digital audio workstation: multitrack arrangement, MIDI instruments,
recording, mixing and effects, AKAI Professional MPK Mini MK3 integration, and a pitch-aware
vocal editor — running in the browser, with no account or backend.

> Status: under active development. See `docs/implementation-plan.md` for milestones and
> `docs/agent-workstreams.md` for current work. Capabilities are only claimed once tested.

## Workspace

| Path             | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `apps/web`       | Next.js host: landing page (`/`) and the thin `/studio` route         |
| `apps/vite-host` | Minimal Vite host proving `<Studio />` is framework-agnostic          |
| `packages/*`     | Portable domain/DSP/MIDI cores, host adapters and the `<Studio />` UI |
| `docs/`          | Architecture, ADRs, research, test plan, Rust migration map           |

## Commands

```bash
pnpm install
pnpm dev            # Next.js host on http://localhost:3000
pnpm dev:vite       # Vite host on http://localhost:3001
pnpm check          # format, lint, typecheck, boundaries, tests, build
pnpm test:unit      # unit + component tests
pnpm test:integration
pnpm test:contracts
pnpm test:browser   # real-Chromium Web Audio tests
pnpm test:e2e       # production builds + Playwright
```

Requires Node 22.12+ and pnpm 10.
