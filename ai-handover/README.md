# AI handover

State of the project as of **2026-10-30**, written at the end of a Claude Code cloud session so
work can continue on a local machine (by you or another AI agent). Read this first, then
[`../README.md`](../README.md) and the docs it links.

## What this project is

**Studio**: a local-first browser DAW (arrangement, MIDI instruments, recording, mixer and
effects, AKAI MPK Mini MK3 support, vocal pitch editor, AI assistant, tutorials). The whole app
is one React component, `<Studio />` (`packages/studio-react`), mounted by three thin hosts:

| Host             | Folder               | Run locally                                                                                                                         |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Next.js website  | `apps/web`           | `pnpm dev` (all hosts + dev monitor, see below) or `pnpm dev:web` → http://localhost:3000                                           |
| Vite web app     | `apps/vite-host`     | `pnpm dev:vite` → http://localhost:3001                                                                                             |
| Electron desktop | `apps/electron-host` | `pnpm dev` (watch build, opens the app) or `pnpm --filter @studio/electron-host build && pnpm --filter @studio/electron-host start` |

There is no backend: projects and audio live in IndexedDB in the browser.

## Getting started locally

Requirements: **Node 22.15+**, **pnpm 10** (`packageManager: pnpm@10.28.0`), a Chromium-based
browser (Web MIDI).

```bash
git clone https://github.com/itsdula/music-app.git
cd music-app
pnpm install
pnpm dev
```

`pnpm dev` (or `npm run dev`) prints one line, the dev-monitor link (http://localhost:3300). It
starts Next.js on http://localhost:3000 (`/studio`), opens the Electron app and shows the logs of
both (Next.js, Electron main, Electron renderer, builds) on that page. Ctrl+C stops everything.
`pnpm dev:web` runs only Next.js, as `pnpm dev` used to. Details: [`../docs/dev-monitor.md`](../docs/dev-monitor.md).

Optional, for the AI assistant panel (web host, server side only): set `OPENROUTER_API_KEY`
(and optionally `OPENROUTER_MODEL`) in `apps/web/.env.local`. Without it the assistant says it
is not configured; everything else works. Details: [`../docs/assistant.md`](../docs/assistant.md).

### Checks (same as CI)

| Command             | What                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm typecheck`    | TypeScript across all packages                        |
| `pnpm lint`         | ESLint, zero warnings allowed                         |
| `pnpm format:check` | Prettier                                              |
| `pnpm boundaries`   | dependency-cruiser package boundary rules             |
| `pnpm test`         | unit + react + integration + contract tests (vitest)  |
| `pnpm test:e2e`     | builds, then Playwright e2e on the web and vite hosts |
| `pnpm check`        | all of the above except e2e, plus build               |

First e2e run locally needs browsers: `pnpm exec playwright install chromium`.

Last verified state (merge commit on `main`): typecheck, lint, format, boundaries pass;
1,675 unit/integration tests pass; 43/43 e2e tests pass.

## Repository and branch state

- **`main` contains everything.** All work branches were merged into it in this session.
- Old branches, all fully contained in `main` and safe to delete:
  `claude/studio-daw`, `claude/sample-projects`, `claude/studio-features`,
  `claude/funny-sagan-cya30i`, `claude/brave-hawking-7rhel3`.
- PRs #1–#4 show as "closed" on GitHub rather than "merged" because they were merged by
  hand with merge commits; their content is on `main`.
- CI: `.github/workflows/ci.yml` runs on pushes to `main` and `claude/**` (check job +
  Electron build). It does not deploy anything.

## Deployment

- `apps/web` is set up for **Vercel** via `apps/web/vercel.json` (framework Next.js, build
  `pnpm turbo run build --filter=@studio/web` from the repo root). In the Vercel project, set
  the root directory to `apps/web` and add `OPENROUTER_API_KEY` if you want the assistant.
- The Vercel project itself was connected outside the repo; its state (production URL,
  previews) was not visible from the cloud session. Check the Vercel dashboard.
- The Vite and Electron hosts have no deploy or publishing setup yet.

## History: what was built, in order

1. **PR #1**: monorepo scaffold, tooling, frozen contracts, research dossiers.
2. **PR #2**: the portable browser DAW with Next.js, Vite and Electron hosts (phases 0–7).
3. **PR #3**: 30 sample projects (5 each of EDM, Rock, Rap, House, Pop, Techno), sample
   builder (`pnpm samples`), looped-clip fix.
4. **PR #4**: projects page, piano roll, audio UI package (`@studio/audio-ui`), AI assistant
   - WebMCP tools, guided tutorials, cursors, Studio context menus, knob overflow and
     accessibility fixes.
5. **Bottom panel / selection / drag-drop work** (branch `claude/funny-sagan-cya30i`, merged
   in this session with conflict resolution, see below).
6. **Vercel config** for `apps/web` (branch `claude/studio-daw`).

Per-phase evidence and known limitations: [`../docs/implementation-plan.md`](../docs/implementation-plan.md)
and [`../docs/agent-workstreams.md`](../docs/agent-workstreams.md).

## Latest UX decisions (from your feedback, keep these)

- **Bottom panel tabs: Track · Piano Roll · Mixer · Controller.** Track (the selected track's
  instrument and effects) is always available. The Piano Roll tab (labelled "Audio Clip" for
  audio clips) is disabled until a region is selected, with a hover hint on how to create one.
  The "Select a MIDI clip to edit notes…" banner shows on the Track tab while no region is
  selected.
- **Single click on a region** makes it the Piano Roll target **without switching tabs**, so
  the track devices stay visible. **Double-click** opens it in the Piano Roll. If the bottom
  panel is hidden, a click opens it on the Piano Roll tab.
- **Click-away rules** live in one table in `packages/studio-react/src/state/selection-zones.ts`:

  | Where you click                            | Track      | Region     |
  | ------------------------------------------ | ---------- | ---------- |
  | Piano roll, other panels, browser, toolbar | kept       | kept       |
  | A track's M / S / arm / reorder buttons    | kept       | kept       |
  | A track header                             | selects it | deselected |
  | Empty timeline on a track                  | selects it | deselected |
  | Empty timeline below the tracks            | deselected | deselected |
  | Empty track-list area                      | deselected | deselected |

- **Browser items** (instruments, effects, audio) are added by double-click/Enter or by
  dragging onto the timeline, a track header or the Track tab's device panel
  (`features/browser/activate-item.ts`). Rows are focusable divs so Firefox can drag them.
- The old "Show track devices" button is gone; the Track tab replaces it (tutorial step and
  assistant tool `select_track_devices` updated accordingly).
- Internal panel ids: `BottomPanel = 'track' | 'clip' | 'mixer' | 'controller'`
  (`state/ui-store.ts`). Pages are separate: `StudioView = 'projects' | 'arrange' | 'editor'`
  (the full-height editor).

## Open items / next steps

- **Escape** clears highlighted clips but keeps the piano roll open, so it doesn't fully
  match the click-away rules (left as is because Escape also deselects notes in the piano
  roll). Decide whether to change.
- The original side-panel complaint ("adding from the browser doesn't work") could not be
  reproduced in headless Chromium; drop targets and reveal behaviour were fixed. Verify on
  your machine and browser.
- AKAI MPK Mini MK3 support is tested only against a simulated Web MIDI port; verify on a
  physical unit (`docs/midi-device-research.md`).
- Phase 8 polish is in progress (see `docs/implementation-plan.md`).
- Housekeeping: delete the merged `claude/*` branches; confirm the Vercel project points at
  `main` with root directory `apps/web`.

## Pointers for an AI agent picking this up

- Architecture: `docs/architecture.md`, ADRs in `docs/adr/`, hosts in `docs/hosts.md`.
- UI state is a zustand store (`packages/studio-react/src/state/ui-store.ts`) updated with
  pure updater functions; project edits go through serializable commands with undo/redo
  (`packages/commands`).
- Keep package boundaries (`pnpm boundaries`); portable packages must not use DOM/Node APIs.
- Every change should keep `pnpm check` and `pnpm test:e2e` green; add tests with features.
