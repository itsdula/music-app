/**
 * Backend-neutral audio engine port.
 *
 * The browser implementation lives in @studio/audio-web (Web Audio). A future native
 * implementation (Rust via Tauri/WASM) must honour the same *semantic* contract — it does
 * not mimic Web Audio nodes. All methods are async-capable so an IPC-backed adapter can
 * implement them; the Web Audio adapter resolves immediately where possible.
 *
 * Clock domains (never mix them):
 * - musical time: integer ticks (domain `PPQ`), the unit of transport position;
 * - engine time: the backend's audio clock in seconds (AudioContext.currentTime in browsers);
 * - host time: high-resolution host clock in ms (performance.now(), MIDI timestamps);
 * - frame time: requestAnimationFrame timestamps — UI only, never used for scheduling.
 */
import type { PcmAudio } from '@studio/audio-dsp';
import type { AssetId, LoopRegion, Project, TrackId } from '@studio/domain';
import type { AudioGraphChange } from './changes';

export type EngineLifecycleState = 'uninitialized' | 'suspended' | 'running' | 'closed' | 'error';

export type TransportPlayState = 'stopped' | 'playing' | 'paused';

export interface AudioEngineCapabilities {
  readonly backend: string;
  readonly sampleRate: number;
  readonly offlineRender: boolean;
  readonly recording: boolean;
  readonly inputMonitoring: boolean;
  /** Processing latency reported by the backend, when known. */
  readonly baseLatencySeconds: number | null;
  /** Output (device) latency reported by the backend, when known. */
  readonly outputLatencySeconds: number | null;
  readonly maxRenderSeconds: number;
}

export interface TransportSnapshot {
  readonly state: TransportPlayState;
  readonly recording: boolean;
  /** Position when the snapshot was taken. */
  readonly positionTicks: number;
  readonly bpm: number;
  readonly loop: LoopRegion;
}

/** Cheap, poll-friendly position used by rAF-driven UI (playhead, counters). */
export interface TransportPosition {
  readonly state: TransportPlayState;
  readonly recording: boolean;
  /** Current musical position, fractional ticks, loop-wrapped. */
  readonly ticks: number;
  /** Engine clock time this position corresponds to (seconds). */
  readonly engineTime: number;
}

export interface ChannelMeter {
  /** Linear peak amplitude per channel since the previous read (1.0 = 0 dBFS). */
  readonly peak: readonly number[];
  /** Linear RMS per channel over the analysis window. */
  readonly rms: readonly number[];
  /** True if any sample reached or exceeded full scale since the previous read. */
  readonly clipped: boolean;
}

export interface MeterSnapshot {
  readonly master: ChannelMeter;
  readonly tracks: Readonly<Record<TrackId, ChannelMeter>>;
}

export interface EngineSnapshot {
  readonly project: Project;
}

export interface RenderRequest {
  /** Inclusive start, exclusive end, in ticks. */
  readonly startTick: number;
  readonly endTick: number;
  readonly sampleRate: 44100 | 48000;
  readonly channelCount: 1 | 2;
  /** Extra seconds rendered after endTick for reverb/delay tails. `'auto'` estimates from effects. */
  readonly tailSeconds: number | 'auto';
  readonly includeMetronome: boolean;
}

export interface RenderedAudio {
  readonly pcm: PcmAudio;
  readonly startTick: number;
  readonly endTick: number;
  readonly tailSeconds: number;
  /** Peak sample magnitude across channels (linear). */
  readonly peak: number;
}

export interface RenderProgress {
  readonly fraction: number;
}

export interface AudioInputDevice {
  readonly deviceId: string;
  readonly label: string;
}

export interface RecordingOptions {
  readonly trackIds: readonly TrackId[];
  readonly deviceId?: string;
  readonly channelCount: 1 | 2;
  /**
   * Seconds subtracted from the take position to compensate input + output latency.
   * When omitted the backend applies its best estimate and reports it on the take.
   */
  readonly latencyCompensationSeconds?: number;
}

export interface RecordedTake {
  readonly trackId: TrackId;
  readonly pcm: PcmAudio;
  /** Timeline position of the first sample after latency compensation (fractional ticks). */
  readonly startTick: number;
  readonly latencyCompensationSeconds: number;
  readonly inputLabel: string;
}

export type RecordingStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'requesting-permission' }
  | {
      readonly phase: 'recording';
      readonly startedAtTick: number;
      readonly trackIds: readonly TrackId[];
    }
  | { readonly phase: 'finalizing' }
  | { readonly phase: 'error'; readonly message: string };

export type EngineErrorCode =
  | 'context-unavailable'
  | 'context-suspended'
  | 'asset-missing'
  | 'asset-decode-failed'
  | 'microphone-denied'
  | 'microphone-unavailable'
  | 'render-failed'
  | 'render-cancelled'
  | 'worklet-failed'
  | 'internal';

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
  readonly detail?: string;
}

export type AudioEngineEvent =
  | { readonly type: 'lifecycle'; readonly state: EngineLifecycleState }
  | { readonly type: 'transport'; readonly transport: TransportSnapshot }
  | { readonly type: 'recording'; readonly status: RecordingStatus }
  | {
      readonly type: 'asset';
      readonly assetId: AssetId;
      readonly status: 'loading' | 'ready' | 'error';
      readonly message?: string;
    }
  | { readonly type: 'error'; readonly error: EngineError };

export type AudioEngineListener = (event: AudioEngineEvent) => void;

/** Low-latency path for live MIDI input and auditioning (bypasses the timeline). */
export interface LiveInputPort {
  noteOn(trackId: TrackId, pitch: number, velocity: number): void;
  noteOff(trackId: TrackId, pitch: number): void;
  /** 0..1 sustain (CC64 >= 64 means down). */
  sustain(trackId: TrackId, down: boolean): void;
  /** -1..1 normalized pitch bend; range in semitones is instrument-defined (default ±2). */
  pitchBend(trackId: TrackId, value: number): void;
  /** 0..1 modulation wheel. */
  modulation(trackId: TrackId, value: number): void;
  allNotesOff(trackId?: TrackId): void;
}

/** Source of decoded PCM for asset IDs (implemented by the host session's asset cache). */
export interface AssetPcmSource {
  load(assetId: AssetId): Promise<PcmAudio>;
}

export interface AudioEngine {
  readonly kind: string;

  /** Creates backend resources. May leave the engine 'suspended' until `resume()`. */
  initialize(): Promise<AudioEngineCapabilities>;
  /** Must be called from a user gesture in browsers (autoplay policy). */
  resume(): Promise<void>;
  getCapabilities(): AudioEngineCapabilities | null;
  getLifecycleState(): EngineLifecycleState;

  /** Replaces the whole engine state (project open/load). Resolves when assets are ready. */
  loadProject(snapshot: EngineSnapshot): Promise<void>;
  /** Applies incremental changes produced by `diffProjects` (engine-core). */
  applyChanges(changes: readonly AudioGraphChange[]): Promise<void>;
  /** Plays `pcm` instead of the asset's own audio wherever the asset is used (null restores). */
  setAssetOverride(assetId: AssetId, pcm: PcmAudio | null): Promise<void>;

  play(fromTick?: number): Promise<void>;
  pause(): Promise<void>;
  /** Stops and returns to the last play-start position (or 0). */
  stop(): Promise<void>;
  seek(tick: number): Promise<void>;
  getTransportPosition(): TransportPosition;

  readMeters(): MeterSnapshot;
  readonly live: LiveInputPort;

  listInputDevices(): Promise<AudioInputDevice[]>;
  startRecording(options: RecordingOptions): Promise<void>;
  stopRecording(): Promise<RecordedTake[]>;
  setInputMonitoring(trackId: TrackId, enabled: boolean): Promise<void>;

  render(
    request: RenderRequest,
    options?: {
      readonly signal?: AbortSignalLike;
      readonly onProgress?: (p: RenderProgress) => void;
    },
  ): Promise<RenderedAudio>;

  subscribe(listener: AudioEngineListener): () => void;
  dispose(): Promise<void>;
}

export interface AudioBackendConfig {
  readonly assets: AssetPcmSource;
  readonly latencyHint?: 'interactive' | 'balanced' | 'playback';
  readonly sampleRate?: number;
  readonly logger?: EngineLogger;
}

export interface AudioBackendFactory {
  readonly kind: string;
  isSupported(): boolean;
  create(config: AudioBackendConfig): AudioEngine;
}

export interface EngineLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

/** Structural subset of DOM AbortSignal so portable packages need no DOM typings. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
