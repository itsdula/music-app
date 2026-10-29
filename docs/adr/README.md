# Architecture decision records

| ADR                                                    | Title                                                                      | Status   |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| [0001](0001-monorepo-and-internal-packages.md)         | pnpm + Turborepo monorepo with TypeScript-source internal packages         | Accepted |
| [0002](0002-portable-core-classification.md)           | Portable cores vs host adapters vs UI, enforced by tooling                 | Accepted |
| [0003](0003-musical-time-960-ppq.md)                   | Integer ticks at 960 PPQ, single global tempo for v1                       | Accepted |
| [0004](0004-immutable-model-commands-snapshot-undo.md) | Immutable normalized model, commands, snapshot undo                        | Accepted |
| [0005](0005-web-audio-engine-design.md)                | Web Audio engine: native nodes, lookahead scheduling, shared offline graph | Accepted |
| [0006](0006-inline-worker-bundles.md)                  | Inline Worker/AudioWorklet bundles loaded from Blob URLs                   | Accepted |
| [0007](0007-vocal-dsp-pyin-td-psola.md)                | Vocal DSP: pYIN-style analysis, TD-PSOLA correction                        | Accepted |
| [0008](0008-midi-software-mapping-no-sysex.md)         | MIDI: software mapping first; no SysEx without a documented protocol       | Accepted |
| [0009](0009-persistence-indexeddb-bundles.md)          | IndexedDB persistence with separate assets, migrations and zip bundles     | Accepted |
| [0010](0010-styling-prebuilt-scoped-css.md)            | Tailwind v4 compiled to a prebuilt, scoped stylesheet                      | Accepted |
| [0011](0011-ui-state-outside-react-frame-data.md)      | Zustand for editor state; frame-rate data outside React                    | Accepted |
