import { useMemo } from 'react';
import { TimeAxis } from '../../canvas/time-axis';
import { useUiState } from '../../session/context';
import type { PitchAxis } from './geometry';

export function usePianoRollAxes(): { time: TimeAxis; pitch: PitchAxis } {
  const pxPerTick = useUiState((s) => s.pianoRoll.pxPerTick);
  const scrollTick = useUiState((s) => s.pianoRoll.scrollTick);
  const topPitch = useUiState((s) => s.pianoRoll.topPitch);
  const rowHeight = useUiState((s) => s.pianoRoll.rowHeight);
  const time = useMemo(() => new TimeAxis(pxPerTick, scrollTick), [pxPerTick, scrollTick]);
  const pitch = useMemo(() => ({ topPitch, rowHeight }), [topPitch, rowHeight]);
  return { time, pitch };
}
