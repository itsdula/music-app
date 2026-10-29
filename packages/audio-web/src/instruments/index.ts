import type { InstrumentConfig } from '@studio/domain';
import type { GraphContext } from '../graph/graph-context';
import { DrumKitInstrument } from './drums';
import type { Instrument } from './instrument';
import { SamplerInstrument } from './sampler';
import { SynthInstrument } from './synth';

export type { CancelOptions, Instrument, ScheduledNote } from './instrument';

/** Creates the instrument for a config (same code for realtime and offline graphs). */
export function createInstrument(g: GraphContext, config: InstrumentConfig): Instrument {
  switch (config.kind) {
    case 'synth':
      return new SynthInstrument(g, config);
    case 'drums':
      return new DrumKitInstrument(g, config);
    case 'sampler':
      return new SamplerInstrument(g, config);
  }
}
