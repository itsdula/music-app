import '@studio/react/styles.css';
import './host.css';
import { createBrowserPlatform, createHttpAssistantTransport } from '@studio/platform-browser';
import { Studio } from '@studio/react';
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

// Web Audio, Web MIDI, IndexedDB, permissions etc. work unchanged in Chromium; only file
// dialogs go through the native bridge.
const browserPlatform = createBrowserPlatform({ hostKind: 'electron' });
const platform: typeof browserPlatform = {
  ...browserPlatform,
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

createRoot(container).render(
  <StrictMode>
    <Studio platform={platform} />
  </StrictMode>,
);
