import type { AudioClip } from '@studio/domain';
import { EmptyState } from '@studio/ui';
import { Mic } from 'lucide-react';

/** Vocal pitch editor — integrated after the vocal DSP workstream lands. */
export function VocalEditor({ clip }: { clip: AudioClip }) {
  return (
    <div className="flex flex-1 items-center justify-center" data-clip-id={clip.id}>
      <EmptyState icon={<Mic />} title="Vocal editor" description="Pitch analysis and correction are being integrated." />
    </div>
  );
}
