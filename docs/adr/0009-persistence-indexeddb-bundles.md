# ADR 0009 — IndexedDB persistence with separate assets, migrations and zip bundles

Status: Accepted (2026-10-29)

## Decision

Dexie/IndexedDB stores project JSON (with a backup of the previous good revision, written in
one transaction), asset bytes as `Uint8Array` (not Blob — Safari bugs), derived caches and
settings. Projects are validated with zod + invariants after step-wise migrations. Portable
`.studio` bundles are zip files (fflate) with a checksummed manifest.

## Alternatives

OPFS for assets (good later for very large audio), localStorage (size), a backend (violates
local-first).
