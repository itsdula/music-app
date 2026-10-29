import '@studio/react/styles.css';
import { Studio, type PlatformProvider } from '@studio/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

/**
 * Optional AI assistant: set VITE_STUDIO_ASSISTANT_URL to a Studio `/api/assistant` endpoint
 * (and add this host's origin to the server's STUDIO_ASSISTANT_ALLOWED_ORIGINS). Unset, Studio
 * uses its default browser platform without an assistant.
 */
const assistantUrl = import.meta.env.VITE_STUDIO_ASSISTANT_URL?.trim();
const assistantToken = import.meta.env.VITE_STUDIO_ASSISTANT_TOKEN?.trim();

const platform: PlatformProvider | undefined = assistantUrl
  ? async () => {
      const { createBrowserPlatform, createHttpAssistantTransport } =
        await import('@studio/platform-browser');
      return {
        ...createBrowserPlatform(),
        assistant: createHttpAssistantTransport({
          url: assistantUrl,
          ...(assistantToken ? { token: assistantToken } : {}),
        }),
      };
    }
  : undefined;

createRoot(container).render(
  <StrictMode>
    <Studio {...(platform ? { platform } : {})} />
  </StrictMode>,
);
