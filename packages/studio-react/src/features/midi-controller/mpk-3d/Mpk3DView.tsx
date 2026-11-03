import { useCallback } from 'react';
import { useSession } from '../../../session/context';
import { Mpk3DCanvas } from './Mpk3DCanvas';
import { OLED_IDLE_TEXT } from './scene';

/**
 * Experimental read-only 3D view of the MPK Mini MK3 (see ./README.md). Mirrors live MIDI
 * activity from `session.midi.activity` and shows the last MIDI message on the OLED, both
 * read every frame outside React.
 */
export default function Mpk3DView({ className }: { className?: string }) {
  const session = useSession();
  const readActivity = useCallback(() => session.midi.activity, [session]);
  const readOledText = useCallback(() => {
    const events = session.midi.recentEvents();
    return events[events.length - 1]?.text ?? OLED_IDLE_TEXT;
  }, [session]);
  return (
    <Mpk3DCanvas className={className} readActivity={readActivity} readOledText={readOledText} />
  );
}
