import { StereoMeter } from '@studio/audio-ui';
import { useEngineMeterSource } from '../../lib/engine-meter-source';

/** Master output meter, painted from the render loop through an engine meter source. */
export function MasterMeter() {
  const source = useEngineMeterSource('master');
  return (
    <StereoMeter
      label="Master level"
      source={source}
      orientation="horizontal"
      className="h-7 w-28"
    />
  );
}
