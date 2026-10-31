# Vendored agent skills

Copied from upstream on 2026-10-31 (evals and images left out). Update by re-copying.

| Skill dir         | Skill name  | Source                                                        | Commit     | License |
| ----------------- | ----------- | ------------------------------------------------------------- | ---------- | ------- |
| `audio-ui`        | `audio-ui`  | [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) `skills/audio-ui`  | `67bae04a` | MIT |
| `web-audio`       | `web-audio` | [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) `skills/web-audio` | `67bae04a` | MIT |
| `audio-ui-design` | `design`    | [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) `skills/design`    | `67bae04a` | MIT |
| `audio-ui-core`   | `core`      | [ouestlabs/audio-ui](https://github.com/ouestlabs/audio-ui) `skills/core`      | `67bae04a` | MIT |
| `shadcn`          | `shadcn`    | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) `skills/shadcn`                | `b8d7baa1` | MIT |

Local change: `shadcn/SKILL.md` drops the upstream `allowed-tools` pre-approval of
`npx/pnpm dlx/bunx shadcn@latest *` and the `!`npx shadcn@latest info --json`` block that ran
on load; it now tells the agent to run `pnpm dlx shadcn@latest info --json` itself.

audiocn.dev and waves-cn.vercel.app publish no skills or MCP server; agents read their
`/llms.txt` (append `.md` to any docs page) and install from their shadcn registries.
