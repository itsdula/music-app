/**
 * In-memory AudioEngine for session tests. Implements the port semantics that controllers
 * rely on (transport position, change application, live input, recording hooks, render
 * shape) with a manual clock — no Web Audio.
 */
import type {
  AudioEngine,
  AudioEngineCapabilities,
  AudioEngineEvent,
  AudioEngineListener,
  AudioGraphChange,
  EngineError,
  EngineLifecycleState,
  EngineSnapshot,
  MeterSnapshot,
  RecordedTake,
  RecordingOptions,
  RenderRequest,
  RenderedAudio,
  TransportPosition,
} from '@studio/audio-contracts';
import type { PcmAudio } from '@studio/audio-dsp';
import { PPQ, ticksToSeconds, type AssetId, type Project, type TrackId } from '@studio/domain';

export interface LiveCall {
  readonly kind: 'noteOn' | 'noteOff' | 'sustain' | 'pitchBend' | 'modulation' | 'allNotesOff';
  readonly trackId?: TrackId;
  readonly value?: number;
  readonly velocity?: number;
}

export class FakeAudioEngine implements AudioEngine {
  readonly kind = 'fake';
  lifecycle: EngineLifecycleState = 'uninitialized';
  project: Project | null = null;
  readonly changes: AudioGraphChange[][] = [];
  readonly live_calls: LiveCall[] = [];
  readonly overrides = new Map<AssetId, PcmAudio | null>();
  readonly renders: RenderRequest[] = [];
  nowSeconds = 0;
  private state: TransportPosition['state'] = 'stopped';
  private anchorTick = 0;
  private anchorTime = 0;
  private recording: RecordingOptions | null = null;
  private recordStartTick = 0;
  private readonly listeners = new Set<AudioEngineListener>();
  private capabilities: AudioEngineCapabilities | null = null;

  readonly live = {
    noteOn: (trackId: TrackId, pitch: number, velocity: number) =>
      this.live_calls.push({ kind: 'noteOn', trackId, value: pitch, velocity }),
    noteOff: (trackId: TrackId, pitch: number) =>
      this.live_calls.push({ kind: 'noteOff', trackId, value: pitch }),
    sustain: (trackId: TrackId, down: boolean) =>
      this.live_calls.push({ kind: 'sustain', trackId, value: down ? 1 : 0 }),
    pitchBend: (trackId: TrackId, value: number) =>
      this.live_calls.push({ kind: 'pitchBend', trackId, value }),
    modulation: (trackId: TrackId, value: number) =>
      this.live_calls.push({ kind: 'modulation', trackId, value }),
    allNotesOff: (trackId?: TrackId) =>
      this.live_calls.push({ kind: 'allNotesOff', ...(trackId ? { trackId } : {}) }),
  };

  private emit(event: AudioEngineEvent): void {
    for (const l of this.listeners) l(event);
  }

  async initialize(): Promise<AudioEngineCapabilities> {
    this.lifecycle = 'suspended';
    this.capabilities = {
      backend: 'fake',
      sampleRate: 48000,
      offlineRender: true,
      recording: true,
      inputMonitoring: true,
      baseLatencySeconds: 0.01,
      outputLatencySeconds: 0.02,
      maxRenderSeconds: 3600,
    };
    this.emit({ type: 'lifecycle', state: this.lifecycle });
    return this.capabilities;
  }
  async resume(): Promise<void> {
    this.lifecycle = 'running';
    this.emit({ type: 'lifecycle', state: 'running' });
  }
  getCapabilities() {
    return this.capabilities;
  }
  getLifecycleState() {
    return this.lifecycle;
  }
  async loadProject(snapshot: EngineSnapshot): Promise<void> {
    this.project = snapshot.project;
  }
  async applyChanges(changes: readonly AudioGraphChange[]): Promise<void> {
    this.changes.push([...changes]);
  }
  async setAssetOverride(assetId: AssetId, pcm: PcmAudio | null): Promise<void> {
    this.overrides.set(assetId, pcm);
  }
  private ticksPerSecond(): number {
    return ((this.project?.bpm ?? 120) * PPQ) / 60;
  }
  async play(fromTick?: number): Promise<void> {
    this.anchorTick = fromTick ?? this.anchorTick;
    this.anchorTime = this.nowSeconds;
    this.state = 'playing';
    this.emit({
      type: 'transport',
      transport: {
        state: 'playing',
        recording: this.recording !== null,
        positionTicks: this.anchorTick,
        bpm: this.project?.bpm ?? 120,
        loop: this.project!.loop,
      },
    });
  }
  async pause(): Promise<void> {
    this.anchorTick = this.getTransportPosition().ticks;
    this.state = 'paused';
  }
  async stop(): Promise<void> {
    this.state = 'stopped';
    this.anchorTime = this.nowSeconds;
  }
  async seek(tick: number): Promise<void> {
    this.anchorTick = tick;
    this.anchorTime = this.nowSeconds;
  }
  /** Advances the manual clock. */
  advance(seconds: number): void {
    this.nowSeconds += seconds;
  }
  getTransportPosition(): TransportPosition {
    const ticks =
      this.state === 'playing'
        ? this.anchorTick + (this.nowSeconds - this.anchorTime) * this.ticksPerSecond()
        : this.anchorTick;
    return {
      state: this.state,
      recording: this.recording !== null,
      ticks,
      engineTime: this.nowSeconds,
    };
  }
  readMeters(): MeterSnapshot {
    return { master: { peak: [0, 0], rms: [0, 0], clipped: false }, tracks: {} };
  }
  async listInputDevices() {
    return [{ deviceId: 'fake-mic', label: 'Fake microphone' }];
  }
  /** When set, the next startRecording fails like a denied microphone (error event + throw). */
  recordingError: EngineError | null = null;
  async startRecording(options: RecordingOptions): Promise<void> {
    if (this.recordingError) {
      const error = this.recordingError;
      this.recordingError = null;
      this.emit({ type: 'recording', status: { phase: 'error', message: error.message } });
      this.emit({ type: 'error', error });
      throw Object.assign(new Error(error.message), error);
    }
    this.recording = options;
    this.recordStartTick = this.getTransportPosition().ticks;
    this.emit({
      type: 'recording',
      status: {
        phase: 'recording',
        startedAtTick: this.recordStartTick,
        trackIds: options.trackIds,
      },
    });
  }
  async stopRecording(): Promise<RecordedTake[]> {
    const options = this.recording;
    this.recording = null;
    if (!options) return [];
    const seconds = ticksToSeconds(
      Math.max(0, this.getTransportPosition().ticks - this.recordStartTick),
      this.project?.bpm ?? 120,
    );
    const frames = Math.max(1, Math.round(seconds * 48000));
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i++) channel[i] = 0.25 * Math.sin((2 * Math.PI * 220 * i) / 48000);
    this.emit({ type: 'recording', status: { phase: 'idle' } });
    return options.trackIds.map((trackId) => ({
      trackId,
      pcm: { sampleRate: 48000, channels: [channel.slice()] },
      startTick: this.recordStartTick,
      latencyCompensationSeconds: 0.03,
      inputLabel: 'Fake microphone',
    }));
  }
  async setInputMonitoring(): Promise<void> {}
  async render(request: RenderRequest): Promise<RenderedAudio> {
    this.renders.push(request);
    const tail = request.tailSeconds === 'auto' ? 1 : request.tailSeconds;
    const seconds =
      ticksToSeconds(request.endTick - request.startTick, this.project?.bpm ?? 120) + tail;
    const frames = Math.round(seconds * request.sampleRate);
    const channels = Array.from({ length: request.channelCount }, () => new Float32Array(frames));
    return {
      pcm: { sampleRate: request.sampleRate, channels },
      startTick: request.startTick,
      endTick: request.endTick,
      tailSeconds: tail,
      peak: 0,
    };
  }
  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async dispose(): Promise<void> {
    this.lifecycle = 'closed';
  }
}
