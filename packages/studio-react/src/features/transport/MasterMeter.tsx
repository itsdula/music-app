import { Meter, type MeterHandle } from '@studio/ui';
import { useRef } from 'react';
import { useFrame } from '../../lib/use-frame';
import { useSession } from '../../session/context';

/** Master output meter driven from the render loop via the Meter imperative handle. */
export function MasterMeter() {
  const session = useSession();
  const meterRef = useRef<MeterHandle>(null);
  useFrame(() => {
    const meters = session.engine.readMeters();
    meterRef.current?.setLevels(meters.master.peak, meters.master.clipped);
  });
  return (
    <Meter
      ref={meterRef}
      label="Master level"
      orientation="horizontal"
      channels={2}
      className="h-7 w-28"
    />
  );
}
