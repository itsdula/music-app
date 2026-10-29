import '@fontsource-variable/inter';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Studio — a local-first music workstation',
  description:
    'Studio is a browser-based, local-first digital audio workstation with MIDI instruments, recording, mixing, AKAI MPK Mini MK3 support and a pitch-aware vocal editor.',
};

export const viewport: Viewport = {
  themeColor: '#111318',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
