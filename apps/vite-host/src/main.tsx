import '@studio/react/styles.css';
import { Studio, type PlatformProvider } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * Optional AI assistant: set VITE_STUDIO_ASSISTANT_URL to a Studio `/api/assistant` endpoint
 * (and add this host's origin to the server's STUDIO_ASSISTANT_ALLOWED_ORIGINS). Unset, the
 * chat panel explains that no assistant is configured.
 */
const assistantUrl = import.meta.env.VITE_STUDIO_ASSISTANT_URL?.trim();
const assistantToken = import.meta.env.VITE_STUDIO_ASSISTANT_TOKEN?.trim();

/** Browser platform; UI preferences (theme, keymap, layout, toggles) live in localStorage. */
const platform: PlatformProvider = async () => {
  const { createBrowserPlatform, createHttpAssistantTransport, createLocalStorageKeyValueStore } =
    await import('@studio/platform-browser');
  const browserPlatform = createBrowserPlatform({
    preferences: createLocalStorageKeyValueStore(),
  });
  if (!assistantUrl) return browserPlatform;
  return {
    ...browserPlatform,
    assistant: createHttpAssistantTransport({
      url: assistantUrl,
      ...(assistantToken ? { token: assistantToken } : {}),
    }),
  };
};

createRoot(container).render(
  <StrictMode>
    <Studio platform={platform} />
  </StrictMode>,
);
