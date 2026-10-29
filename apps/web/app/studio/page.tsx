import type { Metadata } from 'next';
import { StudioClient } from './studio-client';

export const metadata: Metadata = { title: 'Studio' };

/** Intentionally thin: all DAW logic lives in the portable @studio/react package. */
export default function StudioPage() {
  return <StudioClient />;
}
