'use client';

import '@studio/react/styles.css';
import dynamic from 'next/dynamic';
import { completeAssistant } from '../actions/assistant';

// Studio touches window, Web Audio, Web MIDI and IndexedDB, so it renders client-only.
const Studio = dynamic(() => import('@studio/react').then((m) => m.Studio), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-surface-0" aria-busy="true" />,
});

/**
 * Browser platform plus the AI assistant route: each chat turn calls the `completeAssistant`
 * server action, which holds the OpenRouter key. Loaded lazily (client-only, like Studio).
 */
async function createPlatform() {
  const { createBrowserPlatform, createResultAssistantTransport } =
    await import('@studio/platform-browser');
  const platform = createBrowserPlatform();
  return { ...platform, assistant: createResultAssistantTransport(completeAssistant) };
}

export function StudioClient() {
  return (
    <div className="h-dvh w-full">
      <Studio platform={createPlatform} />
    </div>
  );
}
