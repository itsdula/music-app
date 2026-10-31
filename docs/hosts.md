# Hosts: Electron implementation and Tauri design

Studio's UI is one portable component, `<Studio platform? config? />` from `@studio/react`.
A host does three things. It mounts the component, provides `PlatformServices` (see
`packages/platform-contracts/src/platform.ts`) and owns whatever the web platform cannot do
by itself. The Next.js app (`apps/web`) and the Vite host (`apps/vite-host`) use the browser
platform unchanged. This document covers:

- the **Electron host** (`apps/electron-host`), which is implemented and smoke-tested;
- the **Tauri host**, a design only. It replaces audio, MIDI and file access with a Rust backend
  without changing the React UI.

Background: [architecture.md §11](architecture.md),
[research/platform-compatibility.md §6](research/platform-compatibility.md) and
[rust-migration-map.md](rust-migration-map.md).

---

## 1. Electron host (`apps/electron-host`)

### 1.1 Process model

```
┌──────────────── main process (Node 24, ESM: dist/main/main.js) ─────────────────┐
│ protocol.handle('studio')  ─ serves dist/renderer, adds CSP + security headers  │
│ session permission handlers ─ media(audio) / midi / clipboard-sanitized-write   │
│ ipcMain.handle('studio-host:save-file' | 'studio-host:open-files')              │
│   └─ sender check → argument validation → dialog.showSave/OpenDialog → fs       │
│ single-instance lock, navigation / window.open / webview blocking               │
└───────────────▲─────────────────────────────────────────────────────────────────┘
                │ ipcRenderer.invoke (structured clone; Uint8Array copied)
┌───────────────┴──── renderer (Chromium 156, sandboxed, context-isolated) ───────┐
│ preload (isolated world, CJS: dist/preload/preload.cjs)                          │
│   contextBridge.exposeInMainWorld('studioHost', { saveFile, openFiles, platform })│
│ page (main world, studio://app/index.html)                                       │
│   createBrowserPlatform({ hostKind: 'electron' }) + fileDialogs → studioHost     │
│   <Studio platform={platform} />  (Web Audio + AudioWorklet, Web MIDI, IndexedDB)│
└──────────────────────────────────────────────────────────────────────────────────┘
```

| File                             | Role                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `src/main/main.ts`               | Electron wiring: scheme, protocol, permissions, window, hardening, instance lock  |
| `src/main/ipc.ts`                | IPC handlers (sender check, validation, native dialogs, `fs`)                     |
| `src/main/policy.ts`             | **Pure**: origin checks, permission policy, navigation rule, CSP, headers         |
| `src/main/validation.ts`         | **Pure**: IPC argument validation, accept-list → extensions, file-name sanitising |
| `src/main/app-files.ts`          | **Pure**: `studio://app/…` → file path with traversal guard, content types        |
| `src/preload/preload.ts`         | The `window.studioHost` bridge (sandbox-compatible CommonJS bundle)               |
| `src/shared/host-api.ts`         | `StudioHostApi` types, channel names, limits, origin constants                    |
| `src/renderer/main.tsx`          | Mounts `<Studio />` in `StrictMode` with the Electron platform                    |
| `src/renderer/file-dialogs.ts`   | `FileDialogs` adapter over `window.studioHost`                                    |
| `src/probe/*`                    | Security probe page used by `smoke --probe` (no Studio packages)                  |
| `scripts/build.mjs`, `smoke.mjs` | Build (esbuild + Vite) and Playwright `_electron` smoke test                      |
| `tests/*.test.ts`                | Node unit tests for the pure modules and the renderer adapter                     |

The pure modules import nothing from `electron`, so they are tested in plain Node.

### 1.2 Loading the renderer: `studio://app/` rather than `file://`

The renderer is served from `dist/renderer` through a custom scheme. The scheme is registered
with `protocol.registerSchemesAsPrivileged` as `standard`, `secure`, `supportFetchAPI`,
`stream` and `codeCache`. Requests are handled by `protocol.handle('studio', …)`.

Reasons for choosing it over `file://`:

- **A real, stable origin.** `studio://app` is an origin like any web origin. Permission
  handlers, IPC sender checks and navigation rules compare against one constant. `file://`
  pages share the opaque/`file` origin with every local file.
- **Secure context.** Web MIDI, `getUserMedia` and AudioWorklet need a secure context. They
  work on the privileged scheme, and storage (IndexedDB) is per origin as in the browser
  hosts.
- **No ambient file access.** `file://` lets a page fetch any readable file, depending on
  flags. The protocol handler serves only files under `dist/renderer`. It rejects other hosts,
  encoded separators (`%2f`, `%5c`), NUL bytes and anything that resolves outside the root
  (`resolveAppFile`), and it answers only `GET`/`HEAD`.
- **Headers.** Every response carries the CSP, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` and
  `Referrer-Policy: no-referrer`. COOP plus COEP make the page cross-origin isolated, so
  `SharedArrayBuffer` and `Atomics` are available. The CSP already limits subresources to
  `'self'`, `blob:` and `data:`, so `require-corp` blocks nothing the app loads. A `file://`
  page could only use a `<meta>` CSP.
- **Relative asset paths still work.** Vite builds with `base: './'`, so the same output would
  also load from `file://` if ever needed.

### 1.3 Security settings

`BrowserWindow` `webPreferences` are set as follows:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- `nodeIntegrationInWorker: false`, `nodeIntegrationInSubFrames: false`
- `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`

`app.enableSandbox()` forces the sandbox for every `WebContents`. It is skipped only when the
operator passes `--no-sandbox` (CI as root), because Chromium aborts child processes when both
are set. Even then the per-window `sandbox: true` keeps the preload in the sandboxed (no Node)
environment.

Every `WebContents` is hardened through `app.on('web-contents-created')`:

- `setWindowOpenHandler` → always `deny`.
- `will-navigate`, `will-redirect` and `will-frame-navigate` → prevented unless the target
  origin is `studio://app`.
- `will-attach-webview` → prevented.

The device permission handler denies HID, USB and serial. `app.requestSingleInstanceLock()`
makes a second launch focus the existing window and quit.

### 1.4 Content-Security-Policy

`buildContentSecurityPolicy()` in `src/main/policy.ts` produces:

```
default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:;
style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:;
media-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none';
frame-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

- `blob:` in `script-src` and `worker-src` is required. Studio ships its AudioWorklet
  processors and Workers (vocal DSP) as inline bundles loaded from Blob URLs
  (`platform-browser/src/workers/inline-worker.ts`). `addModule()` is governed by `script-src`,
  and `new Worker()` by `worker-src`.
- There is no `'unsafe-eval'` and no inline script. The smoke test checks that `eval` throws
  and that an injected inline `<script>` does not run.
- `style-src 'unsafe-inline'` is the one relaxation. Radix UI (Select, ScrollArea) and
  `react-remove-scroll` inject `<style>` elements at runtime. CSS injection without script
  execution is low risk. Possible hardening later: serve a per-response nonce and pass it to
  `get-nonce`.
- `media-src blob: data:` is for previews and recorded takes. `connect-src blob: data:` is for
  `fetch()` of Blob/data URLs during decoding.

### 1.5 Permissions

`isPermissionAllowed(permission, origin, mediaTypes?)` is pure and backs both
`setPermissionRequestHandler` and `setPermissionCheckHandler`:

| Permission                  | App origin (`studio://app`) | Any other origin |
| --------------------------- | --------------------------- | ---------------- |
| `media`                     | ✅ audio only (no `video`)  | ❌               |
| `midi`                      | ✅                          | ❌               |
| `clipboard-sanitized-write` | ✅                          | ❌               |
| `midiSysex`                 | ❌ **never**                | ❌               |
| everything else             | ❌                          | ❌               |

Electron approves every request when no handler is installed
([platform-compatibility §6.1](research/platform-compatibility.md)), so both handlers are
always set. The smoke test checks the following `navigator.permissions` states: `midi` granted,
`midi`+SysEx denied, microphone granted, camera, geolocation and notifications denied. It also
checks that `requestMIDIAccess({ sysex: true })` rejects with `NotAllowedError`.

### 1.6 IPC surface

```ts
interface StudioHostApi {
  saveFile(bytes: Uint8Array, suggestedName: string, mimeType: string): Promise<boolean>;
  openFiles(accept: string[], multiple: boolean): Promise<Array<{ name; mimeType; bytes }>>;
  readonly platform: { os: string; versions: { electron: string; chrome: string } };
  readonly preferences: {
    load(): Promise<Record<string, string>>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
```

| Channel (`IPC_CHANNELS`)         | Preload method       | Arguments validated in main                  |
| -------------------------------- | -------------------- | -------------------------------------------- |
| `studio-host:save-file`          | `saveFile`           | `validateSaveFileArgs`                       |
| `studio-host:open-files`         | `openFiles`          | `validateOpenFilesArgs`                      |
| `studio-host:preferences-load`   | `preferences.load`   | `validatePreferencesLoadArgs` (no arguments) |
| `studio-host:preferences-set`    | `preferences.set`    | `validatePreferenceSetArgs` (key, value)     |
| `studio-host:preferences-delete` | `preferences.delete` | `validatePreferenceDeleteArgs` (key)         |

- The preload exposes only this frozen object. It never exposes `ipcRenderer`, `process` or
  `require`. It type-checks arguments for early errors.
- The main process is the trust boundary. Each handler does the following:
  - It checks the **sender** (`event.senderFrame` is the main frame and its URL is on
    `studio://app`).
  - It validates the **arguments** (`validateSaveFileArgs` / `validateOpenFilesArgs`):
    - exact arity;
    - `bytes instanceof Uint8Array`, at most 2 GiB;
    - names are 1–255 characters, contain no `/`, `\`, `.`/`..` or control characters, and are
      sanitised for Windows-reserved characters and device names;
    - the MIME type matches `type/subtype`;
    - the accept list has at most 64 entries, each `.ext`, `type/subtype`, `type/*` or `*/*`;
    - `multiple` is a boolean;
    - preference keys are 1–128 characters of `A–Z a–z 0–9 _ . -` and start with a letter or
      digit. Preference values are strings of at most 64 KiB in UTF-8.
- `saveFile` runs `dialog.showSaveDialog` with the default path in Documents, an extension
  filter and overwrite confirmation, then `fs.writeFile`. A cancel resolves `false`.
- `openFiles` maps the accept list to extensions and uses them as the dialog filter. It then
  re-checks every chosen path against those extensions, because the user can type any path in
  GTK. It `stat`s each file (at most 2 GiB per file and in total, at most 256 files) and returns
  sanitised base names, MIME types guessed from the extension, and bytes. A cancel resolves `[]`.
- `preferences.*` reads and writes the main-process store
  (`src/main/preferences-store.ts`), which is kept in `<userData>/preferences.json`. `load`
  returns a copy of every entry. `set` also refuses a write that would take the total of keys
  plus values over 1 MiB. Writes reach the disk debounced (250 ms) and atomically (temporary
  file, fsync, rename). The store is flushed on `before-quit` and `will-quit`. The renderer does
  not call these methods directly: `createBridgedKeyValueStore(host.preferences)` loads once and
  then mirrors its writes. See [persistence.md, Preferences](persistence.md#preferences-key-value).
- Bytes cross IPC by structured clone, which copies them. The 2 GiB cap mirrors the
  `FileDialogs` contract. In practice Chromium's IPC is comfortable well below that. Very large
  imports should move to a streamed path, for example a `MessageChannelMain` port carrying
  chunks. That is deferred until a real workload needs it.

### 1.7 How platform services map

| `PlatformServices` member                | Electron implementation                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `audioBackendFactory`                    | Web Audio + AudioWorklet (`@studio/audio-web`) — Chromium 156, unchanged       |
| `midiAccess`                             | Web MIDI (`platform-browser/midi`); `midi` granted, SysEx denied by main       |
| `projectRepository`, `assetRepository`…  | IndexedDB (Dexie) in the `studio://app` origin, under Electron's `userData`    |
| `fileDialogs`                            | **Native**: `createElectronFileDialogs(window.studioHost)` → IPC → `dialog`    |
| `preferences`                            | **Native**: `createBridgedKeyValueStore` → IPC → main → `preferences.json`     |
| `permissions`                            | Browser Permissions API, answered by the main-process permission check handler |
| `deviceInfo`                             | Browser detection with `hostKind: 'electron'`                                  |
| `createVocalProcessor`                   | Blob-URL Worker (allowed by `worker-src blob:`)                                |
| `audioDecoder`, `hasher`, `logger`, etc. | Browser implementations, unchanged                                             |

The renderer passes an async platform provider to `<Studio />`. It first awaits
`createBridgedKeyValueStore(window.studioHost.preferences)`, so preferences are in memory before
Studio renders. Then `createBrowserPlatform({ hostKind: 'electron', preferences })` builds
everything else, and the renderer overrides `fileDialogs`. The file-dialogs adapter is typed
structurally. Apps may not import `@studio/platform-contracts` (dependency-cruiser rule
`apps-only-public-entry-points`), so the compiler checks it where the provider returns the
`PlatformServices` object.

### 1.8 Build, run and smoke-test

```bash
pnpm turbo run build --filter=@studio/electron-host...   # codegen + @studio/react CSS + host
pnpm --filter @studio/electron-host start                # electron .  (add --no-sandbox as root)
pnpm --filter @studio/electron-host smoke                # full: waits for <Studio /> ready
pnpm --filter @studio/electron-host smoke:probe          # shell only: protocol/CSP/IPC/permissions
pnpm --filter @studio/electron-host test                 # Node unit tests (own vitest config)
pnpm --filter @studio/electron-host typecheck            # whole app (renderer pulls in Studio)
pnpm --filter @studio/electron-host typecheck:host       # main/preload/shared/tests only
```

- `scripts/build.mjs` writes four outputs:
  - `dist/main/main.js`: esbuild, ESM, `node24`, `electron` external;
  - `dist/preload/preload.cjs`: esbuild, CJS, `platform: node`, `electron` external. Sandboxed
    preloads must be CommonJS;
  - `dist/probe/`;
  - `dist/renderer/`: Vite, `base: './'`.

  `--skip-renderer` builds the first three only.

- `scripts/smoke.mjs`:
  - **Setup.** It builds first; full mode builds through turbo so workspace codegen runs.
    Without `$DISPLAY` it re-executes under `xvfb-run -a`. It launches the Electron binary
    through Playwright's `_electron`, passing `--no-sandbox` when running as root, with a
    temporary `userData` directory.
  - **Load checks.** It waits for `[data-testid="studio-root"][data-studio-status="ready"]`,
    or the probe page in `--probe` mode. It checks that the page is on `studio://app/`, that
    `window.studioHost` exists with only `openFiles`/`platform`/`preferences`/`saveFile` (and
    `preferences` with only `load`/`set`/`delete`, frozen), and that `require`,
    `process`, `module` and `Buffer` are undefined. It also checks for a secure context, for
    cross-origin isolation with `SharedArrayBuffer` available, and for no console errors during
    load.
  - **Security checks.** CSP header present, `eval` and inline scripts blocked. Protocol
    traversal, other-host and `POST` requests refused. The permission states listed above.
    `window.open` denied and navigation to `https://` blocked. Invalid IPC arguments rejected,
    including an invalid preference key and a preference value over 64 KiB.
  - **Round trip.** It stubs `dialog.showSaveDialog`/`showOpenDialog` in the main process
    (`electronApp.evaluate`) to test save → open → cancel end to end. It also runs preferences
    set → load → delete → load, and after quitting checks that `preferences.json` in the
    temporary `userData` holds the value, which shows the quit-time flush works.
  - **Probe mode** also asserts that a Blob-URL Worker and a Blob-URL AudioWorklet module run
    under the production CSP.
  - It exits non-zero on any failure.

The pure modules have unit tests in `tests/`. They are not matched by the root Vitest `unit`
project, which only includes `packages/*/tests/**`. Run them with the package `test` script, or
with `pnpm exec vitest run --config apps/electron-host/vitest.config.ts`.

### 1.9 Package a macOS app

```bash
pnpm package:mac   # build, then out/Studio-darwin-<arch>/Studio.app and out/Studio-mac-<arch>.zip
```

`scripts/package-mac.mjs` stages `dist/` (without source maps or the probe page) with a minimal
`package.json` and packages it with `@electron/packager`: a `Studio.app` for this Mac's
architecture, using the Electron version the host is pinned to, with the icon from
`resources/icon.icns` (drawn in `resources/icon.svg`) and an asar archive. `dist/` is fully
bundled, so the app carries no `node_modules`.

The app is signed ad hoc, not with an Apple Developer ID, and is not notarized. On another Mac,
Gatekeeper blocks the first launch: right-click the app and choose **Open**, or run
`xattr -cr Studio.app`. The packaged app keeps its projects under its own `userData` folder
(`~/Library/Application Support/Studio`), separate from `pnpm --filter @studio/electron-host start`.

Not in scope yet: Windows and Linux packages, auto-update, Developer ID signing and
notarization, installers (DMG, electron-builder/forge) and fuses (`runAsNode`, `nodeOptions`,
`onlyLoadAppFromAsar`).

---

## 2. Tauri host (design only)

Goal: the same `<Studio />` and the same `PlatformServices` contract. Audio, MIDI and file
access move to a Rust backend wherever the system WebView is weaker than Chromium. The guiding
rule comes from [rust-migration-map.md](rust-migration-map.md): **contract-preserving ports,
never a rewrite**. Real-time audio stays native, and IPC carries commands, state and bulk PCM,
never per-callback audio.

### 2.1 WebView differences per OS

Sources: [platform-compatibility §6.2](research/platform-compatibility.md) and the
[architecture §11 matrix](architecture.md).

| Concern          | Windows — WebView2 (evergreen Chromium) | macOS — WKWebView (ships with OS)    | Linux — WebKitGTK 4.1 (distro)       |
| ---------------- | --------------------------------------- | ------------------------------------ | ------------------------------------ |
| Web MIDI         | ✅ (only here; SysEx permission kind)   | ❌                                   | ❌                                   |
| AudioWorklet     | ✅                                      | ✅ (Safari 14.1+ WebKit)             | ⚠️ depends on build / GStreamer      |
| `getUserMedia`   | ✅                                      | needs `NSMicrophoneUsageDescription` | needs media-stream enabled in wry ❓ |
| `outputLatency`  | ✅                                      | ⚠️                                   | ❓                                   |
| Update cadence   | evergreen                               | OS updates only                      | distro packages                      |
| IPC 10 MB binary | slower (~200 ms anecdotal)              | fast (~5 ms anecdotal)               | ❓                                   |

Consequences:

1. **MIDI is native on every OS** (`midir`). This keeps one code path and avoids the WebView2
   SysEx permission ambiguity.
2. **The audio engine is native on every OS** (cpal). A WebView-specific Web Audio fallback is
   kept only as a degraded mode where AudioWorklet works (Windows, recent macOS).
3. **Storage** can stay IndexedDB inside the WebView at first. A later step can move assets to
   the Rust side (files plus SQLite) behind the same repository interfaces.

### 2.2 Rust backend implementing the `AudioEngine` semantics

The TypeScript port is `AudioEngine` in `packages/audio-contracts/src/engine.ts`. The Rust
backend implements its **semantics**: ticks, transport, changes, meters, render, recording. It
does not mimic Web Audio nodes.

```
            Tauri command thread(s)                     cpal audio callback (RT thread)
 engine_apply ─► EngineController ──► rtrb/ringbuf SPSC ──► AudioGraph (preallocated)
 engine_play      (non-RT: builds        command queue        ├─ TransportClock
 engine_seek       graph diffs,                               ├─ Scheduler (timeline index)
 …                 decodes assets,   ◄── SPSC event queue ◄───├─ voices / tracks / master
                   allocates)            (meters, transport)  └─ metering (peak/RMS/clip)
```

- **Audio callback.** `cpal::Device::build_output_stream` with the device's preferred buffer
  size. The callback is real-time safe: it does no allocation, locking, I/O or logging. It
  drains the command queue at the start of every block. It renders block-wise and advances the
  transport clock by `frames / sample_rate`.
- **Lock-free command queue.** The non-RT controller turns `AudioGraphChange[]` (from
  `diffProjects`, engine-core) into preallocated `RtCommand`s and pushes them through an SPSC
  ring buffer (`rtrb`). Examples: `SetTempo`, `ReplaceTrack(Box<TrackState>)`,
  `InsertClip(Arc<ClipEvents>)`, `Play { from_tick }`, `Seek`. Heavy objects are built off the
  RT thread and handed over as `Box`/`Arc`. Retired objects come back through a return queue so
  that freeing memory never happens on the RT thread.
- **Transport clock.** This is a port of engine-core's transport, `studio_engine::schedule` in
  the migration map. It is anchored at `(anchor_tick, anchor_frame)` with `tick_at(frame)` and
  `frame_at(tick)`, it is loop-aware, and it splits windows at the loop end exactly like the
  Web engine. Musical events are rendered sample-accurately inside the block, with no lookahead
  timer.
- **Offline render.** `engine_render` runs the same graph construction on a non-RT thread
  without a device. This is the single graph path that gives playback ≡ export parity. It
  reports progress through a channel and supports cancellation.
- **Recording.** The cpal input stream feeds an SPSC buffer, which a non-RT writer turns into a
  take. The take start is latency-compensated (§2.6) and returned as `RecordedTake` PCM.
- **Assets.** PCM is decoded once on the Rust side (`symphonia`) or received from the UI
  (§2.4) and stored as `Arc<[f32]>` per channel. `setAssetOverride` swaps the `Arc` through
  the queue.

### 2.3 Commands and events contract

Commands (`#[tauri::command]`, request/response) extend the
[native backend contract](rust-migration-map.md#native-backend-contract-tauri):

| Command                                      | Payload → result                                       | Maps to `AudioEngine` |
| -------------------------------------------- | ------------------------------------------------------ | --------------------- |
| `engine_init(config)`                        | sample rate / latency hint → `AudioEngineCapabilities` | `initialize`          |
| `engine_load(project_json)`                  | `EngineSnapshot` (JSON) → `()` when assets are ready   | `loadProject`         |
| `engine_apply(changes_json)`                 | `AudioGraphChange[]` (JSON, small) → `()`              | `applyChanges`        |
| `engine_play(tick?)` / `engine_pause()`      | → `TransportSnapshot`                                  | `play` / `pause`      |
| `engine_stop()` / `engine_seek(tick)`        | → `TransportSnapshot`                                  | `stop` / `seek`       |
| `engine_render(request, channel)`            | `RenderRequest` → binary PCM (`tauri::ipc::Response`)  | `render`              |
| `engine_set_asset_override(asset_id, pcm?)`  | raw binary body (§2.4); empty body = restore           | `setAssetOverride`    |
| `engine_record_start(opts)` / `_stop()`      | `RecordingOptions` → takes as binary                   | recording methods     |
| `engine_live(event)`                         | note on/off, sustain, bend, mod (tiny JSON)            | `live` port           |
| `midi_list()` / `midi_send(port, bytes, ts)` | → `MidiPortDescriptor[]` / `()`                        | `MidiAccessPort`      |

Events and channels (Rust → UI):

| Stream                        | Mechanism                           | Rate / content                                                                            |
| ----------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `transport`                   | event                               | on state change: `TransportSnapshot` + clock pair                                         |
| `meters`                      | **channel** (`tauri::ipc::Channel`) | ≈ 30 Hz, packed `Float32Array` `[masterPeakL, masterPeakR, rms…, per-track…]` + clip bits |
| `clock`                       | channel                             | ≈ 10 Hz `(engineTimeSeconds, hostTimeMs, tick)` pairs (§2.5)                              |
| `midi_input`                  | channel                             | raw bytes + host timestamp per message                                                    |
| `render_progress`             | channel                             | fraction                                                                                  |
| `recording`, `asset`, `error` | event                               | `RecordingStatus`, asset load status, `EngineError`                                       |

Tauri's own docs say events are not built for throughput, and channels are fast and ordered.
So high-rate streams use channels, and state changes use events.

### 2.4 PCM transfer and buffer ownership

- **Never JSON arrays.** Bulk PCM crosses as binary:
  - Rust → UI: `tauri::ipc::Response::new(bytes)`, delivered to JS as an `ArrayBuffer`.
  - UI → Rust: commands with a raw `Uint8Array` body (`InvokeBody::Raw`) and metadata in
    headers.
  - Large files: the asset protocol (`convertFileSrc`).
- **Wire format.** A 16-byte header (magic, version, channel count, sample rate, frame count)
  followed by **planar** little-endian `f32` channels. This matches `PcmAudio` (one
  `Float32Array` per channel). JS creates `Float32Array` views on the received `ArrayBuffer`
  without copying.
- **Ownership.** Transfer semantics, as in the migration map: once sent, the sender does not
  reuse the buffer. On the Rust side, received bytes are converted once into `Arc<[f32]>` per
  channel and are immutable afterwards. The RT thread only holds `Arc` clones. Renders
  allocate a fresh `Vec<f32>` whose ownership moves into the `Response`.
- **Chunking.** Recorded takes and very long renders stream through a channel in chunks of at
  least 100 ms (platform-compatibility §6.2). This bounds memory and avoids the slow
  large-message path on WebView2.

### 2.5 Clock synchronisation

The contract keeps four clock domains separate: musical ticks, engine time, host time and
frame time (`engine.ts` header).

- The backend's engine time is `frames_rendered / sample_rate` of the output stream. With
  each `clock` message it sends `(engineTimeSeconds, hostTimeMs, tick)`. The host time is taken
  at the start of the callback, from cpal's `OutputCallbackInfo::timestamp().callback`, and
  converted to the WebView's `performance.now()` domain using a one-time offset. The offset is
  measured by round-trip pings (`t_js0 → rust_now → t_js1`, minimum-RTT sample, refreshed
  every few seconds).
- The TS adapter keeps the last few pairs and fits `engineTime = a + b·hostTime`, where `b`
  absorbs drift between the audio clock and the host clock. `getTransportPosition()`, which is
  polled from `requestAnimationFrame`, extrapolates from the latest pair:
  `ticks = tick₀ + (hostNow − host₀)·b·bpm·PPQ/60`, loop-wrapped as in the Web engine. The
  playhead stays smooth with only about 10 Hz updates.
- MIDI input timestamps from `midir` (µs since port open) are mapped into the same host
  domain. The MIDI recorder and quantisation therefore behave as in browsers.

### 2.6 Latency compensation

- Output latency is taken from `OutputCallbackInfo::timestamp()` (`playback − callback`) and
  reported as `outputLatencySeconds`. The buffer size divided by the sample rate is reported as
  `baseLatencySeconds`. Input latency comes from the input stream's `capture` timestamp.
- Playhead: the UI shows `tick_at(engineTime − outputLatency)`, so what you see is what you
  hear.
- Recording: `take.startTick = tick_at(record_start_frame) − (input + output latency)`, unless
  the caller passes `latencyCompensationSeconds`, which is the user-calibrated value from
  Studio's settings. The value used is returned on `RecordedTake.latencyCompensationSeconds`,
  as the contract requires.
- Live MIDI → sound: `midir` callbacks enqueue `NoteOn` commands immediately. The RT thread
  starts the voice at the next block boundary, which is the lowest possible software latency.

### 2.7 `midir`-based `MidiAccessPort`

`MidiAccessPort` (`packages/midi-core/src/port.ts`) only moves bytes. All parsing and mapping
stay in TypeScript (`midi-core`), so behaviour is identical across hosts.

- Rust `MidiService`:
  - `midir::MidiInput`/`MidiOutput` enumerate ports. Ids are stable for the session:
    `in:<index>:<name-hash>`.
  - A watcher thread polls the port lists about once a second, because `midir` has no hotplug
    events, and emits `ports_changed` with the full list.
  - Each connected input forwards `(port_id, bytes, timestamp)` over the `midi_input` channel.
  - `midi_send(port, bytes, ts_ms)` schedules output on a small timer thread when `ts_ms` is in
    the future.
- **SysEx policy matches Electron.** The backend drops incoming `0xF0` messages and refuses to
  send them unless a future explicit `sysex: true` grant is given. `requestAccess({ sysex })`
  returns `denied` for SysEx.
- TS `TauriMidiAccessPort implements MidiAccessPort`:
  - `supported = true`;
  - `requestAccess` calls `midi_list` and subscribes to the channels;
  - `listPorts` returns a cached list, and `onPortsChanged`/`onMessage` fan out channel
    messages (bytes as `Uint8Array`, `timestampMs` mapped per §2.5);
  - `send` calls `midi_send`.
- `tauri-plugin-midi` (Web-MIDI polyfill) is an alternative. It has low adoption, so evaluate
  it before depending on it (platform-compatibility §6.2).

### 2.8 TypeScript adapter: the React UI stays unchanged

A new class-B package, `@studio/platform-tauri`, mirrors `platform-browser`:

```ts
export function createTauriPlatform(options: TauriPlatformOptions = {}): PlatformServices {
  const browser = createBrowserPlatform({ hostKind: 'tauri' }); // storage, hasher, decoder…
  return {
    ...browser,
    audioBackendFactory: createTauriAudioBackendFactory(), // AudioEngine over commands/channels
    midiAccess: createTauriMidiAccessPort(), // midir bridge
    fileDialogs: createTauriFileDialogs(), // @tauri-apps/plugin-dialog + plugin-fs
    permissions: createTauriPermissions(), // mic via OS prompt; midi always 'granted'
  };
}
// apps/tauri-host/src/main.tsx
<Studio platform={createTauriPlatform()} />;
```

- `TauriAudioEngine implements AudioEngine`. Every method is already async-capable by contract.
  - `readMeters()` and `getTransportPosition()` stay synchronous. They return the latest
    channel values and the clock extrapolation.
  - `subscribe()` fans out Tauri events as `AudioEngineEvent`s.
  - `render()` converts the binary response into `PcmAudio` views.
- Studio's session layer already talks only to `PlatformServices` and `AudioEngine`. No React
  component, store or feature changes.
- Portability is guarded by the shared contract suites (`*.contract.test.ts`). They run against
  the Web engine today and would run against `TauriAudioEngine` with a mock IPC transport in
  CI, and against the real backend in a Tauri-driver E2E job.
- Rollout follows the migration map's status ladder: start with `fixtures`, move to
  `rust-parity` once the Rust engine passes render-parity fixtures (offline render ≡
  playback), and only then make it `rust-default` for the Tauri host.

### 2.9 Tauri security posture (parity with Electron)

- Capabilities and permissions (Tauri 2 ACL) allow only Studio's commands and the dialog/fs
  plugin scopes needed for user-chosen files. There is no shell or HTTP plugin.
- The CSP is the same as §1.4 and is set in `tauri.conf.json`. The `ipc:` and asset-protocol
  sources are added there.
- Commands validate arguments with the same rules as `src/main/validation.ts`: sizes, names,
  accept lists. This is ported to Rust (`studio_host::validate`), with the same test vectors.
