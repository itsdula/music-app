import type { Track } from '@studio/domain';
import { useState } from 'react';
import { useSession } from '../../session/context';
import {
  activateBrowserItem,
  browserItemFromDrop,
  isBrowserItemDrag,
} from '../browser/activate-item';
import { EffectChain } from './EffectChain';
import { InstrumentPanel } from './InstrumentPanel';

/**
 * Device view for the selected track: instrument (if any) followed by its effect chain.
 * Effects dragged from the browser can be dropped anywhere on it.
 */
export function TrackDevicePanel({ track }: { track: Track }) {
  const session = useSession();
  const [dropHint, setDropHint] = useState(false);
  return (
    <div
      className={`flex min-h-0 flex-1 gap-2 overflow-x-auto p-2 ${dropHint ? 'ring-2 ring-accent/60 ring-inset' : ''}`}
      data-testid="track-devices"
      onDragOver={(e) => {
        if (!isBrowserItemDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropHint(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(false);
      }}
      onDrop={(e) => {
        setDropHint(false);
        const item = browserItemFromDrop(e);
        if (!item) return;
        e.preventDefault();
        activateBrowserItem(session, item, { trackId: track.id });
      }}
    >
      {track.instrument && <InstrumentPanel track={track} />}
      <EffectChain target={track.id} effects={track.effects} />
    </div>
  );
}
