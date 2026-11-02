# Contributing to Nawa

Thanks for helping. This page covers how to set up, what a change must pass, and the
conventions the codebase follows.

## Set up

Requirements: Node.js 22.15 or newer and pnpm 10 (`corepack enable` picks up the pinned
version). Then:

```bash
git clone https://github.com/itsdula/nawa.git
cd nawa
pnpm install
pnpm dev        # dev monitor at http://localhost:3300, site at http://localhost:3000
```

See the [README](README.md#quick-start) for the other ways to run the site and the desktop app.

## Workflow

1. Open an issue first for anything larger than a small fix, so the approach can be agreed.
2. Branch from `main`. Keep one topic per pull request.
3. Add or update tests with the change (see [docs/test-plan.md](docs/test-plan.md)).
4. Run the quality gate locally:
   ```bash
   pnpm check       # format, lint, typecheck, boundaries, tests, build
   pnpm test:e2e    # Playwright; first run: pnpm exec playwright install chromium
   ```
5. Open a pull request. CI runs the same checks plus the real-Chromium browser tests and the
   Electron smoke test.

## Conventions

- **TypeScript strict**, ESLint with zero warnings, Prettier formatting (`pnpm format`).
- **Named exports.** Comments explain _why_, not what.
- **Package boundaries.** Portable packages (domain, commands, engine-core, DSP, MIDI, storage,
  contracts) must not use DOM or Node APIs; `pnpm boundaries` and the per-package tsconfigs
  enforce it. See [docs/architecture.md](docs/architecture.md).
- **Project edits go through commands** (`packages/commands`) so they can be undone; UI state
  lives in the zustand stores in `packages/studio-react/src/state`.
- **Capabilities are claimed only when tested.** Hardware support that was only simulated says
  so (for example the MPK Mini MK3).
- **Docs.** Update the matching file in [docs/](docs/architecture.md) when behaviour, hosts or
  commands change.

## Releases

Maintainers release by pushing a `vX.Y.Z` tag; see
[README → Releasing](README.md#releasing).
