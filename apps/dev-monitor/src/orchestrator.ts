/**
 * `pnpm dev` / `npm run dev`: starts the whole dev environment and prints one line, the
 * dev-monitor URL. Everything else (build output, Next.js, Electron) is shown on that page
 * as log records. See docs/dev-monitor.md.
 *
 *   1. bundle the monitor page, bind the monitor to 127.0.0.1:3300 (or the next free port)
 *   2. prepare: workspace codegen + the package builds Next.js and Electron need
 *   3. spawn (directly, not through turbo): the @studio/react CSS watcher, `next dev`, the
 *      Electron watch build, then Electron itself once main/preload/renderer are built
 *   4. Ctrl+C / SIGTERM: stop every child process group, then exit 0
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectLocalUrl } from './lines';
import { LogHub } from './log-hub';
import { buildPageAssets } from './page-assets';
import { listenOnFreePort, NoFreePortError } from './ports';
import { createMonitorServer, type PageAssets } from './server';
import { SERVICES, SEVERITY, severityName } from './shared/types';
import { childEnv, ManagedProcess } from './supervisor';

const HOST = '127.0.0.1';
const FIRST_PORT = 3300;
const LAST_PORT = 3399;
const NEXT_PORT = 3000;
const STOP_TIMEOUT_MS = 5000;

/** dev.mjs bundles this file into apps/dev-monitor/dist/orchestrator.mjs. */
const appDir =
  process.env.STUDIO_DEV_MONITOR_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appDir, '..', '..');
const webDir = join(repoRoot, 'apps', 'web');
const electronDir = join(repoRoot, 'apps', 'electron-host');
const reactDir = join(repoRoot, 'packages', 'studio-react');

function fatal(message: string): never {
  process.stderr.write(`studio dev: ${message}\n`);
  process.exit(1);
}

const hub = new LogHub();

function note(severity: keyof typeof SEVERITY, body: string, attributes = {}): void {
  hub.publish({
    service: SERVICES.build,
    timeMs: Date.now(),
    severityNumber: SEVERITY[severity],
    severityText: severityName(SEVERITY[severity]),
    body,
    scope: 'dev-monitor',
    attributes: { 'studio.process': 'orchestrator', ...attributes },
  });
}

let assets: PageAssets;
try {
  assets = await buildPageAssets(appDir);
} catch (error) {
  fatal(`cannot bundle the monitor page: ${String(error)}`);
}

let nextUrl = `http://localhost:${NEXT_PORT}`;
let shuttingDown = false;

const actions = {
  openElectron: () => openElectron(),
  restartElectron: () => restartElectron(),
};

const server = createMonitorServer({
  hub,
  assets: () => assets,
  actions,
  info: () => ({ monitorUrl, nextUrl, studioUrl: `${nextUrl}/studio` }),
});

let port: number;
try {
  port = await listenOnFreePort(server, HOST, FIRST_PORT, LAST_PORT);
} catch (error) {
  fatal(
    error instanceof NoFreePortError ? error.message : `cannot start the monitor: ${String(error)}`,
  );
}
const monitorUrl = `http://localhost:${port}`;
const otlpEndpoint = `http://${HOST}:${port}/v1/logs`;

if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
process.stdout.write(`Studio dev monitor: ${monitorUrl}\n`);

note('INFO', `dev monitor listening on ${monitorUrl} (OTLP logs: ${otlpEndpoint})`);

// ---------- child processes ----------

const node = process.execPath;
const otelEnv = (serviceName: string) => ({
  STUDIO_DEV: '1',
  OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: otlpEndpoint,
  OTEL_SERVICE_NAME: serviceName,
});

const turboBin = join(repoRoot, 'node_modules', '.bin', 'turbo');
const prepare = new ManagedProcess(
  {
    id: 'prepare',
    label: 'Prepare',
    service: SERVICES.build,
    command: turboBin,
    args: [
      'run',
      'codegen',
      'build',
      '--filter=@studio/web^...',
      '--filter=@studio/electron-host^...',
      '--output-logs=new-only',
      '--ui=stream',
    ],
    cwd: repoRoot,
    env: childEnv(process.env),
    attributes: { 'studio.task': 'prepare' },
  },
  hub,
);

const css = new ManagedProcess(
  {
    id: 'css',
    label: 'CSS watch',
    service: SERVICES.build,
    command: node,
    args: [join(reactDir, 'scripts', 'build-css.mjs'), '--watch'],
    cwd: reactDir,
    env: childEnv(process.env),
    attributes: { 'studio.task': 'css' },
    // The Tailwind CLI reports progress ("Done in 120ms") on stderr.
    stderrSeverity: SEVERITY.INFO,
  },
  hub,
);

const nextBin = createRequire(join(webDir, 'package.json')).resolve('next/dist/bin/next');
const next = new ManagedProcess(
  {
    id: 'next',
    label: 'Next.js',
    service: SERVICES.next,
    command: node,
    args: [nextBin, 'dev', '--port', String(NEXT_PORT)],
    cwd: webDir,
    env: childEnv(process.env, otelEnv(SERVICES.next)),
    isReady: (line) => /\bReady in\b/.test(line),
    onLine: (line) => {
      const url = detectLocalUrl(line);
      if (url && url !== nextUrl) {
        nextUrl = url;
        next.setUrl(url);
      } else if (url) next.setUrl(url);
    },
  },
  hub,
);

const builtOnce = new Set<string>();
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let launchWhenBuilt = true;

const electronBuild = new ManagedProcess(
  {
    id: 'electron-build',
    label: 'Electron build',
    service: SERVICES.build,
    command: node,
    args: [join(electronDir, 'scripts', 'build.mjs'), '--watch'],
    cwd: electronDir,
    env: childEnv(process.env, { STUDIO_DEV: '1' }),
    attributes: { 'studio.task': 'electron-build' },
    isReady: () => builtOnce.size === 3,
    onLine: (line) => {
      const match = /^\[watch\] (main|preload|renderer) (built|failed)/.exec(line);
      if (!match || match[2] !== 'built') return;
      const target = match[1]!;
      const first = !builtOnce.has(target);
      builtOnce.add(target);
      if (builtOnce.size < 3) return;
      if (first && launchWhenBuilt && !electron.running) {
        launchWhenBuilt = false;
        startElectron();
      } else if (target === 'main' && !first) {
        // Preload/renderer changes reload the window from inside main (dev-reload.ts).
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => void restartElectron('main rebuilt'), 200);
      }
    },
  },
  hub,
);

const electronBin = createRequire(join(electronDir, 'package.json'))('electron') as string;
const electronEnv = childEnv(process.env, {
  ...otelEnv(SERVICES.electronMain),
  STUDIO_USER_DATA_DIR: join(repoRoot, '.dev', 'electron-profile'),
});
const electron = new ManagedProcess(
  {
    id: 'electron',
    label: 'Electron',
    service: SERVICES.electronMain,
    command: electronBin,
    args: ['.'],
    cwd: electronDir,
    env: electronEnv,
  },
  hub,
);

function startElectron(): void {
  if (shuttingDown || electron.running) return;
  mkdirSync(join(repoRoot, '.dev', 'electron-profile'), { recursive: true });
  electron.start();
}

async function restartElectron(reason = 'restart requested'): Promise<void> {
  if (shuttingDown) return;
  if (builtOnce.size < 3) {
    launchWhenBuilt = true;
    note('INFO', 'Electron starts once its first build finishes');
    return;
  }
  note('INFO', `restarting Electron (${reason})`);
  if (electron.running) {
    electron.setState('restarting');
    await electron.stop(STOP_TIMEOUT_MS);
  }
  startElectron();
}

async function openElectron(): Promise<void> {
  if (shuttingDown) return;
  if (builtOnce.size < 3) {
    launchWhenBuilt = true;
    note('INFO', 'Electron opens once its first build finishes');
    return;
  }
  if (!electron.running) return startElectron();
  // A second instance hands over to the running one (single-instance lock), which focuses
  // or reopens its window and then the second instance quits.
  const focus = new ManagedProcess(
    {
      id: 'electron-focus',
      label: 'Electron (focus)',
      service: SERVICES.electronMain,
      command: electronBin,
      args: ['.'],
      cwd: electronDir,
      env: electronEnv,
    },
    hub,
  );
  focus.start();
  await focus.waitForExit();
  hub.removeStatus('electron-focus');
}

// ---------- shutdown ----------

const everyChild = [electron, next, electronBuild, css, prepare];

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    // Second Ctrl+C: do not wait any longer.
    for (const child of everyChild) void child.stop(0, 'SIGKILL');
    process.exit(0);
  }
  shuttingDown = true;
  note('INFO', `${signal}: stopping the dev environment`);
  if (restartTimer) clearTimeout(restartTimer);
  // Electron first, so it can flush its telemetry while the receiver is still up.
  await electron.stop(STOP_TIMEOUT_MS);
  await Promise.all(everyChild.map((child) => child.stop(STOP_TIMEOUT_MS)));
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => void shutdown(signal));
}

// If the wrapper (npm/pnpm) dies without passing a signal on, stop anyway: no orphans.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid) void shutdown('parent process exited');
}, 1000).unref();

// ---------- start ----------

note('INFO', 'prepare: codegen and package builds for Next.js and Electron');
prepare.start();
await prepare.waitForExit();
if (!shuttingDown) {
  if (hub.status('prepare')?.state === 'crashed') {
    note('ERROR', 'prepare failed; starting the services anyway (see the Build tab)');
  } else {
    note('INFO', 'prepare finished');
  }
  css.start();
  next.start();
  electronBuild.start();
}
