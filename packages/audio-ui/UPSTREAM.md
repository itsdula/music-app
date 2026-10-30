# Upstream: audiocn

`src/audiocn/` is a vendored copy of part of [audiocn](https://audiocn.dev)
([github.com/audiocn/ui](https://github.com/audiocn/ui)), a shadcn registry of audio components.

- **Licence:** MIT, © 2026 OrcDev. The licence text is in [`src/audiocn/LICENSE.md`](src/audiocn/LICENSE.md)
  and must stay with the files.
- **Commit:** `05bec0fd503e91593de733b0249f1d275b5a1da0`
- **Files:** the list in [`scripts/vendor-audiocn.mjs`](scripts/vendor-audiocn.mjs): the audio core
  (`lib/audio/*`), seven hooks and the components `db-scale`, `db-readout`, `clip-indicator`,
  `level-meter`, `fader`, `knob`, `pan-control`, `channel-toggle` and `parameter-slider`.

## How the copy differs from upstream

Only mechanically, so an update is a re-run of the script:

- the `@/` path alias is rewritten to relative imports;
- the `"use client"` directive is dropped (Studio is a client-only component tree).

The files are excluded from Prettier (`.prettierignore`) and two promise lint rules are relaxed for
them (`eslint.config.js`), so they stay byte-for-byte comparable with upstream. They pass the repo's
strict TypeScript settings unchanged.

## Updating

```bash
git clone https://github.com/audiocn/ui /tmp/audiocn
git -C /tmp/audiocn checkout <commit>
pnpm --filter @studio/audio-ui vendor /tmp/audiocn
```

Then update the commit above, review the diff of `src/audiocn/`, and run the full gate
(`pnpm typecheck && pnpm lint && pnpm test && pnpm e2e`).

## Theming

audiocn components use shadcn colour names (`bg-muted`, `ring-ring/30`, `bg-meter-ok`, …).
[`src/theme.css`](src/theme.css) maps them onto Studio's tokens, scoped to `.studio-root` so a host
page that also uses shadcn keeps its own variables. `@studio/react`'s stylesheet imports it and scans
this package for classes.
