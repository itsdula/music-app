# Persistence

How Nawa stores projects, assets and derived data, and how it keeps them intact.

- Portable logic lives in `@studio/project-storage` (no DOM or Node APIs): schema, migrations,
  bundles, autosave, the in-memory repositories and the revision/backup/recovery rules.
- Host adapters implement the ports in `packages/project-storage/src/repositories.ts`. The browser
  adapter is `createIndexedDbStorage()` in `@studio/platform-browser` (`src/storage`).

Every implementation must pass the shared contract suites in
`packages/project-storage/tests/repository-contracts.ts` (re-exported by
`repositories.contract.test.ts`). The in-memory repositories are the reference implementation.

## Validation pipeline

All untrusted project data goes through `parseProject(input)`: stored records, imported bundles and
pasted JSON alike. It runs three stages, and all three must pass:

1. **Migrate.** `migrateProjectData` upgrades the document to `CURRENT_SCHEMA_VERSION`.
2. **Schema.** `ProjectSchema` (zod 4) checks the result. Every object is strict, so unknown keys are
   rejected. Every number must be finite. Integers are required for ticks, frames, MIDI values and
   byte lengths. Documented ranges are enforced (pan −1..1, pitch 0..127, velocity 1..127, MIDI
   channels 1..16, normalized values 0..1, and so on). Timestamps must be ISO-8601 with `Z` or an
   offset. Strings and collections have size limits (`SCHEMA_LIMITS`). Entity IDs must match
   `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` because they become file names inside bundles. The schema
   also checks that each `assets`/`vocalEdits` map key matches the id inside its value.
3. **Invariants.** `checkProjectInvariants` from `@studio/domain` checks the cross-entity rules:
   references, ordering, and key/id agreement for tracks and clips.

Failures return a `ProjectValidationError` with these fields:

- `stage`: `json`, `version`, `migration`, `schema` or `invariants`
- `issues`: a list of `{ path, message }` entries, where `path` is dotted, e.g.
  `tracks.trk_1.mixer.pan`

A compile-time check in `schema.ts` fails the build if the schema output and the `Project` type drift
apart. Brands are ignored by this check.

`serializeProject` writes stable JSON: keys are sorted, there is 2-space indentation and a trailing
newline. Identical projects therefore produce identical bytes, and saved files diff cleanly.
`serialize → parse` is the identity for valid projects (this is property-tested). The one exception
is `-0`, which JSON writes as `0`.

## Schema versioning policy

- `Project.schemaVersion` is an integer. The current version is `CURRENT_SCHEMA_VERSION` in
  `packages/domain/src/model.ts`.
- **Any change to the persisted shape bumps the version.** This includes adding an optional field,
  because the schema is strict and older builds would reject the new field.
- A document newer than this build supports is rejected with a `version` error ("saved by a newer
  version of Studio…"). It is never downgraded or partially loaded.
- A document without `schemaVersion` is rejected. Version 0 must say `schemaVersion: 0`.
- **Schema v0** is the pre-release draft. Tempo was `tempo: { bpm }` and the loop was stored as
  top-level `loopStart`, `loopEnd` and `loopEnabled`. Everything else matches v1. The frozen fixture
  is `packages/project-storage/tests/fixtures/project-v0.json`.

### How to add v2

1. Change the model in `@studio/domain` and set `CURRENT_SCHEMA_VERSION = 2`.
2. Update `ProjectSchema` so it describes v2. The compile-time mirror check shows you where.
3. In `migrations.ts`, write `migrateV1ToV2: ProjectMigration` with `fromVersion: 1`. It must:
   - read untyped JSON
   - validate every field it reads, returning `err([{ path, message }])` on bad input
   - never mutate its input
   - return the new document with `schemaVersion: 2`
4. Append it to `MIGRATIONS`. The registry must stay contiguous: `MIGRATIONS[i].fromVersion === i`.
   A test enforces this.
5. Add a frozen v1 fixture next to `project-v0.json`. Add tests that cover:
   - fixture → v2 is valid
   - each malformed-input branch
   - the v0 → v2 chain
6. Old migrations are never edited. Stored data and bundles from every past version must keep
   loading.

Repositories store whatever version they were given. The next save writes the current version, so
migration happens on load and persists on the next save.

## Project bundles (`.studio`)

A bundle is a ZIP archive (fflate). The extension is `.studio` and the MIME type is
`application/vnd.studio.bundle+zip`.

```
manifest.json            written first
project.json             serializeProject(project)
assets/<assetId>.<ext>   encoded bytes exactly as stored, sorted by id
```

`manifest.json` is stable JSON with these fields:

| Field           | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `format`        | `"studio.bundle"`                                                        |
| `formatVersion` | `1`. Newer versions are rejected with `unsupported-format`.              |
| `schemaVersion` | The schema version of `project.json` as written                          |
| `createdAt`     | The project's `updatedAt`. Wall-clock time is not used, for determinism. |
| `entries`       | `[{ path, size, sha256 }]` for every member except the manifest          |

The extension comes from the MIME type: `wav`, `mp3`, `ogg`, `opus`, `flac`, `aac`, `m4a`, `webm` or
`aiff`, with `bin` as the fallback. PCM formats and JSON are deflated. Already-compressed formats are
stored without compression.

### Export

`exportProjectBundle({ project, assets }, { sha256 })` does the following:

- Validates the project.
- Includes exactly the assets listed in `project.assets`. Extra records are ignored.
- Fails if a listed asset is missing (`missing-entry`).
- Fails if an asset's bytes disagree with its `byteLength` or `contentHash` (`asset-mismatch`).

The output is byte-for-byte deterministic. Every member gets a fixed modification time, built from
local-time fields so it is the same in every time zone. Entry order and JSON are also fixed.

### Import

`importProjectBundle(bytes, { sha256 }, limits?)` treats its input as hostile. Nothing in the
manifest or the ZIP directory is believed until it has been checked against the bytes. The checks
run in this order:

1. **Directory checks.** These run inside fflate's per-entry filter, before any entry is
   decompressed:
   - entry count ≤ `maxEntries`
   - the path is safe: no empty segments or directory entries, no `.` or `..`, no leading `/`, no
     drive letters, no backslashes, no control characters, at most 255 characters
   - no duplicate names
   - the layout is allowed: only `manifest.json`, `project.json` and `assets/<id>.<ext>`
   - the compression method is stored or deflate
   - the declared size is ≤ `maxEntryBytes`, and ≤ `maxJsonBytes` for JSON entries
   - the running total is ≤ `maxTotalUncompressedBytes`

   Deflated entries are inflated into a buffer of exactly the declared size. An understated size
   (a zip bomb) therefore cannot use more memory than the limits allow. It only produces truncated
   output, which the size check below catches.

2. **Manifest.** Parse the JSON, check the format id and version, then apply the strict schema.
3. **Manifest vs. archive.** Every listed entry must be present with the exact `size`. No member may
   be unlisted. `project.json` must be listed.
4. **Checksums.** The SHA-256 of every entry must equal its manifest digest.
5. **Project.** `project.json` must pass `parseProject`, and the version it was migrated from must
   equal `manifest.schemaVersion`.
6. **Assets.** Every asset in `project.assets` must be present at its derived path, with `size`
   equal to `byteLength` and digest equal to `contentHash`. Listed assets that the project does not
   reference are rejected.

Failures return a `BundleError` with these fields:

- `code`: one of `invalid-archive`, `limit-exceeded`, `unsafe-path`, `duplicate-entry`,
  `unexpected-entry`, `missing-entry`, `size-mismatch`, `checksum-mismatch`, `invalid-json`,
  `invalid-manifest`, `unsupported-format`, `invalid-project` or `asset-mismatch`
- `path`, when the error concerns one entry
- `issues`, for manifest and project validation errors

Default limits (`DEFAULT_BUNDLE_LIMITS`):

| Limit                       | Default                   |
| --------------------------- | ------------------------- |
| `maxTotalUncompressedBytes` | 2 GiB                     |
| `maxEntryBytes`             | 2 GiB                     |
| `maxJsonBytes`              | 64 MiB                    |
| `maxEntries`                | 10 002 (assets limit + 2) |

## Autosave

`AutosaveCoordinator` is constructed with:

- `repository`
- `delayMs`
- `scheduler`: `setTimeout` and `clearTimeout`
- `now`
- optional: `onStatus`, `maxRetries` (default 3), `retryBaseMs` (default `delayMs`),
  `maxBackoffMs` (default 30 s) and `initialRevision`

Its behaviour:

- **Debounce.** `notifyChanged(project)` restarts a `delayMs` timer. Only the newest project is
  saved.
- **Single flight.** Only one save runs at a time. Changes made during a save are saved after it,
  once their own debounce has passed. If the debounce already passed, they are saved immediately.
- **Timestamps.** The saved copy gets `updatedAt = now()`. The caller's object is never mutated.
- **Revisions.** Each save passes `expectedRevision`, which is the revision last loaded or saved.
  Pass `initialRevision` from `ProjectLoadResult.revision`, or `0` for a new project. If it is
  omitted, the first save is unconditional.
- **Conflict.** If the repository returns `conflict`, the status becomes `conflict` with
  `{ expectedRevision, storedRevision }` and saving pauses. Nothing is overwritten silently. Call
  `acceptRevision(storedRevision)` to overwrite on purpose ("keep mine"). Otherwise reload the
  project and create a new coordinator.
- **Failure.** A failed save is retried after `retryBaseMs · 2^(n−1)` (capped), at most `maxRetries`
  times. Then the status becomes `error`. `ProjectValidationError`, `InvalidRecordError` and
  `StorageQuotaError` are not retried (`retryable: false`). Retrying cannot fix them. The unsaved
  project is kept, and the next change or `flush()` tries again.
- **`flush()`** saves now and resolves once everything is stored, or after one failed or
  conflicting attempt. It never rejects, so check `getStatus()` afterwards.
- **`dispose()`** cancels timers and drops unsaved changes. Call `flush()` first if you want to keep
  them.

`AutosaveStatus.state` is one of `idle`, `pending`, `saving`, `saved`, `error` or `conflict`. Each
state carries details:

| State      | Details                                        |
| ---------- | ---------------------------------------------- |
| `pending`  | `retry` information while a retry is scheduled |
| `saving`   | `attempt`                                      |
| `saved`    | `revision`, `savedAt`, `updatedAt`             |
| `error`    | `error`, `attempts`, `retryable`               |
| `conflict` | `expectedRevision`, `storedRevision`           |

## Repositories: revisions, backups, recovery

These rules are shared by every adapter (`project-records.ts`). Adapters only perform the atomic
reads and writes.

- Each project has a **primary** and a **backup** `StoredProjectRecord`
  (`{ id, revision, savedAt, data }`) and a `ProjectSummary`.
- **Save** happens in one atomic unit:
  1. Validate the project. It must be the current version and pass `parseProject`. If not, throw
     `ProjectValidationError`.
  2. Compare `expectedRevision` with the head revision. On a mismatch, return
     `{ status: 'conflict', storedRevision }`.
  3. Write the new primary with `revision = head + 1`.
  4. The previous primary becomes the backup **only if it still parses**. A corrupt primary never
     replaces the last good backup. The previous primary is re-validated on every save; the code
     never relies on remembering that it was valid.
  5. Write the summary.
- The **head revision** is the primary's `revision` if its envelope is readable, even when its
  payload is corrupt. Otherwise it is the backup's revision, and otherwise 0.
- **Load** returns one of:
  - the primary, if it is valid
  - otherwise the backup, with `recoveredFromBackup: true` and `revision` = head revision. A save
    with that `expectedRevision` repairs the primary.
  - otherwise `{ status: 'corrupt', errors }`, with messages prefixed `primary:` or `backup:`
  - `not-found`, if neither record exists

  Older stored documents are migrated, and `migratedFrom` reports the original version.

- `list()` reads summaries only, sorted by most recently updated first and then by id.
- Assets are validated on `put`: the metadata must pass `AssetRefSchema` and `byteLength` must equal
  the byte count. Invalid records throw `InvalidRecordError`. Bytes are copied on write and on read.

## IndexedDB layout (`@studio/platform-browser`)

Database `studio` (configurable with `dbName`), Dexie schema version 1. Dexie multiplies this by
10, so the native IndexedDB version is 10.

| Store              | Key                   | Value                                    |
| ------------------ | --------------------- | ---------------------------------------- |
| `projects`         | out-of-line projectId | primary `StoredProjectRecord`            |
| `projectBackups`   | out-of-line projectId | backup `StoredProjectRecord`             |
| `projectSummaries` | keyPath `id`          | `ProjectSummary`                         |
| `assetMeta`        | keyPath `id`          | `AssetRef`                               |
| `assetBytes`       | out-of-line assetId   | `Uint8Array` (exactly the asset's bytes) |
| `derived`          | out-of-line string    | any structured-cloneable value           |
| `settings`         | out-of-line string    | any structured-cloneable value           |

- **Atomicity.** A project save reads both slots, plans the save and writes the primary, backup and
  summary in one `rw` transaction over all three stores. An asset `put` and `delete` each cover
  `assetMeta` and `assetBytes` in one transaction. If any request fails, the transaction aborts and
  nothing changes. This is tested by injecting failures.
- **Out-of-line keys** for project records mean any value can sit under a project id and be judged
  on load, which is what makes recovery possible. Possible values include a torn write, a record
  from another build, or a non-object.
- **No full reads for listing.** `assets.listIds()` uses a key-only cursor on `assetMeta`.
  `has`/`getMeta` never read `assetBytes`. `projects.list()` reads only `projectSummaries`.
- **Views.** A `Uint8Array` that is a view into a larger buffer is copied first, so only its own
  bytes are stored.
- **Corruption** in asset rows makes `get` throw `StorageCorruptionError` instead of returning bad
  data. This covers malformed metadata, missing bytes, and a length that disagrees with the metadata.
- Dexie's cache is disabled (`cache: 'disabled'`). Every read goes to IndexedDB, so writes from
  other tabs are seen.
- **Multiple tabs** share the database. Optimistic concurrency (`expectedRevision`) turns
  overlapping edits into `conflict`.

### Upgrading the database schema

Never edit an existing `version(n)` block. To change the layout, add a new block:
`this.version(2).stores({...}).upgrade(tx => ...)`. List only the changed stores, use `null` to
delete one, and bump `DB_SCHEMA_VERSION`.

The upgrade runs once per browser profile inside a `versionchange` transaction. Keep it idempotent
and fast, and avoid rewriting asset bytes. Project documents are not migrated here: schema
migrations run lazily in `parseProject` on load.

When another tab upgrades, Dexie closes this connection, and later calls reject with
`DatabaseClosedError`. The session should then ask the user to reload.

## Quota handling

- Browsers report a full quota either on the failing request or as the reason a transaction aborted.
  The adapter detects it with `isQuotaError`, which recognises:
  - `QuotaExceededError` (including when it is wrapped in Dexie's `inner` or a standard `cause`)
  - Firefox's `NS_ERROR_DOM_QUOTA_REACHED`
  - legacy codes 22 and 1014
- Detected errors are rethrown as the portable `StorageQuotaError`, whose message suggests freeing
  space or granting persistent storage.
- Because writes are transactional, a quota failure leaves the previous revision intact.
- Autosave reports quota failures as `error` with `retryable: false`.
- Hosts should request persistent storage (`PermissionsService.request('persistent-storage')`, which
  calls `navigator.storage.persist()`) and can show `navigator.storage.estimate()`.
- `createMemoryAssetRepository({ quotaBytes })` simulates a quota in tests.

## Derived-data cache keys

Keys follow `<kind>:<contentHash>:<algorithmVersion>:<paramsHash>`. Use `derivedCacheKey()` to build
them.

- `kind` is the value family: `peaks`, `pitch`, `vocal-render`, and so on.
- `contentHash` is the source asset's SHA-256 (`AssetRef.contentHash`).
- `algorithmVersion` is bumped whenever the producing algorithm's output changes.
- `paramsHash` is a hash of the canonical parameters, or `-` when there are none.

Each segment must match `[A-Za-z0-9_.+-]{1,128}`, so `:` never appears inside a segment.

Every input is part of the key, so a changed input simply misses the cache and no invalidation is
needed. Entries may be evicted at any time. Values must be structured-cloneable; typed arrays are
fine.

To sweep stale entries, use `deleteByPrefix(derivedCachePrefix(kind))` for an algorithm family, or
`derivedCachePrefix(kind, contentHash)` for one asset. IndexedDB serves `deleteByPrefix` with a
single key range `[prefix, successor(prefix))` and never scans.

## Preferences (key-value)

Small UI preferences go through `PlatformServices.preferences`: the theme configuration, keymap
overrides, panel layout and toggles. They must be readable before first paint, so their port,
`KeyValueStore` (`packages/project-storage/src/preferences.ts`), works differently from
`SettingsRepository`:

- **Reads are synchronous.** Every adapter keeps all entries in memory. `get` and `keys` never do
  I/O.
- **Writes go through.** `set` and `delete` update memory at once, notify subscribers, and then
  persist. A failed write never reaches the caller. This covers a full quota, blocked storage and
  disk errors. The value stays in memory for the session and the adapter logs one warning.
- **`flush()`** resolves once every earlier write is persisted or has failed. It never rejects.
- **Values are strings.** Encode structured values as JSON and validate them when you read them
  (with zod, for example). Stored data can come from an older build or from another tab.
- **Subscribers** run synchronously after each change, including changes made in another tab.
  Writes that change nothing don't notify. `usePersistentToggle` reads through
  `useSyncExternalStore`.

Structured settings that can be read asynchronously stay on `SettingsRepository`. These are MIDI
mappings, recording latency, the last project and tutorial progress.

### Adapter per host

| Host     | Adapter                              | Data lives in                        |
| -------- | ------------------------------------ | ------------------------------------ |
| Website  | `createLocalStorageKeyValueStore()`  | localStorage, as `studio.pref.<key>` |
| Electron | `createBridgedKeyValueStore(bridge)` | `<userData>/preferences.json`        |
| Tests    | `createMemoryKeyValueStore()`        | memory                               |

Each host passes its adapter to `createBrowserPlatform({ preferences })` explicitly
(`apps/site/src/studio/main.tsx`, `apps/desktop/src/renderer/main.tsx`). localStorage is also the default. In Electron the
bridge is `window.studioHost.preferences`, and the main process owns the file. The platform owns
the store, and its `dispose()` flushes it.

- **Why localStorage in browsers.** It is the only synchronous persistent browser storage, and it
  works where IndexedDB is unavailable. Storage is per origin, so the dev server
  (`localhost:3000`), the local preview (`localhost:3200`) and the live site
  (`itsdula.github.io`) each keep their own preferences and projects. On GitHub Pages the origin
  is `https://itsdula.github.io`, which every project site of that account shares, so pages
  there could read Nawa's localStorage and IndexedDB. The `studio.pref.` prefix only avoids key
  collisions; a custom domain would give Nawa its own origin.
- **Why a Node file in Electron.** The main process owns the file. It can read preferences before
  any window exists, for example a theme background colour for `BrowserWindow`. The file is plain
  JSON that a user can inspect, and it survives clearing Chromium's storage. A single owner also
  avoids races between processes. The renderer's own localStorage would work too, but main could
  not read it.

**localStorage adapter** (`platform-browser/src/storage/local-storage.ts`):

- It reads every key that starts with the prefix (default `studio.pref.`) once, and ignores all
  other keys. Invalid stored entries are skipped.
- With the default prefix it first moves UI toggles saved by older builds (`studio.ui.<key>`) to
  `studio.pref.ui.<key>`, keeping a value already there, and deletes the old keys. Electron does
  not carry the renderer's old localStorage toggles into `preferences.json`; they reset once.
- It listens to `storage` events. A change in another tab updates this tab and notifies its
  subscribers. A `clear()` in another tab resynchronises the whole namespace.
- If localStorage is missing or throws on access, as with blocked site data or some private
  modes, it keeps values in memory only (`persistent: false`).

**Bridged adapter** (`platform-browser/src/storage/bridged.ts`):

- It awaits `bridge.load()` once. The Electron renderer's async platform provider does this before
  `<Studio />` mounts. If the load fails or returns something malformed, the store starts empty
  and logs a warning.
- It then sends writes to the bridge one call at a time, in order. Writes to a key that is still
  queued are coalesced into the latest value, so dragging a splitter sends a few IPC calls, not
  hundreds.
- It is generic: the bridge is any `{ load, set, delete }` object, and nothing in it imports
  Electron.

**Electron main store** (`apps/desktop/src/main/preferences-store.ts`):

- The file is `{ "version": 1, "entries": { ... } }` with sorted keys and 2-space indentation.
- It is loaded synchronously when the app is ready. A missing file means no preferences. An
  unreadable file is renamed to `preferences.json.corrupt` and the store starts empty. That covers
  invalid JSON, another version and files over 8 MiB. Invalid entries are skipped.
- Writes are debounced by 250 ms. Each write goes to `preferences.json.tmp`, is fsynced, and is
  renamed over the old file, so a crash leaves either the old or the new file. The store is
  flushed on `before-quit` and `will-quit`. A failed write is retried on the next change or
  flush.
- The IPC handlers check the sender and validate every argument again
  ([hosts.md §1.6](hosts.md#16-ipc-surface)).

Every adapter passes `runKeyValueStoreContract` in
`packages/project-storage/tests/repository-contracts.ts`. It runs against memory, localStorage (a
fake `Storage` in Node and jsdom's real one) and the bridged store over a fake bridge.

### Keys and limits

- **Keys** are 1–128 characters of `A–Z a–z 0–9 _ . -` and start with a letter or digit
  (`PREFERENCE_KEY_PATTERN`). Use dotted camelCase segments named after the feature, such as
  `ui.pianoRoll.velocityLane.editor`, `theme.config`, `keymap.overrides` or `layout.panels`.
  `ui.` holds the `usePersistentToggle` toggles.
- **Changing a format.** When a value's format changes incompatibly, use a new key (`theme.v2`)
  rather than rewriting the old value, so an older build still reads what it wrote.
- **Values** are strings of at most 64 KiB in UTF-8 (`PREFERENCE_LIMITS.maxValueBytes`). Every
  adapter throws `InvalidRecordError` for an invalid key or an oversized value. A bug therefore
  shows up in the browser too, not only in Electron.
- **Total size.** Electron's main process keeps keys plus values within 1 MiB
  (`MAX_PREFERENCES_TOTAL_BYTES`) and refuses writes beyond it. Browsers apply their own
  localStorage quota, about 5 MiB per origin, which the adapter handles as a failed write.

## Native storage adapters (desktop, future)

The ports, the `planProjectSave`/`resolveProjectLoad` logic, the schema, migrations, bundles and
autosave are all portable and reused as they are.

The desktop app currently keeps projects in IndexedDB, like the website. A file-based adapter for
the desktop app (or a future native host, see [hosts.md §2](hosts.md)) would replace the storage
layer:

- **Projects.** Store them as files, e.g. `<projectsDir>/<id>/project.json` plus
  `project.backup.json`. Get atomicity by writing a temporary file, calling fsync, renaming it over
  the primary, and keeping the previous good file as the backup. Keep summaries in an index file or
  recompute them.
- **Assets.** Store each one as `assets/<contentHash>.<ext>`, which makes it content-addressed and
  deduplicated. Keep the metadata in a sidecar.
- **Derived cache.** Use a cache directory keyed by the same key strings, or SQLite. A plain file
  directory needs prefix deletion by listing it.
- **Settings.** Use the app config file.
- **Preferences.** Electron already keeps them in a JSON file owned by the main process (see
  [Preferences](#preferences-key-value)). A native host could follow the same pattern with a
  backend command as the `createBridgedKeyValueStore` bridge.
- **Quota.** Map `ENOSPC` to `StorageQuotaError`.
- **Bundles.** Write them to user-chosen paths with native file dialogs (`FileDialogs`).

Electron's renderer can also keep using the IndexedDB adapter unchanged. Every adapter must pass the
contract suites; the harness only needs a way to write raw records for the recovery tests.
