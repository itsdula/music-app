import '@studio/react/styles.css';
import './host.css';
import { createBrowserPlatform } from '@studio/platform-browser';
import { Studio } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createElectronFileDialogs } from './file-dialogs';

const host = window.studioHost;
if (!host) throw new Error('window.studioHost is missing: the preload bridge did not load');

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// Web Audio, Web MIDI, IndexedDB, permissions etc. work unchanged in Chromium; only file
// dialogs go through the native bridge.
const browserPlatform = createBrowserPlatform({ hostKind: 'electron' });
const platform: typeof browserPlatform = {
  ...browserPlatform,
  fileDialogs: createElectronFileDialogs(host),
};

createRoot(container).render(
  <StrictMode>
    <Studio platform={platform} />
  </StrictMode>,
);
