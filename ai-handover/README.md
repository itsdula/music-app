# AI handover

State of the project as of **2026-11-02**. Read this first, then [`../README.md`](../README.md)
and the docs it links.

## What this project is

**Nawa** (repository [`itsdula/nawa`](https://github.com/itsdula/nawa), formerly `music-app`): a
local-first browser DAW (arrangement, MIDI instruments, recording, mixer and effects, AKAI MPK
Mini MK3 support, vocal pitch editor, guided tutorials, an AI assistant panel). The whole app is
one React component, `<Studio />` (`packages/studio-react`). Internal names stay as they were:
the component is still `<Studio />` and the packages are `@studio/*`; only user-facing text says
Nawa.

Two thin hosts mount it:

| Host    | Folder         | What it is                                                                             | Run locally                                                     |
| ------- | -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Website | `apps/site`    | Static Vite+ site: landing page (`index.html`) and the Studio (`studio/index.html`)    | `pnpm dev` (with the dev monitor) or `pnpm dev:site` → :3000    |
| Desktop | `apps/desktop` | Electron app: hosts Chromium only, native file dialogs and a preference store over IPC | `pnpm dev`, or build then `pnpm --filter @studio/desktop start` |

There is no backend: projects and audio live in IndexedDB. The audio engine is Web Audio in the
page on both hosts. Tauri was dropped for now; its design is kept in
[`../docs/hosts.md`](../docs/hosts.md) §2 as a future option (worth it only with a native audio
and MIDI backend).

## Where it is published

- **Website:** <https://itsdula.github.io/nawa/> (landing) and
  <https://itsdula.github.io/nawa/studio/> (the app). `.github/workflows/pages.yml` builds
  `apps/site` with base `/nawa/` and deploys on every push to `main`. One-time setting: the
  repository's Pages source must be **GitHub Actions**.
- **Desktop:** GitHub Releases. `.github/workflows/release.yml` runs on a pushed `vX.Y.Z` tag,
  builds macOS (dmg/zip, arm64 and x64), Windows (NSIS x64) and Linux (AppImage x64) with
  electron-builder, and publishes the release once every platform uploaded. Builds are not
  signed with a paid certificate (macOS ad hoc, not notarized).
- **AI assistant:** not available on the static site (no transport is passed). The desktop app
  can call an endpoint set at build time (`STUDIO_ASSISTANT_URL`), but the repository no longer
  has a server for it. See [`../docs/assistant.md`](../docs/assistant.md).
- Vercel and the Next.js host are gone.

## Getting started locally

Requirements: **Node 22.15+**, **pnpm 10** (`packageManager: pnpm@10.28.0`), a Chromium-based
browser (Web MIDI).

```bash
git clone https://github.com/itsdula/nawa.git
cd nawa
pnpm install
pnpm dev
```

`pnpm dev` prints one line, the dev-monitor link (http://localhost:3300). It starts the site's
Vite dev server on http://localhost:3000 (Studio at `/studio/`), opens the Electron app and shows
the logs of both (site and forwarded browser console, Electron main, Electron renderer, builds)
on that page. Ctrl+C stops everything. Details: [`../docs/dev-monitor.md`](../docs/dev-monitor.md).

### Checks (same as CI)

| Command             | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `pnpm typecheck`    | TypeScript across all packages                         |
| `pnpm lint`         | ESLint, zero warnings allowed                          |
| `pnpm format:check` | Prettier                                               |
| `pnpm boundaries`   | dependency-cruiser package boundary rules              |
| `pnpm test`         | unit + react + integration + contract tests (vitest)   |
| `pnpm test:e2e`     | builds with base `/`, then Playwright against the site |
| `pnpm check`        | all of the above except e2e, plus build                |

First e2e run locally needs browsers: `pnpm exec playwright install chromium`. The Playwright
projects are `landing` (landing and portability specs) and `studio` (`e2e/studio/**`), both
against `vp preview` on http://localhost:3200.

`pnpm test:e2e:only` reuses `apps/site/dist`. If that folder holds a `/nawa/` build (the default
`pnpm build`), rebuild with `NAWA_BASE_PATH=/ pnpm build` first.

### Releasing

1. Bump `version` in `apps/desktop/package.json` and `apps/site/package.json` (the site footer
   shows it); merge to `main`. The installers take their version from the tag either way.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. After the first release exists, set `HAS_DESKTOP_RELEASE = true` in
   `apps/site/src/landing/links.ts` so the landing page shows the download buttons.

## History: what was built, in order

1. **PR #1**: monorepo scaffold, tooling, frozen contracts, research dossiers.
2. **PR #2**: the portable browser DAW with Next.js, Vite and Electron hosts (phases 0–7).
3. **PR #3**: 30 sample projects (5 each of EDM, Rock, Rap, House, Pop, Techno), sample
   builder (`pnpm samples`), looped-clip fix.
4. **PR #4**: projects page, piano roll, audio UI package (`@studio/audio-ui`), AI assistant
   and WebMCP tools, guided tutorials, cursors, context menus, knob overflow and
   accessibility fixes.
5. Bottom panel, selection and drag-drop work; Vercel config for the Next.js host (since
   removed).
6. **PR #5**: audio controls and meters moved onto `@audio-ui/react`.
7. Electron dev tooling (`pnpm dev` dev monitor), bridged preferences, `@studio/theme-core`,
   cross-origin isolation in Electron.
8. **Branch `nawa-site-and-desktop`**: renamed to Nawa; `apps/web` (Next.js) and
   `apps/vite-host` replaced by `apps/site` (Vite+, GitHub Pages); `apps/electron-host` moved to
   `apps/desktop` with electron-builder and the release workflow; new landing page with scroll
   and micro-animations; docs updated.

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

- **First release.** The release workflow has not run on GitHub yet, and the Windows and Linux
  installers have never been built. Push a pre-release tag (for example `v0.1.0-beta.1`) or run
  the workflow by hand (dry run) first.
- **Pages setting.** Set the repository's Pages source to GitHub Actions before the first deploy.
- **Assistant on the site.** The site and the desktop app pass no assistant transport, so the
  panel says no assistant endpoint is configured. Decide between a bring-your-own-key client and
  a hosted endpoint ([`../docs/assistant.md`](../docs/assistant.md)).
- **Tutorial progress is written without awaiting.** Reloading within a few milliseconds of
  dismissing a tour can lose the record; the e2e test waits for the IndexedDB write before it
  reloads (this used to make it flaky).
- **Sample descriptions** in `projects/*/*/song.json` (about 10) still say "Studio" for the
  product; change them together with the `.studio` bundles (`pnpm samples`).
- **Escape** clears highlighted clips but keeps the piano roll open, so it doesn't fully match
  the click-away rules (left as is because Escape also deselects notes in the piano roll).
- AKAI MPK Mini MK3 support is tested only against a simulated Web MIDI port; verify on a
  physical unit (`docs/midi-device-research.md`).
- Phase 8 polish is in progress (see `docs/implementation-plan.md`).
- No licence has been chosen; the repository has no `LICENSE` file.

## Pointers for an AI agent picking this up

- Architecture: `docs/architecture.md`, ADRs in `docs/adr/`, hosts in `docs/hosts.md`.
- UI state is a zustand store (`packages/studio-react/src/state/ui-store.ts`) updated with
  pure updater functions; project edits go through serializable commands with undo/redo
  (`packages/commands`).
- Keep package boundaries (`pnpm boundaries`); portable packages must not use DOM/Node APIs.
- Site links and asset URLs must go through `import.meta.env.BASE_URL` (`apps/site/src/urls.ts`),
  or they break under the `/nawa/` base path.
- Every change should keep `pnpm check` and `pnpm test:e2e` green; add tests with features.
