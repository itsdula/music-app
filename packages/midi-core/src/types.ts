/**
 * Semantic events and mapping effects exchanged between midi-core and the application.
 */
import type { MappingTarget, MidiMapping, ParameterAddress, StudioActionId } from '@studio/domain';
import type { DeviceControlEvent } from './device-profile';
import type { MidiMessage } from './messages';

/** A validated message annotated with where it came from. */
export interface MidiInputEvent {
  readonly portId: string;
  readonly portName: string;
  /** Matched device profile, when any. */
  readonly profileId?: string;
  readonly message: MidiMessage;
  readonly timestampMs: number;
  /** Physical control identified by the device profile, when any. */
  readonly control?: DeviceControlEvent;
}

export type MappingEffect =
  | {
      readonly kind: 'setParameter';
      readonly mappingId: MidiMapping['id'];
      readonly address: ParameterAddress;
      /** Target value in normalized parameter space 0..1. */
      readonly normalized: number;
    }
  | {
      readonly kind: 'action';
      readonly mappingId: MidiMapping['id'];
      readonly action: StudioActionId;
      /** 1 = pressed/triggered, 0 = released (gate behaviour). */
      readonly value: number;
    };

/** Read access to current parameter values, needed for pickup/relative modes. */
export interface ParameterValueReader {
  /** Current normalized value of a parameter, or undefined if it does not exist. */
  getNormalized(address: ParameterAddress): number | undefined;
}

export type MidiLearnState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'listening'; readonly target: MappingTarget; readonly startedAtMs: number }
  | {
      readonly phase: 'captured';
      readonly target: MappingTarget;
      readonly mapping: Omit<MidiMapping, 'id'>;
    };
