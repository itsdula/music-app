/**
 * Electron main process for Studio.
 *
 * - The renderer is served from disk through the privileged custom scheme `studio://app/`
 *   (stable secure origin, CSP header on every response, no `file://` ambient authority).
 * - Every window is sandboxed with context isolation and no Node integration; the only
 *   bridge is the typed `window.studioHost` preload API.
 * - Permissions are default-deny except microphone, MIDI (never SysEx) and sanitized
 *   clipboard writes for the app origin. Navigation and new windows are blocked.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, protocol, session, type WebContents } from 'electron';
import { APP_ENTRY_URL, APP_SCHEME } from '../shared/host-api';
import { contentTypeFor, resolveAppFile } from './app-files';
import { registerIpcHandlers } from './ipc';
import {
  assistantConnectSources,
  isAllowedNavigation,
  isPermissionAllowed,
  PRIVILEGED_SCHEME,
  securityHeaders,
  type CspOptions,
} from './policy';

const distDir = join(import.meta.dirname, '..');
/** `STUDIO_ELECTRON_PROBE=1` serves the bundled security probe page instead of Studio (smoke tests). */
const rendererDir = join(distDir, process.env.STUDIO_ELECTRON_PROBE === '1' ? 'probe' : 'renderer');
const preloadPath = join(distDir, 'preload', 'preload.cjs');
/** The renderer may reach the AI assistant endpoint baked in at build time, and nothing else. */
const cspOptions: CspOptions = {
  extraConnectSrc: assistantConnectSources(
    typeof __STUDIO_ASSISTANT_URL__ === 'string' ? __STUDIO_ASSISTANT_URL__ : '',
  ),
};

if (process.env.STUDIO_USER_DATA_DIR) app.setPath('userData', process.env.STUDIO_USER_DATA_DIR);

// Must run before `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: PRIVILEGED_SCHEME.scheme, privileges: { ...PRIVILEGED_SCHEME.privileges } },
]);
// Force the renderer sandbox for every WebContents, not only those created below. Skipped
// when the operator explicitly disabled the OS sandbox (`--no-sandbox`, e.g. CI as root):
// combining both makes Chromium's child processes abort at startup.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

let mainWindow: BrowserWindow | null = null;

function installAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405 });
    }
    const filePath = resolveAppFile(rendererDir, request.url);
    if (!filePath) return new Response(null, { status: 404 });
    try {
      const body = await readFile(filePath);
      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: securityHeaders(contentTypeFor(filePath), cspOptions),
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function installPermissionPolicy(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
    callback(isPermissionAllowed(permission, details.requestingUrl, mediaTypes));
  });
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const mediaTypes = details.mediaType ? [details.mediaType] : undefined;
    return isPermissionAllowed(permission, requestingOrigin, mediaTypes);
  });
  // HID / USB / serial / Bluetooth device access: never.
  ses.setDevicePermissionHandler(() => false);
}

function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => {
    if (!isAllowedNavigation(event.url)) event.preventDefault();
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    title: 'Studio',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void win.loadURL(APP_ENTRY_URL);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app.whenReady().then(() => {
    installAppProtocol();
    installPermissionPolicy();
    registerIpcHandlers();
    mainWindow = createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });
}
