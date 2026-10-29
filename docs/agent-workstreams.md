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

## Wave 1 — portable cores (in progress)

Base commit: `4fe7389` (contracts frozen).

| Agent                 | Branch                     | Effort | Exclusive write ownership                                                                                                                                                                                              | Read-only                           | Depends on          | Definition of done                                                           | Status  | Merge |
| --------------------- | -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------- | ---------------------------------------------------------------------------- | ------- | ----- |
| agent-domain-commands | `agent/m1-domain-commands` | high   | `packages/commands/src/**` (except `types.ts`, `history-types.ts`), `packages/commands/tests/**`, `packages/domain/tests/**` (domain src bug fixes only)                                                               | domain src, contracts               | contracts           | all commands + history; property tests; ≥ 90% coverage                       | running | —     |
| agent-audio-engine    | `agent/m2-audio-engine`    | xhigh  | `packages/engine-core/**`, `packages/audio-dsp/**` (pcm.ts additive), `packages/audio-web/**`, `docs/audio-engine.md`                                                                                                  | domain, audio-contracts             | contracts           | vertical-slice engine; browser render tests; benchmarks                      | running | —     |
| agent-ui-kit          | `agent/m1-ui-kit`          | medium | `packages/ui/src/**`, `packages/ui/tests/**`                                                                                                                                                                           | studio CSS                          | tokens              | primitives + RTL tests + tokens sync                                         | running | —     |
| agent-storage         | `agent/m3-storage`         | high   | `packages/project-storage/**` (repositories.ts additive), `packages/platform-browser/src/storage/**`, its tests, `docs/persistence.md`                                                                                 | domain, platform-contracts          | contracts           | schema, migrations, bundles, autosave, IndexedDB + recovery; contract suites | running | —     |
| agent-midi            | `agent/m5-midi-mpk`        | high   | `packages/midi-core/**` (contracts additive), `packages/midi-akai-mpk-mini-mk3/**`, `packages/platform-browser/src/midi/**`, its tests, `docs/midi-integration.md`, appended section in `docs/midi-device-research.md` | domain, MK3 dossier                 | contracts, research | codec, mapping, learn, recorder, service, MK3 profile, Web MIDI port         | running | —     |
| agent-vocal-dsp       | `agent/m6-vocal-dsp`       | xhigh  | `packages/vocal-dsp/**` (types.ts additive), `packages/test-fixtures/**`, `docs/vocal-dsp.md`                                                                                                                          | domain, audio-dsp pcm, DSP research | contracts, research | analysis + TD-PSOLA meeting measured targets; processor contract suite       | running | —     |

Shared files reserved for the lead: root `package.json`, `pnpm-lock.yaml`, root configs,
CI, `packages/*/package.json` dependency fields, `packages/platform-browser/src/index.ts`,
`packages/studio-react/**`, `apps/**`, architecture-level docs.

## Lead track (parallel to wave 1)

Architecture docs and ADRs; `packages/studio-react` shell (session, stores, layout,
transport, canvas infrastructure); `packages/platform-browser` composition
(`createBrowserPlatform`, pickers, permissions, device info, logger, hashing, worker hosts).

## Wave 2 — Studio features (planned, after wave-1 integration)

Arrangement interactions, piano roll, mixer/effects UI, vocal editor UI, MK3 panel,
browser panel, landing page, Playwright suites — split by `packages/studio-react/src/features/<name>/**`
ownership once the session/store contracts are integrated.

## Integration log

| Date       | Branch              | Commit    | Tests (evidence)                                              | Disposition     |
| ---------- | ------------------- | --------- | ------------------------------------------------------------- | --------------- |
| 2026-10-29 | `claude/studio-daw` | `4fe7389` | scaffold: lint, typecheck, boundaries, both host builds green | base for wave 1 |
