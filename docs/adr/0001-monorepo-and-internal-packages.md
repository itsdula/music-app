# ADR 0001 — pnpm + Turborepo monorepo with TypeScript-source internal packages

> **Update (2026-11):** the hosts are now a static Vite+ site (`apps/site`) and an Electron app
> (`apps/desktop`); the Next.js and standalone Vite hosts were removed and Tauri is a future
> option only. The monorepo decision is unchanged. See [hosts.md](../hosts.md).

Status: Accepted (2026-10-29)

## Context

Studio needs strict package boundaries (portable cores, adapters, UI), several hosts
(Next.js, Vite, later Electron/Tauri) and fast iteration.

## Decision

pnpm 10 workspaces + Turborepo 2. Packages export TypeScript source (`"exports": "./src/index.ts"`);
hosts transpile them (Next `transpilePackages`, Vite natively). Only `@studio/react`
builds an artifact (`dist/studio.css`); `audio-web` runs a codegen task for inline bundles.

## Alternatives

Nx (heavier), npm workspaces (weaker filtering/caching), prebuilt dist packages (slower
dev loop, duplicated config). Publishing to npm later would add tsup builds per package.

## Consequences

Importing packages type-checks dependency sources under the importer's compiler options,
so options are uniform (base tsconfig). Turbo `typecheck`/`build` depend on `codegen`.
