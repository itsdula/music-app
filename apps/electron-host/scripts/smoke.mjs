/* eslint-disable no-console -- CLI diagnostics */
/* global window, document, location -- referenced inside page.evaluate() callbacks */
// Electron host smoke test (Playwright `_electron`).
//
//   node scripts/smoke.mjs            build everything (turbo), launch, wait for <Studio /> ready
//   node scripts/smoke.mjs --probe    build only main/preload/probe and launch the security probe
//                                     page instead of Studio (no Studio packages involved)
//   --no-build                        reuse the existing dist/
//
// Under Linux without $DISPLAY the script re-executes itself through `xvfb-run -a`. When run
// as root, Electron gets `--no-sandbox` (Chromium refuses to start its OS sandbox as root).
// Exits non-zero on any failed check or unexpected renderer console error.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(appDir, '../..');
const argv = process.argv.slice(2);
const probeMode = argv.includes('--probe');
const skipBuild = argv.includes('--no-build');
const TIMEOUT_MS = 120_000;

// --- display -------------------------------------------------------------------------------
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.STUDIO_SMOKE_XVFB) {
  const result = spawnSync(
    'xvfb-run',
    [
      '-a',
      '-s',
      '-screen 0 1600x1000x24',
      process.execPath,
      fileURLToPath(import.meta.url),
      ...argv,
    ],
    { stdio: 'inherit', env: { ...process.env, STUDIO_SMOKE_XVFB: '1' } },
  );
  if (result.error) {
    console.error(`smoke: no $DISPLAY and xvfb-run failed: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const failures = [];
const passes = [];
function check(name, condition, detail) {
  if (condition) passes.push(name);
  else failures.push(detail === undefined ? name : `${name}: ${JSON.stringify(detail)}`);
}

function run(command, args, cwd) {
  console.log(`smoke: $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  return result.status === 0;
}

// --- build ---------------------------------------------------------------------------------
if (!skipBuild) {
  const built = probeMode
    ? run(process.execPath, ['scripts/build.mjs', '--skip-renderer'], appDir)
    : run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@studio/electron-host...'], repoRoot);
  if (!built) {
    console.error('smoke: FAILED — build failed (see output above)');
    process.exit(1);
  }
}

// --- launch --------------------------------------------------------------------------------
const { _electron } = await import('playwright');
const electronPath = createRequire(join(appDir, 'package.json'))('electron');
const userDataDir = await mkdtemp(join(tmpdir(), 'studio-electron-smoke-'));
const savePath = join(userDataDir, 'smoke-take.wav');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const watchdog = setTimeout(() => {
  console.error(`smoke: FAILED — timed out after ${TIMEOUT_MS} ms`);
  process.exit(1);
}, TIMEOUT_MS);

const app = await _electron.launch({
  executablePath: electronPath,
  args: [appDir, ...(isRoot ? ['--no-sandbox'] : [])],
  cwd: appDir,
  env: {
    ...process.env,
    STUDIO_USER_DATA_DIR: userDataDir,
    ...(probeMode ? { STUDIO_ELECTRON_PROBE: '1' } : {}),
  },
  timeout: 60_000,
});
app.process().stderr?.on('data', (chunk) => process.stderr.write(`[electron] ${chunk}`));

let phase = 'load';
const consoleErrors = [];
const expectedViolations = [];
try {
  const page = await app.firstWindow();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    (phase === 'load' ? consoleErrors : expectedViolations).push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const readySelector = probeMode
    ? '[data-testid="probe-root"][data-probe-status="ready"]'
    : '[data-testid="studio-root"][data-studio-status="ready"]';
  await page.waitForSelector(readySelector, { state: 'attached', timeout: 60_000 });
  check(probeMode ? 'probe page ready' : 'studio ready', true);

  // --- isolation ---------------------------------------------------------------------------
  const isolation = await page.evaluate(() => ({
    href: location.href,
    hostType: typeof window.studioHost,
    hostKeys: window.studioHost ? Object.keys(window.studioHost).sort() : [],
    saveFile: typeof window.studioHost?.saveFile,
    openFiles: typeof window.studioHost?.openFiles,
    platform: window.studioHost?.platform,
    require: typeof window.require,
    process: typeof window.process,
    module: typeof window.module,
    buffer: typeof window.Buffer,
    secureContext: window.isSecureContext,
  }));
  check('served from studio://app/', isolation.href.startsWith('studio://app/'), isolation.href);
  check('window.studioHost exists', isolation.hostType === 'object', isolation.hostType);
  check(
    'studioHost exposes only saveFile/openFiles/platform',
    JSON.stringify(isolation.hostKeys) === JSON.stringify(['openFiles', 'platform', 'saveFile']),
    isolation.hostKeys,
  );
  check(
    'studioHost methods are functions',
    isolation.saveFile === 'function' && isolation.openFiles === 'function',
  );
  check(
    'studioHost.platform reports Electron 45',
    isolation.platform?.versions?.electron?.startsWith('45.') && !!isolation.platform?.os,
    isolation.platform,
  );
  check('window.require is undefined', isolation.require === 'undefined', isolation.require);
  check('window.process is undefined', isolation.process === 'undefined', isolation.process);
  check('window.module is undefined', isolation.module === 'undefined', isolation.module);
  check('window.Buffer is undefined', isolation.buffer === 'undefined', isolation.buffer);
  check('secure context', isolation.secureContext === true);

  if (probeMode) {
    const probe = await page.evaluate(() => window.studioProbe);
    check('Blob-URL Worker runs under CSP', probe?.blobWorker === true, probe);
    check('Blob-URL AudioWorklet module loads under CSP', probe?.audioWorklet === true, probe);
  }
  check('no console errors while loading', consoleErrors.length === 0, consoleErrors);

  // --- CSP -----------------------------------------------------------------------------------
  phase = 'security';
  const csp = await page.evaluate(async () => {
    const response = await fetch(location.href);
    let evalBlocked = false;
    try {
      (0, eval)('1');
    } catch (error) {
      evalBlocked = error instanceof EvalError;
    }
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true;';
    document.head.appendChild(script);
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      header: response.headers.get('content-security-policy') ?? '',
      evalBlocked,
      inlineRan: window.__inlineRan === true,
    };
  });
  check('CSP header served', csp.header.includes("script-src 'self' blob:"), csp.header);
  check('CSP worker-src allows blob:', csp.header.includes("worker-src 'self' blob:"), csp.header);
  check('CSP blocks eval', csp.evalBlocked);
  check('CSP blocks inline scripts', !csp.inlineRan);

  // --- app protocol --------------------------------------------------------------------------
  const protocolStatus = await page.evaluate(async () => {
    const status = async (url) => {
      try {
        return (await fetch(url)).status;
      } catch {
        return 'blocked';
      }
    };
    return {
      traversal: await status('studio://app/%2e%2e/main/main.js'),
      encodedSlash: await status('studio://app/..%2fmain%2fmain.js'),
      otherHost: await status('studio://other/index.html'),
      post: await fetch(location.href, { method: 'POST' }).then((r) => r.status),
    };
  });
  check('app protocol refuses path traversal', protocolStatus.traversal !== 200, protocolStatus);
  check(
    'app protocol refuses encoded separators',
    protocolStatus.encodedSlash !== 200,
    protocolStatus,
  );
  check('app protocol serves only studio://app', protocolStatus.otherHost !== 200, protocolStatus);
  check('app protocol refuses POST', protocolStatus.post === 405, protocolStatus);

  // --- permissions -----------------------------------------------------------------------------
  const permissions = await page.evaluate(async () => {
    const query = async (descriptor) => {
      try {
        return (await navigator.permissions.query(descriptor)).state;
      } catch (error) {
        return `error: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    let sysexAccess = 'resolved';
    try {
      await navigator.requestMIDIAccess({ sysex: true });
    } catch (error) {
      sysexAccess = error instanceof Error ? error.name : String(error);
    }
    return {
      midi: await query({ name: 'midi', sysex: false }),
      midiSysex: await query({ name: 'midi', sysex: true }),
      microphone: await query({ name: 'microphone' }),
      camera: await query({ name: 'camera' }),
      geolocation: await query({ name: 'geolocation' }),
      notifications: await query({ name: 'notifications' }),
      sysexAccess,
      windowOpen: window.open('https://example.com/') === null,
    };
  });
  console.log('smoke: permission states', permissions);
  check('midi permission granted', permissions.midi === 'granted', permissions.midi);
  check('midi sysex permission denied', permissions.midiSysex === 'denied', permissions.midiSysex);
  check('requestMIDIAccess({ sysex: true }) rejected', permissions.sysexAccess !== 'resolved');
  check(
    'microphone permission granted',
    permissions.microphone === 'granted',
    permissions.microphone,
  );
  check('camera permission denied', permissions.camera === 'denied', permissions.camera);
  check('geolocation denied', permissions.geolocation === 'denied', permissions.geolocation);
  check('notifications denied', permissions.notifications === 'denied', permissions.notifications);
  check('window.open denied', permissions.windowOpen);

  // --- IPC validation --------------------------------------------------------------------------
  const rejections = await page.evaluate(async () => {
    const reason = async (fn) => {
      try {
        await fn();
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const host = window.studioHost;
    return {
      pathName: await reason(() => host.saveFile(new Uint8Array(1), '../evil.wav', 'audio/wav')),
      badMime: await reason(() => host.saveFile(new Uint8Array(1), 'a.wav', 'not a mime')),
      notBytes: await reason(() => host.saveFile('abc', 'a.wav', 'audio/wav')),
      badAccept: await reason(() => host.openFiles(['../*'], false)),
      badMultiple: await reason(() => host.openFiles(['audio/*'], 'yes')),
    };
  });
  for (const [name, message] of Object.entries(rejections)) {
    check(`IPC rejects invalid arguments (${name})`, typeof message === 'string', message);
  }

  // --- IPC round trip with stubbed native dialogs ----------------------------------------------
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] });
  }, savePath);
  const saved = await page.evaluate(() =>
    window.studioHost.saveFile(new Uint8Array([82, 73, 70, 70, 1, 2, 3]), 'take.wav', 'audio/wav'),
  );
  const written = await readFile(savePath).catch(() => Buffer.alloc(0));
  check('saveFile writes through the native dialog', saved === true && written.length === 7, {
    saved,
    length: written.length,
  });
  const opened = await page.evaluate(async () => {
    const files = await window.studioHost.openFiles(['audio/*', '.wav'], false);
    return files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      isBytes: file.bytes instanceof Uint8Array,
      bytes: Array.from(file.bytes),
    }));
  });
  check(
    'openFiles reads through the native dialog',
    opened.length === 1 &&
      opened[0].name === 'smoke-take.wav' &&
      opened[0].mimeType === 'audio/wav' &&
      opened[0].isBytes &&
      opened[0].bytes.join(',') === '82,73,70,70,1,2,3',
    opened,
  );
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
  });
  const cancelled = await page.evaluate(() => window.studioHost.openFiles(['.wav'], true));
  check('openFiles resolves [] when cancelled', Array.isArray(cancelled) && cancelled.length === 0);

  // --- navigation ------------------------------------------------------------------------------
  await page.evaluate(() => {
    location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  const hrefAfter = await page.evaluate(() => location.href);
  check('navigation outside the app is blocked', hrefAfter.startsWith('studio://app/'), hrefAfter);

  check('no unexpected page errors', consoleErrors.length === 0, consoleErrors);
} catch (error) {
  failures.push(`exception: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await app.close().catch(() => undefined);
  clearTimeout(watchdog);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
}

const mode = probeMode ? 'probe' : 'studio';
for (const name of passes) console.log(`  ok   ${name}`);
for (const failure of failures) console.error(`  FAIL ${failure}`);
if (expectedViolations.length > 0) {
  console.log(
    `smoke: ${expectedViolations.length} expected CSP violation message(s) during security checks`,
  );
}
if (failures.length > 0) {
  console.error(`smoke (${mode}): FAILED — ${failures.length} failure(s), ${passes.length} passed`);
  process.exit(1);
}
console.log(`smoke (${mode}): PASSED — ${passes.length} checks`);
