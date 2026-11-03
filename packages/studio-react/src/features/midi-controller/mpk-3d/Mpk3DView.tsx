import { useCallback } from 'react';
import { useSession } from '../../../session/context';
import { Mpk3DCanvas } from './Mpk3DCanvas';

/**
 * Experimental read-only 3D view of the MPK Mini MK3 (see ./README.md). Mirrors live MIDI
 * activity from `session.midi.activity`, read every frame outside React.
 */
export default function Mpk3DView({ className }: { className?: string }) {
  const session = useSession();
  const readActivity = useCallback(() => session.midi.activity, [session]);
  return <Mpk3DCanvas className={className} readActivity={readActivity} />;
}
