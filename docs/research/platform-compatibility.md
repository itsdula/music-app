# Platform capability & toolchain compatibility report

- **Agent:** research-platform
- **Date:** 2026-10-29
- **Status:** research input for freezing configuration. Nothing in this document is production code.

**How to read the evidence.** `[S#]` refers to a source in §8. `[X#]` refers to an experiment I ran in a throwaway scratch folder (listed in §8.2). Anything marked **UNVERIFIED** comes from secondary sources or inference, and should be checked before the team relies on it.

**Browser compat baseline.** Browser support versions come from `@mdn/browser-compat-data` 8.1.7 (timestamp 2026-10-22) [S1] and `web-features` 3.44.0 [S2], queried locally.

**Network limits on this session.** WebFetch could not reach tailwindcss.com, developer.chrome.com or developer.mozilla.org. Facts from those sites come from search-result summaries and are cited by URL. Where possible they are backed by local experiments or by docs shipped inside npm packages: Next.js ships `next/dist/docs`, Turborepo ships `turbo/docs`, and Electron ships `electron.d.ts`.

---

## 1. Summary of decision-relevant findings

### Version compatibility (most important)

1. **The pinned set is installable and works together.** I verified this with installs, builds and lint/test runs [X1–X10].
   - `typescript@6.0.3` satisfies `typescript-eslint@8.72.1`'s peer range `>=4.8.4 <6.1.0`. Typed linting runs on TS 6 with no "unsupported TypeScript version" warning [X10].
   - `dependency-cruiser@18.7.0` accepts `typescript >=2.0.0 <7.0.0`, so the TS 7 ceiling is enforced in two places [X8].
2. **Peer warnings: ESLint 10 vs `eslint-config-next@16.4.3`.**
   - The config's transitive plugins declare ESLint peers that stop at v9: `eslint-plugin-react@7.37.5` (`^9.7`), `eslint-plugin-import@2.32.0` (`^9`) and `eslint-plugin-jsx-a11y@6.10.2` (`^9`). pnpm prints "unmet peer" warnings [X1].
   - **It works at runtime anyway.** `eslint-config-next` ships its own `fixupPluginRules` shim (`dist/rule-context.js`). Rules from all three plugins fired correctly under ESLint 10.13.0 [X1].
   - The Next 16 upgrade guide confirms that "`eslint-config-next@16.4.0` or later supports ESLint 10" [S20].
   - **Action:** silence the warnings with `pnpm.peerDependencyRules.allowedVersions`. Do not downgrade ESLint.
3. **`@playwright/test` mismatch in the repo.** The root `package.json` pins `@playwright/test` **1.63.0**, but the brief says 1.64.1. Align them.
   - Playwright 1.64.1 expects Chrome for Testing 156 (`chromium v1248`).
   - Its browser download (`cdn.playwright.dev`) is blocked in this sandbox. I ran the headless experiments against the pre-installed Chromium 153 build (`/opt/pw-browsers/*-1243`) via `executablePath`.
4. **`@types/node` 26.6.6 vs a Node 22.22.0 runtime.** The root `package.json` pins `@types/node` 26.6.6. Those typings describe APIs that do not exist on Node 22.
   - **Recommendation:** use `@types/node@22.x` (latest is 22.20.5). It satisfies both Vite's peer (`^20.19.0 || >=22.12.0`) and Vitest's (`^22.0.0 || >=24.0.0`).
5. **TS 6.0 defaults bite** [X2]. Each item was checked by running `tsc` 6.0.3:
   - `strict` now defaults to `true`.
   - `types` now defaults to `[]`, so globals from `@types/*` are no longer auto-included. `"types": ["*"]` restores the old behaviour.
   - These are now **errors** (TS5101/TS5107) unless you set `"ignoreDeprecations": "6.0"`: `baseUrl`, `moduleResolution: node`/`node10`/`classic`, `esModuleInterop: false`, `allowSyntheticDefaultImports: false`, `target: ES5`, `module: amd`/`system`, `outFile`, `downlevelIteration`, `alwaysStrict: false`.
   - The repo's `tsconfig.base.json` already avoids all of these.
6. **Next 16 rewrites `tsconfig.json` on build** [X3]. It forces `esModuleInterop: true` and `resolveJsonModule: true`, and adds `allowJs`, `incremental`, `plugins: [{name:"next"}]` and `.next/types` includes.
   - It also **requires `@types/node` installed in the app**, even with `types: []`. Without it, `next build` tries to `npm install @types/node`, which fails under pnpm.
   - The app's `tsconfig.json` must keep the Next additions, and should `extends` the base.
7. **Next 16 build facts** [S20]:
   - **Turbopack is the default** for both `next dev` and `next build`. A custom `webpack` config makes `next build` fail unless you pass `--webpack`.
   - `next lint` is **removed**, and `next build` no longer lints.
   - The minimum Node version is 20.9, and the minimum TypeScript is 5.1.
8. **Vitest 5** [X7]:
   - `test.workspace` throws "removed in Vitest 4, migrate to `test.projects`".
   - Browser mode needs a provider *object* from `@vitest/browser-playwright` (`provider: playwright()`). A string provider errors.
   - Engine requirement is `node ^22.12.0 || ^24 || >=26`, so Node 22.22.0 is fine.
9. **Vite 8 / `@vitejs/plugin-react` 6.** No Babel; React Refresh runs on Oxc. `react({ babel })` is gone. The React Compiler is opt-in via `@rolldown/plugin-babel` + `reactCompilerPreset` or `oxc-transform-react` [S29].
   - A Vite 8.3.5 build with `@tailwindcss/vite@4.3.3` (peer `vite ^5.2 || ^6 || ^7 || ^8`) worked [X5].

### Worker and worklet bundling

10. **One strategy works everywhere: pre-bundle worklet code to a string and load it from a Blob URL.**
    - **Turbopack** compiles `new Worker(new URL('./x.ts', import.meta.url), {type:'module'})` correctly [X3].
    - **The trap:** a bare `new URL('./proc.worklet.ts', import.meta.url)` passed to `audioWorklet.addModule` is copied **as a raw `.ts` asset**. It fails with "MIME type mismatch" [X3].
    - Vite needs `?worker&url` for the same case [X5]. That syntax is not portable to Next.
    - **Recommendation:** use esbuild 0.28 to pre-bundle each worklet (and, for uniformity, each worker) into a generated TS module that exports the code string. Load it via a Blob URL. Details in §5.

### Browser capabilities

11. **Web MIDI.**
    - **Chromium only:** Chrome, Edge and Opera, desktop and Android, plus Electron and WebView2.
    - **Firefox** (108+) gates it behind a generated *site-permission add-on* install prompt, and `statechange` **never fires** there [S1][S9].
    - **Safari has no Web MIDI** on macOS or iOS, so neither do Tauri-macOS (WKWebView) or Tauri-Linux (WebKitGTK).
    - **Chrome 124+ prompts for all MIDI**, not only SysEx [S3][S4].
    - `navigator.permissions.query({name:'midi', sysex})` works in Chrome and Firefox 110+. In headless Chromium without a grant it returned `prompt`, then `requestMIDIAccess()` rejected with `NotAllowedError` [X4].
12. **SharedArrayBuffer requires cross-origin isolation (COOP + COEP) in every browser.**
    - Without it, `SharedArrayBuffer` is `undefined`, including inside the AudioWorklet scope [X4].
    - In Next.js, set the headers on `/studio` only. **Entering `/studio` must be a full document navigation** (`<a href>`, not `<Link>`), because isolation is decided per document. This follows from how COOP works; I did not test it in Next.
    - `COEP: credentialless` is not supported in Safari [S1].
    - **Recommendation:** design the engine to work without SAB (transferable `postMessage`). Enable a SAB ring buffer only when `crossOriginIsolated` is true.
13. **Recording.** AudioWorklet capture gives sample-accurate float PCM. MediaRecorder gives compressed, container-wrapped audio with no frame-accurate start, so it is unsuitable as the primary DAW recorder.
    - Constraint support differs. `channelCount` is honoured only in Chromium. `autoGainControl` and `noiseSuppression` are not supported in Safari [S1].

### Headless testing

14. **Web Audio is fully testable in headless Chromium** [X4]:
    - AudioContext runs without a gesture under headless.
    - AudioWorklet loads from a Blob URL.
    - OfflineAudioContext renders with a worklet.
    - `decodeAudioData` decodes WAV, MP3, AAC, Vorbis, Opus and FLAC.
    - `getUserMedia` works with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=x.wav`, and honours `echoCancellation`/`noiseSuppression`/`autoGainControl: false` and `channelCount: 2`.
15. **Web MIDI is not usable in headless Linux Chromium without an ALSA sequencer.** `requestMIDIAccess` rejects with `InvalidStateError: Platform dependent initialization failed`, even with permission granted [X4].
    - Inject a fake `MIDIAccess` (`page.addInitScript`), or test against the platform-contracts MIDI port with an in-memory adapter.
16. **`node-web-audio-api@2.2.0`** (BSD-3-Clause, Rust/napi, Node ≥22) is viable for Node-side DSP integration tests [X9]. OfflineAudioContext and AudioWorklet (`addModule` from a file path) both work.
    - Decoding works for WAV, FLAC, MP3 and Vorbis. My ffmpeg-made AAC/M4A and Ogg-Opus files failed.

---

## 2. Capability matrix

**Legend**
- ✅ supported
- ⚠️ partial or caveated
- ❌ not supported
- ❓ unverified

**Where the columns come from**
- Chrome, Edge, Firefox and Safari versions are from [S1] unless noted.
- Electron 45 = Chromium 156.0.8078.48, Node 24.22.0 [S35].
- Tauri-Windows = WebView2 (evergreen Chromium); Tauri-macOS = WKWebView (Safari's WebKit, tied to the OS version); Tauri-Linux = WebKitGTK 4.1 [S39].

| Capability | Chrome | Edge | Firefox | Safari (macOS / iOS) | Electron 45 | Tauri-Windows | Tauri-macOS | Tauri-Linux | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Web MIDI `requestMIDIAccess` | ✅ 43; prompt for **all** MIDI since 124 [S3] | ✅ 79 | ⚠️ 108, only via site-permission add-on prompt [S1][S7][S10] | ❌ / ❌ [S1][S5] | ✅ (grant `midi`/`midiSysex` in session handlers) [S36] | ✅ API present (Chromium) ❓ prompt behaviour; WebView2 has a SysEx permission kind [S44] | ❌ | ❌ | Opera 30, Android Chrome 43. Baseline: no [S2]. Secure context required everywhere [S1]. Permissions-Policy `midi` in Chromium 88 [S1]. |
| `permissions.query({name:'midi', sysex})` | ✅ 43 | ✅ 79 | ✅ 110 [S1] | ❌ | ✅ | ✅ ❓ | ❌ | ❌ | Headless Chromium returns `granted`/`prompt` as expected [X4]. |
| MIDI hotplug `statechange` | ✅ | ✅ | ⚠️ handler exists but **never fires** (bug 1802149) [S1][S9] | ❌ | ✅ | ✅ | ❌ | ❌ | On Firefox, poll `inputs`/`outputs` as a fallback. |
| `MIDIOutput.send(data, timestamp)` | ✅ 43 | ✅ 79 | ✅ 108 | ❌ | ✅ | ✅ | ❌ | ❌ | Timestamp is on the `performance.now()` clock. I did not test scheduling accuracy (no MIDI device in CI) ❓. |
| AudioWorklet | ✅ 66 | ✅ 79 | ✅ 76 | ✅ 14.1 / 14.5 | ✅ | ✅ | ✅ (WebKit ≥ Safari 14.1 era) | ❓ WebKitGTK/GStreamer dependent [S46] | Baseline widely available since 2023-10 [S2]. Blob-URL `addModule` verified in Chromium [X4]. |
| OfflineAudioContext | ✅ 35 | ✅ | ✅ 25 | ✅ 14.1 unprefixed | ✅ | ✅ | ✅ | ✅ ❓ | Chromium accepted sample rates 3000–768000 and lengths up to 2³¹−1 frames at construction [X4]; RAM is the real limit (2 ch × 48 kHz × 1 h float32 ≈ 1.4 GB). Spec floor is 8000–96000 [S1]. Older Safari reportedly rejected rates < 44100 ❓. Plan for ≤ 96 kHz. |
| `baseLatency` | ✅ 58 | ✅ 79 | ✅ 70 | ✅ 14.1 | ✅ | ✅ | ✅ | ❓ | Chromium headless: interactive 0.01 s, playback 0.023 s, hint 0.2 → 0.186 s [X4]. |
| `outputLatency` | ✅ 102 | ✅ 102 | ✅ 70 | ✅ 18.4 | ✅ | ✅ | ⚠️ needs macOS with Safari 18.4-level WebKit | ❓ | Was 0 headless (no real device) [X4]. |
| `latencyHint` option | ✅ 58 | ✅ 79 | ❌ per BCD (ignored) | ✅ 14.1 | ✅ | ✅ | ✅ | ❓ | Use `'interactive'` for live, `'playback'` for mixdown preview. |
| `AudioContext.setSinkId` / `sinkId` option | ✅ 110 | ✅ 110 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | `HTMLMediaElement.setSinkId` is wider (FF 116, Safari 18.4) [S1]. Firefox has `selectAudioOutput` [S1]. |
| gUM `echoCancellation:false` | ✅ 59 | ✅ | ✅ 50 | ✅ 11 | ✅ | ✅ | ✅ (needs mic entitlement / Info.plist) ❓ | ❓ | Verified honoured in headless Chromium [X4]. |
| gUM `noiseSuppression` / `autoGainControl:false` | ✅ 67 | ✅ | ✅ 55 | ❌ (no constraint) | ✅ | ✅ | ❌ | ❓ | On Safari, read `track.getSettings()` and warn the user. |
| gUM `channelCount` | ✅ 59 | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❓ | Stereo capture is Chromium-only by constraint. |
| gUM `latency` | ✅ 59 | ✅ | ✅ 50 | ❌ | ✅ | ✅ | ❌ | ❓ | Treat as a hint. |
| gUM `sampleRate` | ✅ 59 | ✅ | ❌ | ✅ 11 | ✅ | ✅ | ✅ | ❓ | Resample in-engine; don't rely on it. |
| MediaRecorder | ✅ 47 | ✅ 79 | ✅ 25 | ✅ 14.1 / 14 | ✅ | ✅ | ✅ | ❓ | Chromium 153: `audio/webm;codecs=opus` ✅, `audio/webm;codecs=pcm` ✅, `audio/mp4` ✅, ogg ❌, wav ❌ [X4]. |
| SharedArrayBuffer | ⚠️ needs COI | ⚠️ COI | ⚠️ COI (79) | ⚠️ COI (15.2) | ⚠️ COI via protocol headers ❓ | ⚠️ COI ❓ | ⚠️ COI ❓ | ❓ | `crossOriginIsolated`: Chrome 87, FF 72, Safari 15.2 [S1]. Verified undefined without COI, present with it [X4]. |
| COEP `credentialless` | ✅ 96 | ✅ 96 | ✅ 119 | ❌ | ✅ | ✅ | ❌ | ❓ | With `require-corp`, every cross-origin subresource needs CORP/CORS. |
| AudioWorkletNode `processorOptions` | ✅ structured clone | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | Verified: nested objects, typed arrays and a SAB (under COI) arrive in the processor [X4]. No transfer list. Pass a `MessagePort`/SAB for bulk data. |
| IndexedDB | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Baseline widely available [S2]. |
| Blob values in IndexedDB | ✅ | ✅ | ✅ | ⚠️ history of bugs: iOS 18.4 network-process crash reading blobs (WebKit 292142), corruption (240216), private-mode failures fixed in 17.4 (268037) [S14–S16] | ✅ | ✅ | ⚠️ as Safari | ❓ | Mitigation: store PCM as `ArrayBuffer` chunks rather than `Blob`, or keep audio in OPFS. |
| `storage.persist()` | ✅ 55 | ✅ 79 | ✅ 57 | ✅ 15.2 | ✅ | ✅ | ✅ | ❓ | Headless Chromium: `persisted()` false until granted [X4]. |
| `storage.estimate()` | ✅ 61 | ✅ | ✅ 57 | ✅ 17 | ✅ | ✅ | ✅ | ❓ | Quotas: Chromium origin ≤ 60% of disk [S11][S13]; WebKit origin ≤ 60% for browser apps, **15% for other apps (i.e. WKWebView hosts)** [S12]. Headless reported 3–4 GiB [X4]. |
| File System Access pickers | ✅ 86 | ✅ 86 | ❌ | ❌ | ✅ (or native dialogs) | ✅ (prefer Tauri dialog plugin) | ❌ | ❌ | Android Chrome 132 [S1]. Fallback: `<input type=file>` + download via `<a download>`. Baseline: no [S2]. |
| OPFS `getDirectory` | ✅ 86 | ✅ | ✅ 111 | ✅ 15.2 | ✅ | ✅ | ✅ | ❓ | `createWritable` Safari 26; `createSyncAccessHandle` Safari 15.2 (worker-only) [S1]. |
| decodeAudioData: WAV/MP3/AAC/FLAC | ✅ (all verified) [X4] | ✅ | ✅ WAV/MP3/FLAC; AAC via OS ❓ | ✅ WAV/MP3/AAC/FLAC ❓ | ✅ ❓ (Electron ffmpeg codec set) | ✅ | ✅ | ⚠️ depends on installed GStreamer plugins ❓ | Feature-detect by trying to decode, not with `canPlayType()` [S19]. |
| decodeAudioData: Ogg Vorbis / Opus | ✅ (verified) [X4] | ✅ | ✅ | ⚠️ claimed Safari 18.4+ [S17]; reports of incomplete support [S18]; WebM-Opus multichannel bug [S19] | ✅ | ✅ | ⚠️ | ⚠️ GStreamer | Ship a WASM decoder fallback if Ogg/Opus import matters on Safari. |
| Autoplay / resume() | needs user gesture | same | same (configurable) | same, stricter on iOS | can disable via `autoplayPolicy` ❓ | WebView2 default ❓ | WKWebView config ❓ | ❓ | Always create or resume the AudioContext inside a click/keydown handler. Headless Chromium does not enforce this: state was `running` with no gesture [X4], so gesture-gating needs a unit test with a mocked context. |

---

## 3. Toolchain compatibility

Peers and engines come from `npm view` [S0]. "Verified" means it was exercised in an experiment.

| Package | Version | Compatible? | Evidence / notes | Config implications |
|---|---|---|---|---|
| node | 22.22.0 | ✅ | Satisfies every engine: vite `^20.19 \|\| >=22.12`, vitest `^22.12 \|\| ^24 \|\| >=26`, eslint `^20.19 \|\| ^22.13 \|\| >=24`, dependency-cruiser `^22\|\|^24\|\|>=26`, electron install `>=22.12`, next `>=20.9` | Keep `engines.node >=22.13` (eslint needs 22.13). |
| pnpm | 10.28.0 | ✅ | — | Build-script allow-list needed for `esbuild`, `electron` (binary download) and `unrs-resolver` (from eslint-import-resolver-typescript; worked without its build script [X1]). |
| next | 16.4.3 | ✅ | peer `react ^18.2 \|\| ^19`; Turbopack default [S20]; built with TS 6 [X3] | No `webpack` key. Put `turbopack` at the top level. `@types/node` must be resolvable from the app. |
| react / react-dom | 19.3.1 | ✅ | next, zustand (`>=18`), radix-ui (`^19`) and lucide-react (`^19`) all accept it | `@types/react`/`@types/react-dom` 19.3.0. |
| typescript | 6.0.3 | ✅ | typescript-eslint `<6.1.0` ✅ [X10]; dependency-cruiser `<7.0.0` ✅ [X8]; Next 16 min 5.1 ✅ [S20][X3]; Vite/Vitest transpile with Oxc (no TS peer) [X5][X7] | `types` default `[]`; `strict` default `true`; deprecations are hard errors (§1.5). Do **not** upgrade to TS 7 until typescript-eslint and dependency-cruiser widen their ranges [S27]. |
| tailwindcss + @tailwindcss/postcss/cli/vite | 4.3.3 | ✅ | `@tailwindcss/vite` peer includes vite 8; CLI build verified [X6]; Vite plugin verified [X5] | CSS-first config (§4.3). |
| turbo | 2.11.10 | ✅ | Schema task keys: `cache, dependsOn, description, env, inputs, interactive, interruptible, outputLogs, outputs, passThroughEnv, persistent, tags, with` [S33 schema] | Existing `turbo.json` is valid. JIT packages can't be cached separately [S33]. |
| vite | 8.3.5 | ✅ | Rolldown + Oxc; peer `esbuild ^0.27 \|\| ^0.28` (optional) | Use `build.rolldownOptions` (not `rollupOptions`); `manualChunks` must be a function [S28] ❓. |
| @vitejs/plugin-react | 6.1.2 | ✅ | peer `vite ^8`; no Babel [S29] | `react()` with no `babel` option. React Compiler via `@rolldown/plugin-babel` + `reactCompilerPreset` (optional). |
| vitest | 5.0.5 | ✅ | peer `vite ^6.4 \|\| ^7 \|\| ^8`, `@types/node ^22 \|\| >=24`; projects + browser verified [X7] | `test.projects`; `provider: playwright()`. Reportedly no longer searches **ancestor** dirs for config [S31] ❓: run from the root config. |
| @vitest/browser-playwright | 5.0.5 | ✅ | peer `playwright *` (non-optional) | Add `playwright` as a devDependency next to `@playwright/test`. |
| @playwright/test | 1.64.1 (repo has **1.63.0**) | ⚠️ align | Bundles Chrome for Testing 156 | Pin 1.64.1 everywhere; `playwright install chromium` in CI. |
| eslint | 10.13.0 | ✅ with warnings | Flat config only; eslintrc removed [S32] | `eslint.config.mjs`. |
| typescript-eslint | 8.72.1 | ✅ | peer `eslint ^8.57\|\|^9\|\|^10`, `typescript <6.1.0` | `projectService: true`. |
| eslint-plugin-react-hooks | 7.1.1 | ✅ | peer includes `^10`; exposes `configs.flat['recommended-latest']` (includes React Compiler rules such as `set-state-in-effect`) [X1] | — |
| eslint-config-next | 16.4.3 | ⚠️ peer warnings, works | Unmet peers on react/import/jsx-a11y plugins; runtime shim works [X1]; official ESLint 10 support from 16.4.0 [S20] | `peerDependencyRules.allowedVersions`. Scope to `apps/web/**` (verified, no plugin-redefinition clash) [X1]. |
| dependency-cruiser | 18.7.0 | ✅ | `--info`: typescript `>=2 <7` found 6.0.3 ✅; parses TS through the TS compiler, which must be resolvable from where depcruise is installed (root devDependency) [X8] | `tsConfig.fileName` + `tsPreCompilationDeps: true` for type-only imports. |
| zustand | 5.0.16 | ✅ | peer `react >=18` (immer optional) | — |
| dexie | 4.4.7 | ✅ | Blob round-trip under fake-indexeddb in Vitest verified [X7] | — |
| fake-indexeddb | 6.2.6 | ✅ | `import 'fake-indexeddb/auto'` [X7] | Use in `unit`/`integration` setup files. |
| zod | 4.6.7 | ✅ | no peers | — |
| radix-ui | 1.8.1 | ✅ | peer `react ^19` | — |
| lucide-react | 1.63.0 | ✅ | peer `react ^19` | — |
| esbuild | 0.28.2 | ✅ | Bundled a worklet to ESM/IIFE string [X3 follow-up] | Use for worklet/worker pre-bundling (§5). |
| electron | 45.1.0 | ✅ | Chromium 156, Node 24.22 [S35]; released 2026-10-27 | Main/preload can target Node 24 syntax. |
| fflate | 0.8.3 | ✅ | no peers | — |
| @types/node | 26.6.6 in repo | ⚠️ | Runtime is Node 22 | Prefer `@types/node@22.20.5`. |
| @types/audioworklet | 0.0.100 | ✅ | TS 6 typechecks a processor with `types:["audioworklet"]`, `lib:["ES2023"]` (no DOM) | Gotcha: with `noImplicitOverride`, do **not** write `override process()`, because the base class doesn't declare it (TS4113). |
| node-web-audio-api | 2.2.0 | ✅ (optional) | BSD-3-Clause, Node ≥22, prebuilt napi [X9] | Needs a pnpm build-script allow-list entry if it ships an install script ❓. |

---

## 4. Recommended configs

### 4.1 `tsconfig.base.json` (repo version is already TS 6-clean)

```jsonc
{
  "compilerOptions": {
    "target": "ES2023", "lib": ["ES2023"],
    "module": "ESNext", "moduleResolution": "Bundler", "moduleDetection": "force",
    "jsx": "react-jsx",
    "strict": true,                       // explicit even though TS 6 defaults it
    "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "verbatimModuleSyntax": true, "isolatedModules": true,
    "resolveJsonModule": true, "skipLibCheck": true, "noEmit": true,
    "types": []                           // TS 6 default; list per package
    // never: baseUrl, moduleResolution node/node10, esModuleInterop:false
  }
}
```

Per-package tsconfig files extend the base and add the following:

| Package kind | Add |
|---|---|
| DOM packages | `"lib": ["ES2023","DOM","DOM.Iterable"]` |
| Worklet sources | `"lib": ["ES2023"], "types": ["audioworklet"]` (separate tsconfig, excluded from the DOM project) |
| Workers | `"lib": ["ES2023","WebWorker"]` |
| Node tools | `"types": ["node"]` |

For path aliases, use `"paths": {"@studio/x": ["./packages/x/src/index.ts"]}` without `baseUrl`, or better, rely on workspace `exports`.

### 4.2 `apps/web/next.config.ts`

```ts
import type { NextConfig } from 'next';
const isolation = [
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
];
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Turbopack auto-transpiles workspace packages; listing them is harmless and
  // keeps `next build --webpack` working [S22].
  transpilePackages: ['@studio/studio-react', '@studio/ui' /* … */],
  async headers() {
    // Only if/when SAB is needed. Enter /studio by full navigation (<a href>).
    return [{ source: '/studio/:path*', headers: isolation }, { source: '/studio', headers: isolation }];
  },
};
export default nextConfig;
```

How to wire up `/studio`:
- `app/studio/page.tsx` stays a Server Component. It renders `StudioClient`, a file with `'use client'` that calls `dynamic(() => import('@studio/studio-react'), { ssr: false })`.
- `ssr:false` errors inside Server Components [S21]. This pattern was verified to build with `/studio` prerendered as static [X3].
- Workspace CSS: `import '@studio/studio-react/styles.css'` is allowed anywhere in the app [S24].
- Scripts: `"build": "next build"`, `"dev": "next dev"`, `"lint": "eslint ."` (no `next lint`).

### 4.3 Tailwind v4.3 (verified [X5][X6])

**Component package `packages/studio-react/src/styles.css`.** This uses no preflight, a prefix, and a scanned source:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme) prefix(st);
@import "tailwindcss/utilities.css" layer(utilities) prefix(st);
@source "./";                         /* scan this package */
@theme { --color-brand: oklch(0.7 0.2 250); }   /* use `@theme static` to always emit vars */
```

- Classes are written `st:p-4` and `st:hover:bg-brand`. The v4 prefix is variant-style with a colon. Emitted CSS variables are prefixed (`--st-color-…`) [X6].
- Unused theme variables are tree-shaken.
- **Standalone build:** `tailwindcss -i src/styles.css -o dist/styles.css --minify` (from `@tailwindcss/cli`). Export it as `"./styles.css"` in `package.json`.
- **Web app (`apps/web/app/globals.css`):** `@import "tailwindcss";` plus `@source "../../packages/*/src";` if the app also uses utilities directly. PostCSS goes through `@tailwindcss/postcss`.
- **Vite host:** use `@tailwindcss/vite`.

### 4.4 `eslint.config.mjs` (root; verified [X1])

```js
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
const scope = (cfgs, files) => cfgs.map((c) => ({ ...c, files }));
export default defineConfig([
  globalIgnores(['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/src/generated/**']),
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  reactHooks.configs.flat['recommended-latest'],
  ...scope([...nextVitals, ...nextTs], ['apps/web/**/*.{js,jsx,ts,tsx,mjs}']),
  { files: ['apps/web/**'], settings: { next: { rootDir: 'apps/web/' } } },
]);
```

Add this to the root `package.json` to silence the peer warnings:

```json
"pnpm": { "peerDependencyRules": { "allowedVersions": {
  "eslint-plugin-react>eslint": "10", "eslint-plugin-import>eslint": "10", "eslint-plugin-jsx-a11y>eslint": "10" } } }
```

**UNVERIFIED:** I did not test the exact `allowedVersions` selector syntax. An alternative is `"ignoreMissing"`, or a broad `"allowedVersions": {"eslint": "10"}`.

### 4.5 Vitest projects (root `vitest.config.ts`; verified shape [X7])

```ts
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
export default defineConfig({ test: { projects: [
  { test: { name: 'unit', include: ['packages/*/src/**/*.test.ts'], environment: 'node', setupFiles: ['fake-indexeddb/auto'] } },
  { extends: true, test: { name: 'react', include: ['packages/*/src/**/*.test.tsx'], environment: 'jsdom' } },
  { test: { name: 'browser', include: ['packages/*/src/**/*.browser.test.ts'],
      browser: { enabled: true, headless: true, provider: playwright({ launchOptions: { args: [
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } }),
        instances: [{ browser: 'chromium' }] } } },
] } });
```

Notes:
- `test.workspace` is removed.
- The `react` project needs `@vitejs/plugin-react` in `plugins`.
- `extends: true` inherits root plugins. **UNVERIFIED** for Vitest 5 semantics, but it is documented since v3.

### 4.6 Playwright (`playwright.config.ts`)

```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e',
  webServer: { command: 'pnpm --filter @studio/web start', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
  use: { baseURL: 'http://localhost:3000', permissions: ['microphone', 'midi', 'midi-sysex'] },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--use-file-for-fake-audio-capture=e2e/fixtures/sine-48k.wav',
    '--autoplay-policy=no-user-gesture-required' ] } } }],
});
```

- `localhost` counts as a secure context, so MIDI/gUM are allowed.
- The permission names `midi` and `midi-sysex` were accepted by Playwright 1.64.1 [X4].

### 4.7 Turborepo

The existing `turbo.json` is valid against the 2.11 schema. Suggestions:

- Add `"lint": {}` and `"test": { "dependsOn": ["^codegen", "codegen"], "outputs": ["coverage/**"] }`.
- Exclude `.next/cache/**` (already done). Add `"env": ["NEXT_PUBLIC_*"]` to `build`.
- Internal packages use the **JIT pattern** [S33]: `"exports": { ".": "./src/index.ts", "./styles.css": "./dist/styles.css" }` with no `build` script, except packages that must emit an artifact (the CSS file and generated worklet strings, which belong under `codegen`).
- Tradeoff: JIT packages can't be cached on their own, and type errors surface in consumers [S33].

### 4.8 dependency-cruiser (`.dependency-cruiser.cjs` excerpt)

```js
options: {
  tsConfig: { fileName: 'tsconfig.json' },   // a root solution tsconfig that includes apps/ & packages/
  tsPreCompilationDeps: true,                // see `import type` edges
  enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'types', 'default'], mainFields: ['module', 'main', 'types'] },
  combinedDependencies: false,
  doNotFollow: { path: 'node_modules' },
}
```

`typescript` must be a root devDependency, which it already is. dependency-cruiser resolves it from its own install location [X8].

---

## 5. Worker/worklet bundling recommendation

**Problem.** One engine package must load the same AudioWorklet processors and Web Workers under Next/Turbopack (and `--webpack`), Vite 8 and the Electron/Tauri renderers.

| Approach | Turbopack | webpack 5 | Vite 8 | Electron/Tauri | Verdict |
|---|---|---|---|---|---|
| `new Worker(new URL('./w.ts', import.meta.url), {type:'module'})` | ✅ compiled, emitted as `turbopack-worker-*.js` [X3] | ✅ (documented webpack 5 feature) ❓ not re-tested | ✅ [X5] | ✅ (whatever bundler built the renderer) | Fine for **workers** |
| `audioWorklet.addModule(new URL('./p.ts', import.meta.url))` | ❌ raw `.ts` copied to `static/media`, MIME mismatch [X3] | ❌/❓ asset module | ⚠️ needs `?worker&url` (non-portable) [X5] | inherits | **Reject** |
| **Pre-bundled string → Blob URL** | ✅ | ✅ | ✅ | ✅ | **Recommended** |
| Copy prebuilt `.js` to `public/` and load by absolute URL | ✅ | ✅ | ✅ | ⚠️ needs per-host path/asset protocol | Fallback only |

**Recommended design:**
1. Worklet (and worker) sources live in `packages/audio-web/src/worklets/*.ts`, typechecked with a separate tsconfig that uses `types:["audioworklet"]`.
2. A `codegen` task (already in `turbo.json`) runs **esbuild 0.28** for each entry: `bundle: true, format: 'esm', minify: true, target: 'es2022', write: false`. It writes `src/generated/<name>.worklet.ts` containing `export default "<code>";` plus a content hash.
3. At runtime:
   ```ts
   import code from './generated/mixer.worklet';
   const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
   try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
   ```
   This was verified for realtime and offline contexts in Chromium [X4]. Use the same pattern for workers: `new Worker(url, { type: 'module' })`.
4. Bundlers see only a string import, so behaviour is identical across Turbopack, webpack, Vite, Electron and Tauri, and HMR concerns disappear. Re-run codegen in `dev` with esbuild `watch`.
5. **CSP requirements.**
   - Worklet module fetches are governed by **`script-src`** [S47]. Blob-URL worklets therefore need `script-src 'self' blob:`.
   - Workers fall under `worker-src` (which falls back to `child-src` then `script-src`), so add `worker-src 'self' blob:`.
   - Electron: set the CSP via a response header in `protocol.handle` or a `<meta>`. Tauri: `app.security.csp` in `tauri.conf.json` ❓ (key name not verified for 2.12).
   - The risk of allowing `blob:` is limited when no untrusted script runs, which is the case for a local-first app.
   - If CSP must forbid `blob:`, use the `public/` copy fallback.
6. **Alternatives not chosen.**
   - `data:` URLs: same CSP issue, plus size limits.
   - Inline `?raw` imports: not portable to Turbopack without loaders.

---

## 6. Host notes

### 6.1 Electron 45 (Chromium 156, Node 24.22, V8 15.6) [S35]

**Security defaults.** Taken from Electron 45.1.0 `electron.d.ts` [S36]:
- `contextIsolation`: **true**
- `nodeIntegration`: **false**
- `sandbox`: **true** (since Electron 20)
- `webSecurity`: true

Keep all of them.

**Permissions.** By default Electron *approves all permission requests* unless a handler is installed [S37]. Install both handlers; the 45 typings list `'midi'`, `'midiSysex'` and `'media'` among the permission strings [S36].

```ts
const allowed = new Set(['midi', 'midiSysex', 'media', 'speaker-selection', 'persistent-storage']);
const trusted = (origin: string) => origin === 'app://studio';
session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => trusted(origin) && allowed.has(perm));
session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) =>
  cb(trusted(new URL(details.requestingUrl).origin) && allowed.has(perm)
     && (perm !== 'media' || (details as any).mediaTypes?.every((t: string) => t === 'audio'))));
```

**Origin.** Serve the renderer from a privileged custom scheme:

```ts
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
```

- `secure: true` makes it a secure context for Web MIDI and getUserMedia.
- `protocol.handle('app', …)` can add `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` and CSP headers, giving `crossOriginIsolated` for SAB. **UNVERIFIED** in Electron 45, so test `self.crossOriginIsolated`.

**Typed IPC.**
- The preload exposes a minimal, versioned API through `contextBridge.exposeInMainWorld('studioHost', api)` [S38]. Each method wraps `ipcRenderer.invoke(channel, payload)`.
- Never expose `ipcRenderer` itself.
- Share a `platform-contracts` type (`HostApi`) between preload and renderer, and validate payloads in main with **zod 4**.
- For PCM, send `ArrayBuffer`s (structured clone). Use a `MessageChannelMain` port for streams.

**AudioWorklet and Web MIDI** behave as in Chrome 156. **Native audio** (ASIO, CoreAudio low-latency) would need a native addon. Out of scope for now.

### 6.2 Tauri 2 (tauri 2.12.5, @tauri-apps/api 2.12.4)

**Webviews** [S39]:
- **Windows:** WebView2, evergreen Chromium.
- **macOS:** WKWebView, updated only with the OS.
- **Linux:** WebKitGTK 4.1 (soup3), version set by the distro.

**Web MIDI.** Only WebView2 exposes `requestMIDIAccess` (Chromium). WebView2 has a dedicated MIDI-SysEx permission kind [S44]. Wry/Tauri recently exposed a unified permission handler that maps MIDI to that kind (wry PR 1654, tauri PR 14865) [S43]. It is ❓ whether plain non-SysEx MIDI raises a WebView2 permission event.

WKWebView and WebKitGTK have **no Web MIDI**, so cross-platform Tauri MIDI must be native:
- `midir` 0.11.1 (crates.io, updated 2026-10-10) with commands and channels, or
- `tauri-plugin-midi` 0.3.1 (specta-rs, "WebMIDI-compatible plugin… polyfill", updated 2026-10-21) [S42]. Low adoption (~7k downloads); evaluate before depending on it.

**AudioWorklet.**
- ✅ in WebView2.
- ✅ in WKWebView on macOS versions whose WebKit is at least the Safari 14.1 level.
- ❓ in WebKitGTK: depends on the distro's WebKitGTK build and its GStreamer backend. A GStreamer audio-worklet bug is marked fixed [S46], but I did not verify a version.

**getUserMedia.**
- macOS needs `NSMicrophoneUsageDescription` in Info.plist ❓.
- WebKitGTK needs media-stream enabled in the webview settings ❓ (wry setting, not verified).

**Native audio** is possible via `cpal` 0.18.2 (WASAPI/ASIO, CoreAudio, ALSA/JACK/PipeWire).

**IPC characteristics** [S40][S41]:
- **Commands** are request/response and support raw binary arguments and `tauri::ipc::Response` for bytes.
- **Events** are "not designed for low latency or high throughput".
- **Channels** are "designed to be fast and deliver ordered data" and are used internally for streaming.
- An informal benchmark of 10 MB binary IPC measured ~5 ms on macOS and ~200 ms on Windows [S41] (anecdotal).

**Conclusion:** IPC is acceptable for **bulk PCM transfer** (import/export, recorded takes, chunked ≥ 100 ms). It is **unsuitable for real-time audio callbacks**: the webview cannot run inside a cpal render callback. If the native engine path is chosen later, DSP must run in Rust with only control/metering over channels. Large files should use the asset protocol (`convertFileSrc`) rather than IPC [S41].

---

## 7. Headless testing notes

**Environment.** Chromium 153 (chrome-headless-shell and full Chrome for Testing, both headless) driven by Playwright 1.64.1 [X4].

| Feature | Result | Notes |
|---|---|---|
| `AudioContext` | ✅ `running` without a gesture; sampleRate 44100 | Fake output device. `outputLatency` = 0. |
| `AudioWorklet` from Blob URL | ✅ | Also via `MediaStreamSource → AudioWorkletNode` (2 ch captured from the fake mic). |
| `OfflineAudioContext` + worklet | ✅ deterministic output (rendered constant 0.25) | Golden-file DSP tests are feasible. |
| `decodeAudioData` WAV/MP3/AAC(m4a)/Ogg-Vorbis/Ogg-Opus/FLAC | ✅ all | Output resampled to the context rate. |
| `getUserMedia` with fake device + WAV file | ✅ label "Fake Default Audio Input"; settings honoured (`echoCancellation/noiseSuppression/autoGainControl: false`, `channelCount: 2`) | Flags: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-audio-capture=<wav>`. Also grant `microphone`. |
| `enumerateDevices` | 3 fake inputs, 3 fake outputs | Enough to test device pickers / `setSinkId`. |
| COOP/COEP via `page.route` headers | ✅ `crossOriginIsolated: true`, SAB passed in `processorOptions` | Cheap way to test the SAB path. |
| Web MIDI | ❌ `InvalidStateError: Platform dependent initialization failed` (permission `granted`) | No `/dev/snd/seq` in the container. Options: (a) `page.addInitScript` installs a fake `navigator.requestMIDIAccess` with scriptable ports (recommended); (b) self-hosted CI with `snd-virmidi` ❓; (c) contract tests against `midi-core` with an in-memory port. |
| Autoplay gating | ⚠️ not enforced headless | Unit-test the "resume on gesture" logic. |
| Next.js `/studio` worker | ✅ worker round-trip in a production build | Worklet via raw `new URL` ❌ (§5). |

**`node-web-audio-api` 2.2.0** [S48][X9]:
- **Licence and packaging:** BSD-3-Clause, prebuilt napi binaries, Node ≥ 22.
- **Works:** `OfflineAudioContext` and `AudioWorklet` (`addModule('./file.mjs')`), with a deterministic render.
- **Decoding:** WAV/FLAC/MP3/Vorbis ✅; my AAC/M4A (moov atom at end) and Ogg-Opus ❌.
- **Use:** good for fast Node-side integration tests of DSP graphs without a browser. It is not a substitute for browser tests: it covers no gUM/MIDI, and its behaviour is a re-implementation.

---

## 8. Sources

### 8.1 External sources

| ID | Source | URL |
|---|---|---|
| S0 | npm registry metadata (`npm view <pkg>@<ver> peerDependencies engines`) | https://www.npmjs.com/ |
| S1 | MDN browser-compat-data 8.1.7 (2026-10-22), queried locally | https://github.com/mdn/browser-compat-data |
| S2 | web-features 3.44.0 (Baseline status) | https://web-platform-dx.github.io/web-features-explorer/ |
| S3 | Chrome blog: Web MIDI permission prompt (Chrome 124) | https://developer.chrome.com/blog/web-midi-permission-prompt |
| S4 | Fugu: New in Chrome 124 | https://groups.google.com/a/chromium.org/g/fugu-dev/c/NJEAy6MToKM |
| S5 | WebKit bug 107250 (Web MIDI master bug) | https://bugs.webkit.org/show_bug.cgi?id=107250 |
| S6 | caniuse Web MIDI | https://caniuse.com/midi |
| S7 | Mozilla bug 1808431 (site-permission add-on prompt) | https://bugzilla.mozilla.org/show_bug.cgi?id=1808431 |
| S8 | Mozilla bug 1796191 (split midi / midi-sysex) | https://bugzilla.mozilla.org/show_bug.cgi?id=1796191 |
| S9 | Mozilla bug 1802149 (statechange never fires) | https://bugzil.la/1802149 |
| S10 | Mozilla support: site permission add-ons | https://support.mozilla.org/en-US/kb/site-permission-add-ons |
| S11 | MDN: Storage quotas and eviction criteria | https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria |
| S12 | WebKit blog: Updates to Storage Policy | https://webkit.org/blog/14403/updates-to-storage-policy/ |
| S13 | web.dev: Storage for the web | https://web.dev/articles/storage-for-the-web |
| S14 | WebKit bug 292142 (iOS 18.4 IDB blob crash) | https://bugs.webkit.org/show_bug.cgi?id=292142 |
| S15 | WebKit bug 240216 (blob corruption after IDB save) | https://bugs.webkit.org/show_bug.cgi?id=240216 |
| S16 | WebKit bug 268037 (private-mode blob storage) | https://bugs.webkit.org/show_bug.cgi?id=268037 |
| S17 | MDN content PR: Safari 18.4 Ogg Opus/Vorbis | https://github.com/mdn/content/pull/39592 |
| S18 | "Ogg Opus still not working in Safari 18.4" | https://frequal.com/java/OggOpusStillNotWorkingInSafari18_4.html |
| S19 | WebKit bug 327697 (decodeAudioData Opus WebM mapping) | https://bugs.webkit.org/show_bug.cgi?id=327697 |
| S20 | Next.js 16 upgrade guide (also `next@16.4.3/dist/docs/01-app/02-guides/upgrading/version-16.md`) | https://nextjs.org/docs/app/guides/upgrading/version-16 |
| S21 | Next.js lazy loading (`ssr:false` only in Client Components) | https://nextjs.org/docs/app/guides/lazy-loading |
| S22 | Next.js `transpilePackages` | https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages |
| S23 | Next.js ESLint config | https://nextjs.org/docs/app/api-reference/config/eslint |
| S24 | Next.js CSS (importing CSS from node_modules) | https://nextjs.org/docs/app/getting-started/css |
| S25 | Next.js Turbopack reference (magic comments on `new Worker`) | https://nextjs.org/docs/app/api-reference/turbopack |
| S26 | TypeScript 6.0 announcement / migration (secondary: Socket) | https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ · https://aka.ms/ts6 · https://socket.dev/blog/typescript-6-0-released-final-javascript-based-version |
| S27 | typescript-eslint issue 12518 (TS peer `<6.1.0`) | https://github.com/typescript-eslint/typescript-eslint/issues/12518 |
| S28 | Vite 8 announcement / migration | https://vite.dev/blog/announcing-vite8 · https://vite.dev/guide/migration |
| S29 | @vitejs/plugin-react README / 6.0.0 release | https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md |
| S30 | Vitest projects / browser mode | https://vitest.dev/guide/projects · https://vitest.dev/guide/browser/ |
| S31 | Vitest 5 changes (secondary) | https://blog.openreplay.com/vitest-5-changes/ |
| S32 | ESLint v10.0.0 release / migration | https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ · https://eslint.org/docs/latest/use/migrate-to-10.0.0 |
| S33 | Turborepo internal packages (also `turbo@2.11.10/docs`, `schema.json`) | https://turborepo.dev/docs/core-concepts/internal-packages |
| S34 | Tailwind preflight / prefix (secondary: HyperUI, GH discussion 19367); verified by X5/X6 | https://tailwindcss.com/docs/preflight · https://hyperui.dev/blog/move-to-tailwindcss-without-breaking-changes/ · https://github.com/tailwindlabs/tailwindcss/discussions/19367 |
| S35 | Electron 45.0 release blog | https://www.electronjs.org/blog/electron-45-0 |
| S36 | Electron Session API (verified against `electron@45.1.0/electron.d.ts`) | https://www.electronjs.org/docs/latest/api/session |
| S37 | Electron security checklist | https://www.electronjs.org/docs/latest/tutorial/security |
| S38 | Electron IPC / contextBridge | https://www.electronjs.org/docs/latest/tutorial/ipc |
| S39 | Tauri webview versions | https://v2.tauri.app/reference/webview-versions/ |
| S40 | Tauri: calling the frontend (events vs channels) | https://v2.tauri.app/develop/calling-frontend/ |
| S41 | Tauri discussion 11915 (IPC perf) | https://github.com/orgs/tauri-apps/discussions/11915 |
| S42 | tauri-plugin-midi | https://github.com/specta-rs/tauri-plugin-midi · https://crates.io/crates/tauri-plugin-midi |
| S43 | wry PR 1654 / tauri PR 14865 (permission handler) | https://github.com/tauri-apps/wry/pull/1654 · https://github.com/tauri-apps/tauri/pull/14865 |
| S44 | WebView2 `CoreWebView2PermissionKind` | https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2permissionkind |
| S45 | cpal / midir crates | https://crates.io/crates/cpal · https://crates.io/crates/midir |
| S46 | WebKitGTK `enable-webaudio`; WebKit AudioWorklet bug 182506 | https://webkitgtk.org/reference/webkit2gtk/stable/property.Settings.enable-webaudio.html · https://bugs.webkit.org/show_bug.cgi?id=182506 |
| S47 | CSP applies `script-src` to AudioWorklet (WebKit layout test; WPT) | https://webkit.googlesource.com/WebKit/+/816395a4d82c8a9d685986402000a5441c27f7c3/LayoutTests/http/tests/security/contentSecurityPolicy/audioworklet-script-src-blocked-expected.txt · https://github.com/jerboas86/w3c-dyn-audioworklet |
| S48 | node-web-audio-api | https://github.com/ircam-ismm/node-web-audio-api |
| S49 | Playwright `BrowserContext.grantPermissions` / launch args | https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions |

### 8.2 Experiments

All experiments ran in `/tmp/claude-0/-home-user-music-app/043f54c8-4ada-5ddd-af69-cff7cd746d91/scratchpad/platform-research/`. The repo was not touched.

| ID | Experiment | Result |
|---|---|---|
| X1 | pnpm install eslint 10.13.0 + eslint-config-next 16.4.3 + typescript-eslint 8.72.1 + react-hooks 7.1.1 + TS 6.0.3; lint sample TSX; monorepo-scoped config | Peer warnings ×3; all plugin rules fire; scoped config works |
| X2 | `tsc` 6.0.3 probes of deprecated options and defaults | See §1.5 |
| X3 | Next 16.4.3 Turbopack `next build` with TS 6; `dynamic(ssr:false)` in client component; Worker + worklet via `new URL`; served and driven in Chromium | Build OK (static); worker OK; worklet MIME error |
| X4 | Playwright 1.64.1 + Chromium 153 headless probes (`probe.cjs`) | See §7 |
| X5 | Vite 8.3.5 + plugin-react 6.1.2 + @tailwindcss/vite 4.3.3 build; worker; `?worker&url`; prefix without preflight | OK; classes `tw:p-4`; no preflight |
| X6 | `@tailwindcss/cli` 4.3.3 standalone CSS build | OK (46 ms) |
| X7 | Vitest 5.0.5 `projects` (node + browser/playwright), fake-indexeddb + Dexie blob; `workspace` key; string provider | Pass; `workspace` removed; provider object required |
| X8 | dependency-cruiser 18.7.0 `--info` and run on TS sources | TS 6.0.3 accepted (`>=2 <7`) |
| X9 | node-web-audio-api 2.2.0 offline render, worklet, decode | See §7 |
| X10 | typescript-eslint `recommendedTypeChecked` + `projectService` on TS 6 | Works, no version warning |
