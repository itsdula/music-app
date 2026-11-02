import '@studio/react/styles.css';
import { Studio, type PlatformProvider } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * Browser platform; UI preferences (theme, keymap, layout, toggles) live in this origin's
 * localStorage. The site is static (GitHub Pages), so there is no assistant endpoint and no
 * transport is passed: the chat panel explains that the assistant is unavailable. Loaded
 * lazily so the platform's workers and Web Audio code are fetched with the Studio chunk.
 */
const platform: PlatformProvider = async () => {
  const { createBrowserPlatform, createLocalStorageKeyValueStore } =
    await import('@studio/platform-browser');
  return createBrowserPlatform({ preferences: createLocalStorageKeyValueStore() });
};

createRoot(container).render(
  <StrictMode>
    <Studio platform={platform} />
  </StrictMode>,
);
