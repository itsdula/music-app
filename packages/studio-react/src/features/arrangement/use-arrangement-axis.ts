import { useMemo } from 'react';
import { TimeAxis } from '../../canvas/time-axis';
import { useUiState } from '../../session/context';

export function useArrangementAxis(): TimeAxis {
  const pxPerTick = useUiState((s) => s.arrangement.pxPerTick);
  const scrollTick = useUiState((s) => s.arrangement.scrollTick);
  return useMemo(() => new TimeAxis(pxPerTick, scrollTick), [pxPerTick, scrollTick]);
}
