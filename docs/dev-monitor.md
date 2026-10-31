# Dev monitor (`pnpm dev`)

`pnpm dev` (or `npm run dev`) starts the whole local dev environment and prints **one line**:

```text
Studio dev monitor: http://localhost:3300
```

On a terminal the screen is cleared first. npm and pnpm print their own `> studio-monorepo@ dev`
banner before the script starts; the clear wipes it. Open the link to see:

- every service's status;
- links to the Next.js app (`/` and `/studio`);
- buttons to open, focus or restart the Electron app;
- the logs of every service, one tab each.

Ctrl+C (or SIGTERM) stops every child process and exits 0. `pnpm dev:web` still runs only the
Next.js host through Turbo, as `pnpm dev` used to.

## How it works

`scripts/dev.mjs` bundles `apps/dev-monitor/src/orchestrator.ts` with esbuild into
`apps/dev-monitor/dist/orchestrator.mjs` and runs it. The orchestrator:

1. **Bundles the monitor page** (`apps/dev-monitor/src/page`, React 19, plain CSS with the Studio
   palette) in memory with esbuild.
2. **Binds the monitor** to `127.0.0.1:3300`. If that port is taken it tries 3301, 3302 and so on
   up to 3399, and prints the port it got. If none is free it writes an error to stderr and
   exits 1.
3. **Prepare** (shown as the "Prepare" status and in the Build tab):
   `turbo run codegen build --filter=@studio/web^... --filter=@studio/electron-host^...`.
   This runs workspace codegen and the package builds both apps need, including
   `@studio/react`'s `dist/studio.css`. If it fails, the services start anyway and the error is
   in the Build tab.
4. **Spawns each service directly** (not through Turbo, whose strict env mode would strip the
   variables below). Each one runs in its own process group with `stdio` piped:

   | Status id        | Command                                               | Service (`service.name`) |
   | ---------------- | ----------------------------------------------------- | ------------------------ |
   | `css`            | `packages/studio-react/scripts/build-css.mjs --watch` | `studio-build`           |
   | `next`           | `next dev --port 3000` in `apps/web`                  | `studio-next`            |
   | `electron-build` | `apps/electron-host/scripts/build.mjs --watch`        | `studio-build`           |
   | `electron`       | the Electron binary on `apps/electron-host`           | `studio-electron-main`   |

   Electron starts once main, preload and renderer have each been built once.

Every stdout/stderr line of every child becomes a log record of that child's service. The
orchestrator:

- strips ANSI codes;
- sets the attributes `log.iostream` (`stdout`/`stderr`), `studio.process`, and `studio.task` for
  build steps.

The severity comes from the first of these that matches:

- Next.js prefixes: `⨯` is ERROR, `⚠` is WARN, and `✓ ○ ▲ »` are INFO.
- Chromium's `[pid:tid:…:LEVEL:file(line)]` prefix.
- `Error:` and stack-frame lines are ERROR.
- Anything else is WARN on stderr and INFO on stdout. The Tailwind watcher is the exception: its
  stderr is INFO.

The services also send structured OpenTelemetry logs (OTLP/HTTP) to the monitor.

### Electron in dev

`build.mjs --watch` rebuilds on change and prints one `[watch] <target> built|failed` line per
rebuild:

- main and preload: esbuild contexts;
- renderer: `vite build --watch`.

What happens after a rebuild:

- **main rebuilt:** the orchestrator restarts Electron (SIGTERM to its process group, then a new
  launch).
- **preload or renderer rebuilt:** main watches `dist/renderer` and `dist/preload` (debounced
  300 ms) and calls `webContents.reloadIgnoringCache()`. There is no HMR.

The renderer is still served from `studio://app/` with the production CSP, IPC sender checks and
permission policy.

Dev-only code is compiled in only when the build runs with `STUDIO_DEV=1`, which sets the define
`__STUDIO_DEV__` (declared in `apps/electron-host/src/shared/build-defines.d.ts`). At runtime it
also needs `STUDIO_DEV=1`.

- `src/main/dev-mode.ts` loads:
  - `dev-telemetry.ts`, the OpenTelemetry export;
  - `dev-reload.ts`, the window reload;
  - a SIGTERM handler that quits normally, so the quit-time flushes run.
- `src/main/dev-log.ts` is a no-op sink unless dev mode installs one. Main logs these lifecycle
  events through it: `app ready`, `window created`, `window loaded`, `second instance launched`,
  `reloaded windows`, and IPC handler errors (dev builds only).
- In the renderer, `createBrowserPlatform({ consoleLevel: 'debug' })` makes `BrowserLogger` print
  info and debug to the console, so main can forward them. Production keeps warn and error only.

Every other build defines `__STUDIO_DEV__` as `false`. esbuild then drops `dev-mode.ts` and
OpenTelemetry from the bundle. To check:

```bash
pnpm --filter @studio/electron-host build
grep -c opentelemetry apps/electron-host/dist/main/main.js   # 0
```

"Open Electron" on the page launches Electron when it is not running. When it is running, the
button launches a second instance; the single-instance lock hands over to the running app, which
focuses its window, or in dev reopens a closed one.

## Services and telemetry

| Service                    | Tab               | Sources                                                                                                                                                                                                               |
| -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `studio-next`              | Next.js           | `next dev` stdout/stderr; OTLP from `apps/web/instrumentation.node.ts` (`onRequestError`, any `logs.getLogger(...)` call). Lines starting `[browser]` have `studio.source=next-browser`.                              |
| `studio-electron-main`     | Electron main     | Electron stdout/stderr (including Chromium's own log lines); OTLP from `dev-telemetry.ts`: lifecycle, IPC errors, `render-process-gone`, `child-process-gone`, `preload-error`, `did-fail-load`, uncaught exceptions. |
| `studio-electron-renderer` | Electron renderer | OTLP from `dev-telemetry.ts`: every `console-message` of every `webContents`, including the sandboxed preload. Objects arrive as strings (`[object Object]`).                                                         |
| `studio-build`             | Build             | Prepare, the CSS watcher, the Electron watch build, and the orchestrator itself.                                                                                                                                      |

**Next.js:**

- `instrumentation.ts` loads `instrumentation.node.ts` only when `NEXT_RUNTIME === 'nodejs'` and
  `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is set. It does not wrap `console`, because stdout capture
  already sees those lines.
- With `STUDIO_DEV=1`, `next.config.ts` turns on `logging.browserToTerminal`, so the browser
  console of the pages is forwarded to the terminal and reaches the monitor.

**Versions:** the emitters use the OpenTelemetry JS 3.0 line, pinned exactly:

- `@opentelemetry/api` 1.10.0
- `@opentelemetry/sdk-logs` 3.0.0
- `@opentelemetry/exporter-logs-otlp-http` 0.300.0
- `@opentelemetry/resources` 3.0.0

This line needs Node 22.15 or newer; the root `engines` says so. Do not add `@vercel/otel`: it
needs the 0.2xx line, which keeps its logger provider in a different global.

## Monitor HTTP API (127.0.0.1 only)

| Method and path              | What                                                                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/logs`              | OTLP/HTTP logs receiver: JSON or protobuf, optional `Content-Encoding: gzip`, 8 MiB max, CORS for loopback origins                                                |
| `GET /events`                | SSE stream of `status`, `status-remove`, `log` and `clear` events. A new client first gets every status and the last 5000 records, then `ready`. Ping every 15 s. |
| `GET /api/services`          | `{ monitorUrl, nextUrl, studioUrl, services: ServiceStatus[] }`                                                                                                   |
| `POST /api/electron/open`    | Launch Electron, or focus it                                                                                                                                      |
| `POST /api/electron/restart` | Restart Electron                                                                                                                                                  |
| `POST /api/logs/clear`       | Empty the ring buffer, on the server and in every open page                                                                                                       |
| `GET /`, `/assets/*`         | The page, served with a strict CSP                                                                                                                                |

Requests are refused when the `Host` header is not a loopback name (prevents DNS rebinding), or
when they carry an `Origin` that is not loopback, so other websites cannot post to the API.

Service states are `pending`, `starting`, `running`, `restarting`, `exited`, `crashed` and
`stopped`. Each status also carries a pid, a URL (Next.js only), and an exit code.

**The page:**

- One tab per service, plus All.
- Filters: a minimum-severity filter and text search over the body and the source.
- Pause (incoming records queue up), autoscroll, and Clear.
- Click a row to expand it: time, severity, service, scope, body, attributes and resource.
- At most the 1000 newest matching rows are rendered. The page keeps 5000 records.

## Ports and environment

| Port      | Used by                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| 3300–3399 | the dev monitor (first free port)                                                        |
| 3000      | `next dev`; if 3000 is taken, Next picks another port and the monitor shows the real one |
| 3001      | `pnpm dev:vite` (not started by `pnpm dev`)                                              |
| 3100/3200 | Playwright servers; never bound by dev tooling                                           |

**Set on every child:**

- `NO_COLOR=1`
- `FORCE_COLOR` and `ELECTRON_RUN_AS_NODE` are removed. VS Code and Cursor terminals export
  `ELECTRON_RUN_AS_NODE`, which would make Electron run as plain Node.

**Set on Next.js and Electron:**

| Variable                           | Value                                       |
| ---------------------------------- | ------------------------------------------- |
| `STUDIO_DEV`                       | `1`                                         |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://127.0.0.1:<port>/v1/logs`           |
| `OTEL_SERVICE_NAME`                | `studio-next` or `studio-electron-main`     |
| `STUDIO_USER_DATA_DIR` (Electron)  | `<repo>/.dev/electron-profile` (gitignored) |

Electron gets its own profile so that its single-instance lock does not clash with a
`pnpm --filter @studio/electron-host start` that is already running.

## Troubleshooting

- **`studio dev: no free port on 127.0.0.1 between 3300 and 3399`.** Another monitor is probably
  still running. Stop it, or find it with `lsof -nP -iTCP:3300 -sTCP:LISTEN`.
- **Electron never opens.** Check the Build tab for `[watch] … failed` lines and the
  `electron-build` status. Electron starts only after main, preload and renderer have each built
  once. To launch it later, use "Open Electron".
- **Electron exits immediately with `does not provide an export named 'BrowserWindow'`.**
  `ELECTRON_RUN_AS_NODE` reached Electron. The orchestrator strips it, so this only happens when
  Electron is launched by hand from a VS Code terminal.
- **No `studio-electron-renderer` records.** Make sure the Electron build ran with
  `STUDIO_DEV=1`. The orchestrator sets it; a plain `pnpm --filter @studio/electron-host build`
  does not.
- **Next.js runs on another port.** That happens when port 3000 was taken. The pill and the
  links use the URL that `next dev` printed.
- **Everything looks stale after switching branches.** Stop `pnpm dev` and start it again; the
  prepare step rebuilds what changed.
- **Leftover processes.** Each child runs in its own process group, and the whole group is
  stopped on exit. If the orchestrator is killed with SIGKILL, look for leftovers with
  `lsof -nP -iTCP:3000 -iTCP:3300 -sTCP:LISTEN`.
- **`apps/web/AGENTS.md` appears.** `next dev` 16.4 generates it (`agentRules`). This is Next's
  behaviour, not the monitor's.
