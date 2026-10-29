'use client';

import '@studio/react/styles.css';
import dynamic from 'next/dynamic';

// Studio touches window, Web Audio, Web MIDI and IndexedDB, so it renders client-only.
const Studio = dynamic(() => import('@studio/react').then((m) => m.Studio), {
  ssr: false,
  loading: () => <div className="h-dvh w-full bg-surface-0" aria-busy="true" />,
});

export function StudioClient() {
  return (
    <div className="h-dvh w-full">
      <Studio />
    </div>
  );
}
