# Agent workstreams

Living table of delegated work. The tech lead (primary agent) owns architecture, shared
contracts, root configuration, lockfile, integration order and final validation. Agents
work in isolated git worktrees on their own branches, own explicit paths, commit only those
paths and never merge into the integration branch (`claude/studio-daw`). The lead reviews,
merges (`--no-ff`, preserving agent commits) and runs the full suite.

Model for all agents: Opus. Effort is chosen per task (the user asked for deliberate
per-agent effort levels): `xhigh` for the hardest correctness/DSP work, `high` for
correctness-critical but well-specified work, `medium` for presentational or low-risk work.

## Wave 0 — research (complete)

| Agent                 | Effort | Deliverable                               | Status                                                                                                                     |
| --------------------- | ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| research-mpk-mini-mk3 | high   | `docs/midi-device-research.md`            | done — official AKAI hosts were blocked by the sandbox network policy; facts labelled DOC-EXCERPT / COMMUNITY / UNVERIFIED |
| research-vocal-dsp    | high   | `docs/research/vocal-dsp-options.md`      | done — recommends pYIN + note HMM + key profiles; TD-PSOLA primary, Signalsmith Stretch alternative                        |
| research-platform     | medium | `docs/research/platform-compatibility.md` | done — toolchain verified; Blob-URL inline bundles recommended                                                             |

## Wave 1 — portable cores (complete)

Base commit: `4fe7389` (contracts frozen).

| Agent                 | Branch                     | Effort | Exclusive write ownership                                                                                                                                                                                              | Read-only                           | Depends on          | Definition of done                                                           | Status                                                                       | Merge            |
| --------------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- |
| agent-domain-commands | `agent/m1-domain-commands` | high   | `packages/commands/src/**` (except `types.ts`, `history-types.ts`), `packages/commands/tests/**`, `packages/domain/tests/**` (domain src bug fixes only)                                                               | domain src, contracts               | contracts           | all commands + history; property tests; ≥ 90% coverage                       | done — 360 tests, ~99.8% coverage; 4 domain bug fixes                        | merged `ed7f366` |
| agent-audio-engine    | `agent/m2-audio-engine`    | xhigh  | `packages/engine-core/**`, `packages/audio-dsp/**` (pcm.ts additive), `packages/audio-web/**`, `docs/audio-engine.md`                                                                                                  | domain, audio-contracts             | contracts           | vertical-slice engine; browser render tests; benchmarks                      | done — 117 unit tests (100% lines), 82 real-Chromium tests                   | merged `e695c57` |
| agent-ui-kit          | `agent/m1-ui-kit`          | medium | `packages/ui/src/**`, `packages/ui/tests/**`                                                                                                                                                                           | studio CSS                          | tokens              | primitives + RTL tests + tokens sync                                         | done — 57 tests                                                              | merged `13dfc22` |
| agent-storage         | `agent/m3-storage`         | high   | `packages/project-storage/**` (repositories.ts additive), `packages/platform-browser/src/storage/**`, its tests, `docs/persistence.md`                                                                                 | domain, platform-contracts          | contracts           | schema, migrations, bundles, autosave, IndexedDB + recovery; contract suites | done — 238 tests, ~99.8% coverage                                            | merged `33ecda1` |
| agent-midi            | `agent/m5-midi-mpk`        | high   | `packages/midi-core/**` (contracts additive), `packages/midi-akai-mpk-mini-mk3/**`, `packages/platform-browser/src/midi/**`, its tests, `docs/midi-integration.md`, appended section in `docs/midi-device-research.md` | domain, MK3 dossier                 | contracts, research | codec, mapping, learn, recorder, service, MK3 profile, Web MIDI port         | done — 314 tests, ~99.8% coverage; knob CCs relabelled community (`1ab2465`) | merged `64ff1d3` |
| agent-vocal-dsp       | `agent/m6-vocal-dsp`       | xhigh  | `packages/vocal-dsp/**` (types.ts additive), `packages/test-fixtures/**`, `docs/vocal-dsp.md`                                                                                                                          | domain, audio-dsp pcm, DSP research | contracts, research | analysis + TD-PSOLA meeting measured targets; processor contract suite       | done — 138 tests, 97.75% lines; every brief target met                       | merged `64ea52d` |

Shared files reserved for the lead: root `package.json`, `pnpm-lock.yaml`, root configs,
CI, `packages/*/package.json` dependency fields, `packages/platform-browser/src/index.ts`,
`packages/studio-react/**`, `apps/**`, architecture-level docs.

## Lead track (parallel to wave 1)

Architecture docs and ADRs; `packages/studio-react` shell (session, stores, layout,
transport, canvas infrastructure); `packages/platform-browser` composition
(`createBrowserPlatform`, pickers, permissions, device info, logger, hashing, worker hosts).

## Wave 2 — Studio features and hosts (complete)

Base: the integration branch after the wave-1 merges and the lead's Studio shell (`f857966`).
The lead kept the session layer, stores, arrangement, piano roll, mixer, devices, MIDI
controller panel, settings, export and all Playwright suites; agents took separable slices.

| Agent              | Branch                   | Effort | Exclusive write ownership                                                                                            | Status                                                                       | Merge            |
| ------------------ | ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------- |
| agent-landing      | `agent/w2-landing`       | medium | `apps/web/app/page.tsx`, `apps/web/components/landing/**`, `e2e/landing.spec.ts`                                     | done — 6 landing E2E tests; illustrations later replaced by real screenshots | merged `233402e` |
| agent-vocal-editor | `agent/w2-vocal-editor`  | high   | `packages/studio-react/src/features/vocal-editor/**`, its tests; small edits to `vocal-controller.ts`, test platform | done — 20 tests (3 UI flows, 17 model)                                       | merged `91f9b76` |
| agent-electron     | `agent/w2-electron-host` | medium | `apps/electron-host/**`, `docs/hosts.md`                                                                             | done — 95 unit tests, probe smoke (40 checks)                                | merged `b5357fe` |

Agent suggestions the lead acted on after merging: engine-core re-exports `AudioGraphChange`
from audio-contracts (mirror removed); vocal-dsp tests import `@studio/test-fixtures` as a
devDependency; global shortcuts moved to a document-level listener so editors can claim keys
(the vocal editor agent spotted that Delete in the piano roll also deleted the selected clip;
a regression E2E test failed on the old build and passes now); jest-dom types for
studio-react tests; electron-host unit tests in the root run and an Electron CI job.

## Integration log

| Date       | Branch                     | Commit    | Tests (evidence)                                                                        | Disposition               |
| ---------- | -------------------------- | --------- | --------------------------------------------------------------------------------------- | ------------------------- |
| 2026-10-29 | `claude/studio-daw`        | `4fe7389` | scaffold: lint, typecheck, boundaries, both host builds green                           | base for wave 1           |
| 2026-10-29 | `agent/m1-ui-kit`          | `e6da59b` | 57 tests (react project), lint/typecheck/boundaries green                               | merged `13dfc22`          |
| 2026-10-29 | `agent/m5-midi-mpk`        | `134ae93` | 314 tests, coverage midi-core 99.86% / MPK 99.18%                                       | merged `64ff1d3`          |
| 2026-10-29 | `agent/m1-domain-commands` | `772f2f3` | 360 tests, domain 100% / commands 99.78% lines                                          | merged `ed7f366`          |
| 2026-10-29 | `agent/m3-storage`         | `e514f7f` | 238 tests, project-storage 99.83% lines                                                 | merged `33ecda1`          |
| 2026-10-29 | `agent/w2-landing`         | `d0b3f48` | 6 landing E2E tests (web project)                                                       | merged `233402e`          |
| 2026-10-29 | `agent/w2-electron-host`   | `7ba291a` | 95 unit tests; probe smoke 40 checks in Electron 45.1.0                                 | merged `b5357fe`          |
| 2026-10-29 | `agent/m2-audio-engine`    | `35b6321` | 117 unit (100% lines) + 82 browser tests                                                | merged `e695c57`          |
| 2026-10-29 | `agent/m6-vocal-dsp`       | `25c9523` | 138 tests, vocal-dsp 97.75% lines                                                       | merged `64ea52d`          |
| 2026-10-29 | `agent/w2-vocal-editor`    | `af5874a` | 20 tests (react project)                                                                | merged `91f9b76`          |
| 2026-10-29 | `claude/studio-daw`        | `9150605` | full local gate: 1397 Node + 82 browser tests, 26/26 E2E, Electron full smoke 38 checks | integration green locally |

Note: agent worktrees were created from `main` (`ef70746`) rather than the integration HEAD;
every agent detected this and reset its own branch to the stated base `4fe7389` before work.
