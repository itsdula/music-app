# DJ.Studio teardown: lessons for the Electron host

- **Date:** 2026-10-31
- **Target:** DJ.Studio 4.2.15 for macOS (`/Applications/DJ.Studio.app`, `dj.studio.app`, arm64)
- **Status:** research input. Nothing here is production code, and no DJ.Studio code is copied
  into this repo. It is a reference for design decisions only.

**How the evidence was gathered.** The app bundle was inspected read-only. `app.asar` was
extracted with `@electron/asar` and the bundled web app (`Resources/public/download/webapp.zip`)
was unzipped into a scratch folder. Findings come from the minified bundles, so names such as
`synthEngine.js` or `DJStudioSynthEngine` are the shipped ones but internal structure is inferred.
The web UI was served locally in a browser, but every studio route needs a DJ.Studio account,
so the UI was **not** exercised. Anything marked **UNVERIFIED** is inference that should be
checked before relying on it.

---

## 1. Stack at a glance

| Layer          | What ships                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shell          | Electron 41.10.5 (Chromium 146), Squirrel auto-update, `bootstrap.js` → webpack `main.js` (~4 MB), `preload.js` (~400 KB)                                     |
| UI             | Separate React 19 + Vite web app, the same one served at `app.dj.studio`, shipped as a 35 MB zip and served from a versioned cache via a custom protocol       |
| Audio output   | `synthEngine.js` in an Electron **utility process**; it owns device selection and output latency and hosts native effects                                     |
| Native addons  | Nine `@appmachine/*` N-API addons: `ai-stems`, `ai-beatgrid`, `audio-stretcher`, `audio-decoder`, `internaleffects`, `shared-memory`, plus library integrations |
| ML / codecs    | libtorch + libomp, onnxruntime 1.24, ffmpeg 8 libraries (`libav*`), LAME, Vorbis, in `Contents/Frameworks`                                                     |
| In-browser DSP | Rubber Band and Essentia (WASM), ffmpeg.wasm demuxer, FLAC/MP3 encoders in workers                                                                           |
| Visuals        | butterchurn (Milkdrop) and Shadertoy-style shaders on WebGL2 / `OffscreenCanvas`                                                                              |
| Storage        | `better-sqlite3-multiple-ciphers` (encrypted SQLite) in main, IndexedDB in the page                                                                          |
| Size           | 712 MB installed, dominated by the ML runtimes                                                                                                                |

The bridge is wide: six `contextBridge` objects (`electron`, `databaseChannel`,
`fileSystemChannel`, `dialogAPI`, `stemSeparationChannel`, `performanceMonitorChannel`) and
about 340 distinct IPC channel names. Ours is one frozen `studioHost` object with five validated
channels ([hosts.md §1.6](../hosts.md)).

---

## 2. Patterns and how they map to us

Each row says what DJ.Studio does, where we stand today, and a verdict.

| #   | DJ.Studio pattern                                                                                    | Our state                                                                                                      | Verdict                                       |
| --- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Audio engine in a utility process, restarted on crash, UI told via `synth-engine-crashed`           | Web Audio engine in the renderer; native engine designed for Tauri only ([audio-engine.md §12](../audio-engine.md)) | **Adopt** for a native Electron engine        |
| 2   | Renderer → worklet PCM by `postMessage` copies, 512–4096-frame chunks                                | `studio://` now sends COOP + COEP, so `SharedArrayBuffer` is available (smoke-tested)   | **Avoid their transport; isolation fixed** |
| 3   | Streaming media protocol (`stream: true`, `Accept-Ranges`, `206`) for local audio files              | `openFiles` copies whole files (≤ 2 GiB) through IPC                                                            | **Adopt**                                     |
| 4   | Heavy analysis (stems, beatgrid, decoding, effects scanning) in native addons off the UI thread      | Vocal DSP in inline Web Workers; Rust ports planned ([rust-migration-map.md](../rust-migration-map.md))        | **Already aligned**; pick ONNX, not libtorch |
| 5   | UI downloaded as a versioned bundle and served from cache, bundled zip as fallback                  | `studio://app/` serves `dist/renderer` from the app bundle                                                     | **Consider later**, only with signing         |
| 6   | Plugin scanner in its own utility process with auto-restart                                          | No third-party plugin hosting                                                                                  | **Adopt if** we ever host AU/VST/CLAP         |
| 7   | Worker PID registry, per-process Sentry tags                                                         | `dev-monitor` app and dev telemetry ([dev-monitor.md](../dev-monitor.md))                                      | **Borrow the idea** for dev-monitor           |
| 8   | Some windows with `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`; ~340 channels | Sandbox and isolation on every `WebContents`; sender check plus argument validation per channel               | **Avoid**; keep our posture                   |

### 2.1 Audio engine in a utility process (adopt)

`main.js` forks `synthEngine.js` with `utilityProcess.fork(..., { serviceName: 'DJStudioSynthEngine' })`.
That process loads the `internaleffects` addon, owns the output device
(`getOutputDevices`, `setOutputDevice`, `getOutputLatencyInSeconds`) and reports back over
`process.parentPort`. If it exits while the app is not quitting, main sends
`synth-engine-crashed` to the renderer, which can reinitialise it.

Why it matters to us. [audio-engine.md §12](../audio-engine.md) already defines a native
backend contract (JSON commands, `AudioEngineEvent` events, clock publication at ≥ 30 Hz, PCM by
shared memory or transfer). It is written for Tauri, but nothing in it is Tauri-specific. An
Electron utility process running the same Rust engine through `napi-rs` would satisfy the same
contract and give us:

- device selection and exact output latency, which Web Audio does not expose reliably;
- a glitch-proof audio thread that is not starved by React rendering or GC in the renderer;
- crash isolation: a DSP crash restarts the engine, not the window.

Suggested additions to the contract, learned from their flow:

- a lifecycle state such as `crashed` / `restarting` in `AudioEngineEvent`, so the UI can show
  the loss and replay `loadProject` + `applyChanges` after restart;
- no restart while the app quits or the OS session ends (they special-case both);
- a dev-only `--inspect` port on the engine process (they pass `--inspect=9230` outside
  production).

### 2.2 PCM transport: do better than DJ.Studio (avoid, then fix ours)

Their renderer feeds a single `audio-output` AudioWorkletProcessor by posting `Float32Array`
chunks; the processor queues them in a JS array. In `synthEngine.js` the chunk size grows with
the buffer count (up to 12 → 512 frames, 24 → 1024, 48 → 2048, more → 4096), which trades
latency for stability. The source
comments in `worklet/audio-worklet.js` say they rejected `SharedArrayBuffer` because it was
"supported almost nowhere". That is no longer true in Chromium 146.

What we should do instead:

1. **Enable cross-origin isolation on `studio://app`.** Done: `policy.ts` now sends
   `Cross-Origin-Embedder-Policy: require-corp` next to COOP. Both smoke modes assert
   `crossOriginIsolated === true` and `SharedArrayBuffer`, and the probe confirms blob-URL
   workers and AudioWorklet modules still load. `platform-browser/src/device-info.ts` already
   reports the capability.
2. With SAB available, use a lock-free SPSC ring (`Atomics`) between worker/engine and worklet
   for any streamed audio, and keep `postMessage` for control only.
3. With a native engine (§2.1), audio never crosses into the renderer at all; only meters and
   transport positions do, matching [hosts.md §2.4–2.5](../hosts.md).

### 2.3 A streaming media protocol (adopt)

They register a privileged `djstudio-media` scheme with `stream: true`. Its handler accepts
`GET`/`HEAD` only, resolves a path through an allow-check (`403` otherwise), and honours `Range`
with `Accept-Ranges: bytes`. A second scheme serves `library`, `integration` and `waveform`
resources through a five-request concurrency queue.

For us this would replace whole-file copies in `openFiles` for large media:

- main issues an opaque, per-session token for each file the user picked in a dialog
  (`studio-media://file/<token>`); no raw paths ever reach the page;
- the handler streams with `Range` support, so `<audio>`, `fetch()` and decoders read on
  demand;
- keep our existing rules: sender/origin check, traversal guard, `GET`/`HEAD` only, CSP update
  for `media-src` and `connect-src`.

Note that their schemes set `bypassCSP: true`. We should not; adding the scheme to the CSP is
enough.

### 2.4 Heavy analysis off the UI thread (already aligned)

Stem separation, beat grids, time-stretching and decoding all run in native addons, called from
dedicated workers (`stemSeparationWorker.js`, `beatgridWorker.js`, `audioDecoderWorker.js`).
This is the same direction as our ports in [rust-migration-map.md](../rust-migration-map.md).

One cost to avoid: they ship both **libtorch and onnxruntime**, which is most of the 712 MB.
If we add ML features (stems, beat/key detection, pitch), standardise on ONNX Runtime alone,
with the WebGPU/WASM execution providers in the browser hosts and the native one in desktop
hosts, behind one port.

### 2.5 Over-the-air UI bundles (consider later, with signing)

On first run main unzips the bundled `webapp.zip` into `<userData>/…/<version>` and serves it
through a privileged scheme. Newer versions are fetched from an offline-deployment API and
swapped in, so UI fixes ship without a new signed app.

Our `studio://app/` handler could serve from a versioned folder the same way. It is only safe
if every downloaded bundle is **signature-checked** against a key pinned in the app before
being served. I found no hash or signature check next to their download code (there are
unrelated `verifySignature` references that I did not trace). An unsigned UI bundle served from a
privileged origin would bypass macOS code signing for everything the page can do. Defer until we
need faster UI releases than app releases.

### 2.6 Out-of-process plugin scanning (adopt if we host plugins)

`Effects_Scanner` runs in its own utility process and is restarted on a non-zero exit. Third-party
plugins crash scanners often, so this is the right shape if we ever add AU/VST3/CLAP hosting.
Pair it with a blocklist of plugins that crashed the scan.

### 2.7 Process registry for diagnostics (borrow)

Workers report their PID (`register-worker-pid`), and every utility process gets a Sentry tag
via a proxy around `utilityProcess.fork`. Our dev monitor could show the same: one row per
engine, analysis and scanner process, with PID, memory and restart count.

### 2.8 Security posture: keep ours

Things not to copy:

- several `BrowserWindow`s with `nodeIntegration: true`, `contextIsolation: false` or
  `sandbox: false` (counted in `main.js`; which windows use them is **UNVERIFIED**);
- a bridge of ~340 channels spread over six exposed objects;
- `bypassCSP: true` on custom schemes;
- an unsigned OTA UI bundle (§2.5).

Our model in [hosts.md §1.3–1.6](../hosts.md) should stay as it is: sandbox on every
`WebContents`, one frozen bridge, and per-channel sender checks plus pure, tested validation.

---

## 3. Product ideas worth noting

These are not architecture, but they are what the stack enables:

- automatic stems and beat grids on import, cached per asset;
- timeline-first mix editing with tempo/key-matched transitions (Rubber Band + Essentia);
- music-reactive visuals (butterchurn, shaders) rendered on `OffscreenCanvas` and exported with
  the mix;
- library import from other DJ apps (rekordbox, Serato, Engine DJ, djay) and streaming catalogs.

---

## 4. Suggested next steps

In order of value for effort:

1. ~~Add `Cross-Origin-Embedder-Policy: require-corp` to `studio://app` responses and a smoke
   assertion for `crossOriginIsolated` (§2.2).~~ Done.
2. Design the `studio-media://` streaming scheme with tokenised file handles (§2.3).
3. Extend the native backend contract with crash/restart lifecycle events, and prototype it in an
   Electron utility process (§2.1).
4. Record an ADR choosing ONNX Runtime as the single ML runtime before any ML feature lands (§2.4).
