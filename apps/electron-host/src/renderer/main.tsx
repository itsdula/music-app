import '@studio/react/styles.css';
import './host.css';
import {
  createBridgedKeyValueStore,
  createBrowserPlatform,
  createHttpAssistantTransport,
} from '@studio/platform-browser';
import { Studio, type PlatformProvider } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createElectronFileDialogs } from './file-dialogs';

const host = window.studioHost;
if (!host) throw new Error('window.studioHost is missing: the preload bridge did not load');

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// AI assistant: POST to the Studio server endpoint baked in at build time
// (STUDIO_ASSISTANT_URL; the main process allows exactly that origin in the CSP). Without it the
// chat panel explains that no assistant is configured.
const assistantUrl = typeof __STUDIO_ASSISTANT_URL__ === 'string' ? __STUDIO_ASSISTANT_URL__ : '';
const assistantToken =
  typeof __STUDIO_ASSISTANT_TOKEN__ === 'string' ? __STUDIO_ASSISTANT_TOKEN__ : '';
// Dev builds (`pnpm dev`) print every log level so main can forward the console to the dev
// monitor; production keeps the default (warn and error only).
const devBuild = typeof __STUDIO_DEV__ !== 'undefined' && __STUDIO_DEV__ === true;

// Web Audio, Web MIDI, IndexedDB, permissions etc. work unchanged in Chromium; file dialogs
// and UI preferences go through the native bridge. Preferences live in the main process
// (`<userData>/preferences.json`): loaded once here, before Studio renders, then read
// synchronously from memory and written back over IPC.
const platform: PlatformProvider = async () => {
  const preferences = await createBridgedKeyValueStore(host.preferences);
  const base = createBrowserPlatform({
    hostKind: 'electron',
    preferences,
    ...(devBuild ? { logLevel: 'debug', consoleLevel: 'debug' } : {}),
  });
  // Plain strings: the console-message capture in dev turns objects into "[object Object]".
  base.logger.info(`electron renderer platform ready (${preferences.keys().length} preferences)`);
  return {
    ...base,
    fileDialogs: createElectronFileDialogs(host),
    ...(assistantUrl
      ? {
          assistant: createHttpAssistantTransport({
            url: assistantUrl,
            ...(assistantToken ? { token: assistantToken } : {}),
          }),
        }
      : {}),
  };
};

createRoot(container).render(
  <StrictMode>
    <Studio platform={platform} />
  </StrictMode>,
);
