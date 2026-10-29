/**
 * Instrument contract shared by the synth, drum kit and sampler. Times are AudioContext
 * seconds. Transport notes arrive with both on and off times (scheduled ahead by the
 * lookahead scheduler); live notes arrive as separate on/off calls at "now".
 */
import type { ClipId, InstrumentConfig, InstrumentKind } from '@studio/domain';

export interface ScheduledNote {
  readonly pitch: number;
  readonly velocity: number;
  readonly onTime: number;
  readonly offTime: number;
  readonly clipId?: ClipId;
}

export interface CancelOptions {
  /** Only voices started by these clips (default: all transport voices). */
  readonly clipIds?: ReadonlySet<ClipId>;
  /** Leave sounding voices alone; only drop voices that have not started yet. */
  readonly onlyUnstarted?: boolean;
}

export interface Instrument {
  readonly kind: InstrumentKind;
  /** Instrument output (level applied); connected to the track channel input. */
  readonly output: AudioNode;
  scheduleNote(note: ScheduledNote): void;
  noteOn(pitch: number, velocity: number, time: number): void;
  noteOff(pitch: number, time: number): void;
  pitchBend(value: number, time: number): void;
  modulation(value: number, time: number): void;
  /** Transport voices: unstarted ones are dropped; sounding ones fade out quickly. */
  cancelTransport(time: number, options?: CancelOptions): void;
  /** Releases every live voice with its normal release. */
  releaseLive(time: number): void;
  update(config: InstrumentConfig): void;
  activeVoiceCount(): number;
  dispose(): void;
}

/** Common voice bookkeeping. */
export interface VoiceRecord {
  readonly id: number;
  pitch: number;
  readonly startTime: number;
  /** Time the voice is silent and stopped; +∞ while a live note is held. */
  endTime: number;
  readonly transport: boolean;
  readonly clipId?: ClipId;
}
