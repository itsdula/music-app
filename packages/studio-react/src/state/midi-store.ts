import type { MidiMapping } from '@studio/domain';
import type { MidiAccessStatus, MidiLearnState, VelocityCurve } from '@studio/midi-core';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface MidiDeviceView {
  readonly portId: string;
  readonly name: string;
  readonly displayName: string;
  readonly manufacturer: string | undefined;
  readonly type: 'input' | 'output';
  readonly state: 'connected' | 'disconnected';
  readonly profileId: string | undefined;
  readonly profileName: string | undefined;
}

export interface MidiStoreState {
  readonly supported: boolean;
  readonly status: MidiAccessStatus;
  readonly devices: readonly MidiDeviceView[];
  readonly learn: MidiLearnState;
  readonly globalMappings: readonly MidiMapping[];
  readonly velocityCurve: VelocityCurve;
  /** Software transpose applied to all incoming notes (semitones). */
  readonly transpose: number;
  readonly lastError: string | null;
}

export type MidiStore = StoreApi<MidiStoreState>;

export function createMidiStore(supported: boolean): MidiStore {
  return createStore<MidiStoreState>()(() => ({
    supported,
    status: supported ? 'idle' : 'unsupported',
    devices: [],
    learn: { phase: 'idle' },
    globalMappings: [],
    velocityCurve: 'linear',
    transpose: 0,
    lastError: null,
  }));
}
