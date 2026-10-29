/**
 * Web Audio implementation of the AudioEngine port.
 *
 * Clocks: the transport position is derived from AudioContext.currentTime through an
 * engine-core TransportClock anchor; a Worker heartbeat (every 25 ms) wakes the
 * lookahead scheduler, which plans the next 120 ms in the clock's unwrapped tick
 * coordinate and turns it into sample-accurate Web Audio events. Nothing here depends on
 * React, requestAnimationFrame or wall-clock UI timers.
 */
import type {
  AudioBackendConfig,
  AudioEngine,
  AudioEngineCapabilities,
  AudioEngineEvent,
  AudioEngineListener,
  AudioGraphChange,
  AudioInputDevice,
  AbortSignalLike,
  ChannelMeter,
  EngineLifecycleState,
  EngineLogger,
  EngineSnapshot,
  LiveInputPort,
  MeterSnapshot,
  RecordedTake,
  RecordingOptions,
  RecordingStatus,
  RenderProgress,
  RenderRequest,
  RenderedAudio,
  TransportPlayState,
  TransportPosition,
  TransportSnapshot,
} from '@studio/audio-contracts';
import type { PcmAudio } from '@studio/audio-dsp';
import type { AssetId, ClipId, LoopRegion, TrackId } from '@studio/domain';
import {
  SustainPedal,
  createTransportClock,
  planScheduleSegments,
  rebaseClock,
  tickAtTime,
  unwrappedTickAtTime,
  type TransportClock,
} from '@studio/engine-core';
import { AssetBufferStore } from './assets';
import {
  LOOKAHEAD_SECONDS,
  MAX_RENDER_SECONDS,
  MIN_LEAD_SECONDS,
  SCHEDULER_INTERVAL_MS,
  START_DELAY_SECONDS,
} from './constants';
import { AudioEngineError, SILENT_LOGGER, describeError, microphoneError } from './errors';
import { STUDIO_WORKLET_SOURCE } from './generated/inline-bundles';
import { createGraphContext, type DisposableGraphContext } from './graph/graph-context';
import { ProjectGraph } from './graph/project-graph';
import type { Instrument } from './instruments';
import { EngineModel } from './model';
import { InputManager, type AudioInputHandle } from './recording/input';
import { RecorderSession } from './recording/recorder';
import { renderOffline } from './render';
import { EventScheduler } from './scheduler/event-scheduler';
import { Heartbeat, type HeartbeatMode } from './scheduler/heartbeat';

export interface WebAudioBackendOptions {
  /** Drive the scheduler from a Worker timer (default true); false forces setInterval. */
  readonly useWorkerClock?: boolean;
  /** Custom AudioContext construction (e.g. a specific sink); defaults to `new AudioContext`. */
  readonly createContext?: (options: AudioContextOptions) => AudioContext;
}

export interface EngineDiagnostics {
  readonly heartbeat: HeartbeatMode | null;
  readonly workletReady: boolean;
  readonly schedulerTicks: number;
  readonly schedulerAvgMs: number;
  readonly schedulerMaxMs: number;
  readonly lateEventsDropped: number;
  readonly activeVoices: number;
  readonly contextState: string;
}

const SILENT_METER: ChannelMeter = { peak: [0, 0], rms: [0, 0], clipped: false };

interface ActiveRecording {
  readonly session: RecorderSession;
  readonly input: AudioInputHandle;
  readonly options: RecordingOptions;
  readonly clock: TransportClock;
  readonly startedAtTick: number;
}

export class WebAudioEngine implements AudioEngine {
  readonly kind = 'web-audio';
  readonly live: LiveInputPort;
  private readonly logger: EngineLogger;
  private readonly assets: AssetBufferStore;
  private readonly listeners = new Set<AudioEngineListener>();
  private ctx: AudioContext | null = null;
  private g: DisposableGraphContext | null = null;
  private graph: ProjectGraph | null = null;
  private scheduler: EventScheduler | null = null;
  private model: EngineModel | null = null;
  private heartbeat: Heartbeat | null = null;
  private inputs: InputManager | null = null;
  private lifecycle: EngineLifecycleState = 'uninitialized';
  private capabilities: AudioEngineCapabilities | null = null;
  private workletReady = false;
  private initPromise: Promise<AudioEngineCapabilities> | null = null;

  private playState: TransportPlayState = 'stopped';
  private clock: TransportClock | null = null;
  private positionTick = 0;
  private playStartTick = 0;
  private scheduledUntilU = 0;
  private needsDiscontinuity = false;
  private readonly resync = new Map<TrackId, Set<ClipId> | 'all'>();

  private recording: ActiveRecording | null = null;
  private recordingStatus: RecordingStatus = { phase: 'idle' };
  private readonly monitors = new Map<TrackId, AudioInputHandle>();
  private readonly pedals = new Map<TrackId, SustainPedal>();

  private stats = { ticks: 0, totalMs: 0, maxMs: 0, lateDropped: 0 };

  constructor(
    private readonly config: AudioBackendConfig,
    private readonly options: WebAudioBackendOptions = {},
  ) {
    this.logger = config.logger ?? SILENT_LOGGER;
    this.assets = new AssetBufferStore(config.assets, (event) => this.emit(event), this.logger);
    this.live = this.createLivePort();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  initialize(): Promise<AudioEngineCapabilities> {
    if (this.capabilities) return Promise.resolve(this.capabilities);
    this.initPromise ??= this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<AudioEngineCapabilities> {
    if (this.lifecycle === 'closed')
      throw new AudioEngineError('context-unavailable', 'Engine was disposed');
    if (typeof AudioContext === 'undefined') {
      this.setLifecycle('error');
      throw new AudioEngineError(
        'context-unavailable',
        'Web Audio is not available in this environment',
      );
    }
    let ctx: AudioContext;
    try {
      const contextOptions: AudioContextOptions = {
        latencyHint: this.config.latencyHint ?? 'interactive',
        ...(this.config.sampleRate ? { sampleRate: this.config.sampleRate } : {}),
      };
      ctx = this.options.createContext?.(contextOptions) ?? new AudioContext(contextOptions);
    } catch (error) {
      this.setLifecycle('error');
      throw new AudioEngineError(
        'context-unavailable',
        'Could not create an AudioContext',
        describeError(error),
      );
    }
    this.ctx = ctx;
    ctx.onstatechange = () => this.syncLifecycle();
    this.workletReady = await this.loadWorklet(ctx);
    this.g = createGraphContext({
      ctx,
      realtime: true,
      logger: this.logger,
      assets: this.assets,
      workletReady: this.workletReady,
    });
    this.heartbeat = new Heartbeat(
      SCHEDULER_INTERVAL_MS,
      () => this.tick(),
      this.logger,
      this.options.useWorkerClock ?? true,
    );
    this.inputs = new InputManager(ctx);
    if (this.model) this.buildGraph();
    const hasGetUserMedia =
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function';
    this.capabilities = {
      backend: 'web-audio',
      sampleRate: ctx.sampleRate,
      offlineRender: typeof OfflineAudioContext !== 'undefined',
      recording: this.workletReady && hasGetUserMedia,
      inputMonitoring: hasGetUserMedia,
      baseLatencySeconds: typeof ctx.baseLatency === 'number' ? ctx.baseLatency : null,
      outputLatencySeconds: typeof ctx.outputLatency === 'number' ? ctx.outputLatency : null,
      maxRenderSeconds: MAX_RENDER_SECONDS,
    };
    this.syncLifecycle();
    return this.capabilities;
  }

  private async loadWorklet(ctx: AudioContext): Promise<boolean> {
    if (!ctx.audioWorklet) {
      this.logger.warn(
        'AudioWorklet unavailable: meters fall back to AnalyserNode, recording disabled',
      );
      return false;
    }
    const url = URL.createObjectURL(new Blob([STUDIO_WORKLET_SOURCE], { type: 'text/javascript' }));
    try {
      await ctx.audioWorklet.addModule(url);
      return true;
    } catch (error) {
      this.logger.warn('AudioWorklet module failed to load', { error: describeError(error) });
      this.emit({
        type: 'error',
        error: {
          code: 'worklet-failed',
          message: 'Audio worklet failed to load',
          detail: describeError(error),
        },
      });
      return false;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async resume(): Promise<void> {
    await this.initialize();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume();
    this.syncLifecycle();
  }

  getCapabilities(): AudioEngineCapabilities | null {
    return this.capabilities;
  }

  getLifecycleState(): EngineLifecycleState {
    return this.lifecycle;
  }

  private syncLifecycle(): void {
    if (!this.ctx || this.lifecycle === 'closed') return;
    const state = this.ctx.state;
    this.setLifecycle(
      state === 'running' ? 'running' : state === 'closed' ? 'closed' : 'suspended',
    );
  }

  private setLifecycle(state: EngineLifecycleState): void {
    if (state === this.lifecycle) return;
    this.lifecycle = state;
    this.emit({ type: 'lifecycle', state });
  }

  subscribe(listener: AudioEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: AudioEngineEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.logger.error('engine listener threw', { error: describeError(error) });
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.lifecycle === 'closed') return;
    this.heartbeat?.dispose();
    this.heartbeat = null;
    this.recording?.session.dispose();
    this.recording = null;
    this.inputs?.dispose();
    this.monitors.clear();
    this.graph?.dispose();
    this.graph = null;
    this.g?.dispose();
    this.assets.clear();
    const ctx = this.ctx;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') await ctx.close().catch(() => undefined);
    }
    this.setLifecycle('closed');
    this.listeners.clear();
  }

  /** Scheduler and voice statistics (not part of the port; used for diagnostics and benchmarks). */
  getDiagnostics(): EngineDiagnostics {
    return {
      heartbeat: this.heartbeat?.mode ?? null,
      workletReady: this.workletReady,
      schedulerTicks: this.stats.ticks,
      schedulerAvgMs: this.stats.ticks > 0 ? this.stats.totalMs / this.stats.ticks : 0,
      schedulerMaxMs: this.stats.maxMs,
      lateEventsDropped: this.stats.lateDropped,
      activeVoices: this.graph?.activeVoiceCount() ?? 0,
      contextState: this.ctx?.state ?? 'none',
    };
  }

  /** Resets scheduler statistics. */
  resetDiagnostics(): void {
    this.stats = { ticks: 0, totalMs: 0, maxMs: 0, lateDropped: 0 };
  }

  // ---------------------------------------------------------------------------
  // Project state
  // ---------------------------------------------------------------------------

  async loadProject(snapshot: EngineSnapshot): Promise<void> {
    if (this.playState === 'playing') this.haltRun();
    this.playState = 'stopped';
    this.positionTick = 0;
    this.playStartTick = 0;
    this.model = new EngineModel(snapshot.project);
    if (this.g) this.buildGraph();
    await Promise.all([...this.model.referencedAssets()].map((id) => this.assets.ensure(id)));
    this.emitTransport();
  }

  private buildGraph(): void {
    if (!this.g || !this.model) return;
    this.graph?.dispose();
    this.graph = new ProjectGraph(this.g, {
      tracks: this.model.orderedTracks(),
      master: this.model.master,
      metronome: this.model.metronome,
      meters: true,
    });
    this.scheduler = new EventScheduler(this.graph, this.model, this.assets);
    for (const [trackId, handle] of this.monitors)
      this.graph.channel(trackId)?.setMonitorInput(handle.source);
  }

  private requireModel(): EngineModel {
    if (!this.model)
      throw new AudioEngineError('internal', 'No project loaded (call loadProject first)');
    return this.model;
  }

  async applyChanges(changes: readonly AudioGraphChange[]): Promise<void> {
    const model = this.requireModel();
    const graph = this.graph;
    const assetLoads: AssetId[] = [];
    let replan: { bpm?: number; loop?: LoopRegion } | null = null;
    let transportChanged = false;
    for (const change of changes) {
      const touched = model.apply(change);
      switch (change.type) {
        case 'tempo':
          replan = { ...(replan ?? {}), bpm: change.bpm };
          transportChanged = true;
          break;
        case 'loop':
          replan = { ...(replan ?? {}), loop: change.loop };
          transportChanged = true;
          break;
        case 'meter':
          break;
        case 'metronome':
          graph?.metronome.setGain(change.metronome.gainDb);
          if (!change.metronome.enabled && this.ctx) graph?.metronome.cancel(this.ctx.currentTime);
          break;
        case 'track.add':
          graph?.addTrack(change.track);
          if (change.track.instrument?.sampleAssetId)
            assetLoads.push(change.track.instrument.sampleAssetId);
          this.markResync(change.track.id, 'all');
          break;
        case 'track.update': {
          graph?.updateTrack(change.track);
          const before = change.previous.instrument;
          const after = change.track.instrument;
          if (after?.sampleAssetId && after.sampleAssetId !== before?.sampleAssetId)
            assetLoads.push(after.sampleAssetId);
          if (before?.kind !== after?.kind) this.markResync(change.track.id, 'all');
          break;
        }
        case 'track.remove':
          graph?.removeTrack(change.trackId);
          this.stopMonitoring(change.trackId);
          this.pedals.delete(change.trackId);
          this.resync.delete(change.trackId);
          break;
        case 'track.order':
          break;
        case 'clip.add':
          if (change.clip.kind === 'audio') assetLoads.push(change.clip.assetId);
          this.markResync(change.clip.trackId, change.clip.id);
          break;
        case 'clip.update':
          if (change.clip.kind === 'audio') assetLoads.push(change.clip.assetId);
          this.markResync(change.clip.trackId, change.clip.id);
          if (change.previous.trackId !== change.clip.trackId)
            this.markResync(change.previous.trackId, change.clip.id);
          break;
        case 'clip.remove':
          this.markResync(change.trackId, change.clipId);
          // Sounding notes of a deleted clip stop now (edits of an existing clip let them ring).
          if (this.ctx)
            graph
              ?.channel(change.trackId)
              ?.cancelTransport(this.ctx.currentTime, { clipIds: new Set([change.clipId]) });
          break;
        case 'master.update':
          graph?.updateMaster(change.master);
          break;
        case 'asset.add':
          if (model.referencedAssets().has(change.asset.id)) assetLoads.push(change.asset.id);
          for (const id of touched) this.markResync(id, 'all');
          break;
        case 'asset.remove':
          this.assets.remove(change.assetId);
          for (const id of touched) this.markResync(id, 'all');
          break;
      }
    }
    if (replan && this.playState === 'playing') this.replan(replan);
    if (transportChanged) this.emitTransport();
    if (this.playState === 'playing') this.tick();
    if (assetLoads.length > 0) {
      await Promise.all([...new Set(assetLoads)].map((id) => this.assets.ensure(id)));
      if (this.playState === 'playing') {
        // Audio that was skipped while its buffer was missing starts now.
        for (const clip of model.clips.values()) {
          if (clip.kind === 'audio' && assetLoads.includes(clip.assetId))
            this.markResync(clip.trackId, clip.id);
        }
        this.tick();
      }
    }
  }

  async setAssetOverride(assetId: AssetId, pcm: PcmAudio | null): Promise<void> {
    this.assets.setOverride(assetId, pcm);
    const model = this.model;
    if (!model || this.playState !== 'playing') return;
    // Sounding sources of this asset are faded out and restarted from the current position.
    for (const clip of model.clips.values()) {
      if (clip.kind === 'audio' && clip.assetId === assetId) this.markResync(clip.trackId, clip.id);
    }
    this.tick();
    return Promise.resolve();
  }

  private markResync(trackId: TrackId, scope: ClipId | 'all'): void {
    if (this.playState !== 'playing') return;
    const current = this.resync.get(trackId);
    if (scope === 'all' || current === 'all') {
      this.resync.set(trackId, 'all');
      return;
    }
    if (current) current.add(scope);
    else this.resync.set(trackId, new Set([scope]));
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  async play(fromTick?: number): Promise<void> {
    await this.initialize();
    const ctx = this.ctx!;
    if (!this.model) this.requireModel();
    if (!this.graph) this.buildGraph();
    if (ctx.state === 'suspended') {
      ctx
        .resume()
        .catch((error: unknown) =>
          this.logger.warn('resume() failed', { error: describeError(error) }),
        );
    }
    if (this.playState === 'playing') {
      if (fromTick === undefined) return;
      this.stopSounds();
    }
    const start = fromTick ?? this.positionTick;
    // Resuming from pause continues the same pass: stop() still returns to where it began.
    if (fromTick !== undefined || this.playState !== 'paused') this.playStartTick = start;
    this.startRun(start);
  }

  async pause(): Promise<void> {
    if (this.playState !== 'playing') {
      return;
    }
    this.positionTick = this.currentTick();
    this.haltRun();
    this.playState = 'paused';
    this.emitTransport();
    return Promise.resolve();
  }

  async stop(): Promise<void> {
    if (this.playState === 'playing') this.haltRun();
    this.playState = 'stopped';
    this.positionTick = this.playStartTick;
    this.emitTransport();
    return Promise.resolve();
  }

  async seek(tick: number): Promise<void> {
    if (!Number.isFinite(tick)) return;
    if (this.playState === 'playing') {
      this.stopSounds();
      this.playStartTick = tick;
      this.startRun(tick);
    } else {
      this.positionTick = tick;
      this.emitTransport();
    }
    return Promise.resolve();
  }

  getTransportPosition(): TransportPosition {
    const now = this.ctx?.currentTime ?? 0;
    return {
      state: this.playState,
      recording: this.recording !== null,
      ticks: this.currentTick(),
      engineTime: now,
    };
  }

  private currentTick(): number {
    if (this.playState === 'playing' && this.clock && this.ctx) {
      return tickAtTime(this.clock, Math.max(this.ctx.currentTime, this.clock.anchorTime));
    }
    return this.positionTick;
  }

  private snapshot(): TransportSnapshot {
    const model = this.model;
    return {
      state: this.playState,
      recording: this.recording !== null,
      positionTicks: this.currentTick(),
      bpm: model?.bpm ?? 120,
      loop: model?.loop ?? { enabled: false, startTick: 0, endTick: 0 },
    };
  }

  private emitTransport(): void {
    this.emit({ type: 'transport', transport: this.snapshot() });
  }

  private startRun(tick: number): void {
    const ctx = this.ctx!;
    const model = this.requireModel();
    this.clock = createTransportClock(
      ctx.currentTime + START_DELAY_SECONDS,
      tick,
      model.bpm,
      model.loop,
    );
    this.scheduledUntilU = tick;
    this.needsDiscontinuity = true;
    this.resync.clear();
    this.playState = 'playing';
    this.heartbeat?.start();
    this.tick();
    this.emitTransport();
  }

  /** Stops scheduling and silences transport voices (fast fade). */
  private haltRun(): void {
    this.stopSounds();
    this.heartbeat?.stop();
    this.clock = null;
    this.resync.clear();
  }

  private stopSounds(): void {
    if (this.ctx) this.graph?.cancelTransport(this.ctx.currentTime);
  }

  /** Tempo/loop edit while playing: keep the position, re-anchor, reschedule from now. */
  private replan(changes: { bpm?: number; loop?: LoopRegion }): void {
    const ctx = this.ctx;
    const clock = this.clock;
    if (!ctx || !clock || !this.graph) return;
    const time = Math.max(ctx.currentTime + MIN_LEAD_SECONDS, clock.anchorTime);
    this.graph.cancelTransport(time, { onlyUnstarted: true });
    this.graph.cancelTransport(time, { audioOnly: true });
    this.clock = rebaseClock(clock, time, changes);
    this.scheduledUntilU = this.clock.anchorTick;
    this.needsDiscontinuity = true;
    this.resync.clear();
  }

  /** One scheduler pass (heartbeat callback). */
  private tick(): void {
    const ctx = this.ctx;
    const clock = this.clock;
    const scheduler = this.scheduler;
    const graph = this.graph;
    const model = this.model;
    if (this.playState !== 'playing' || !ctx || !clock || !scheduler || !graph || !model) return;
    const started = performance.now();
    const now = ctx.currentTime;
    const earliest = Math.max(now + MIN_LEAD_SECONDS, clock.anchorTime);

    if (this.resync.size > 0) {
      const fromU = Math.max(unwrappedTickAtTime(clock, earliest), clock.anchorTick);
      for (const [trackId, scope] of this.resync) {
        const channel = graph.channel(trackId);
        if (!channel) continue;
        const clipIds = scope === 'all' ? undefined : scope;
        channel.cancelTransport(earliest, { onlyUnstarted: true, ...(clipIds ? { clipIds } : {}) });
        channel.cancelTransport(earliest, { audioOnly: true, ...(clipIds ? { clipIds } : {}) });
        if (this.scheduledUntilU > fromU) {
          const segments = planScheduleSegments(clock, fromU, this.scheduledUntilU, {
            startIsDiscontinuity: true,
          });
          const stats = scheduler.schedule(segments, {
            tracks: [trackId],
            forceOverlap: true,
            skipSounding: true,
            metronome: false,
            earliestTime: earliest,
          });
          this.stats.lateDropped += stats.lateDropped;
        }
      }
      this.resync.clear();
    }

    const toU = unwrappedTickAtTime(clock, now + LOOKAHEAD_SECONDS);
    if (toU > this.scheduledUntilU) {
      const segments = planScheduleSegments(clock, this.scheduledUntilU, toU, {
        startIsDiscontinuity: this.needsDiscontinuity,
      });
      const stats = scheduler.schedule(segments, {
        metronome: model.metronome.enabled,
        earliestTime: earliest,
      });
      this.stats.lateDropped += stats.lateDropped;
      this.scheduledUntilU = toU;
      this.needsDiscontinuity = false;
    }
    const elapsed = performance.now() - started;
    this.stats.ticks++;
    this.stats.totalMs += elapsed;
    this.stats.maxMs = Math.max(this.stats.maxMs, elapsed);
  }

  // ---------------------------------------------------------------------------
  // Meters
  // ---------------------------------------------------------------------------

  readMeters(): MeterSnapshot {
    const graph = this.graph;
    if (!graph) return { master: SILENT_METER, tracks: {} };
    const tracks: Record<TrackId, ChannelMeter> = {};
    for (const [id, channel] of graph.channelEntries())
      tracks[id] = channel.meter?.read() ?? SILENT_METER;
    return { master: graph.master.meter?.read() ?? SILENT_METER, tracks };
  }

  // ---------------------------------------------------------------------------
  // Live input
  // ---------------------------------------------------------------------------

  private instrumentFor(trackId: TrackId): Instrument | null {
    return this.graph?.channel(trackId)?.instrumentNode ?? null;
  }

  private pedal(trackId: TrackId): SustainPedal {
    let pedal = this.pedals.get(trackId);
    if (!pedal) {
      pedal = new SustainPedal();
      this.pedals.set(trackId, pedal);
    }
    return pedal;
  }

  private createLivePort(): LiveInputPort {
    const now = () => this.ctx?.currentTime ?? 0;
    return {
      noteOn: (trackId, pitch, velocity) => {
        const instrument = this.instrumentFor(trackId);
        if (!instrument) return;
        if (velocity <= 0) {
          if (this.pedal(trackId).noteOff(pitch)) instrument.noteOff(pitch, now());
          return;
        }
        this.pedal(trackId).noteOn(pitch);
        instrument.noteOn(pitch, velocity, now());
      },
      noteOff: (trackId, pitch) => {
        const instrument = this.instrumentFor(trackId);
        if (instrument && this.pedal(trackId).noteOff(pitch)) instrument.noteOff(pitch, now());
      },
      sustain: (trackId, down) => {
        const instrument = this.instrumentFor(trackId);
        const release = this.pedal(trackId).setDown(down);
        if (instrument) for (const pitch of release) instrument.noteOff(pitch, now());
      },
      pitchBend: (trackId, value) => this.instrumentFor(trackId)?.pitchBend(value, now()),
      modulation: (trackId, value) => this.instrumentFor(trackId)?.modulation(value, now()),
      allNotesOff: (trackId) => {
        const ids = trackId
          ? [trackId]
          : [...(this.graph?.channelEntries() ?? [])].map(([id]) => id);
        for (const id of ids) {
          this.pedals.get(id)?.reset();
          this.instrumentFor(id)?.releaseLive(now());
        }
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Recording and monitoring
  // ---------------------------------------------------------------------------

  async listInputDevices(): Promise<AudioInputDevice[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
  }

  private setRecordingStatus(status: RecordingStatus): void {
    this.recordingStatus = status;
    this.emit({ type: 'recording', status });
  }

  /** Current recording status (also delivered as `recording` events). */
  getRecordingStatus(): RecordingStatus {
    return this.recordingStatus;
  }

  /** Default latency compensation: output (base + device) plus reported input latency. */
  estimateLatencySeconds(input?: AudioInputHandle): number {
    const ctx = this.ctx;
    const base = typeof ctx?.baseLatency === 'number' ? ctx.baseLatency : 0;
    const output = typeof ctx?.outputLatency === 'number' ? ctx.outputLatency : 0;
    return base + output + (input?.latencySeconds ?? 0);
  }

  async startRecording(options: RecordingOptions): Promise<void> {
    if (this.recording) throw new AudioEngineError('internal', 'Already recording');
    await this.initialize();
    const ctx = this.ctx!;
    if (!this.workletReady) {
      throw new AudioEngineError(
        'worklet-failed',
        'Recording needs the audio worklet, which failed to load',
      );
    }
    this.setRecordingStatus({ phase: 'requesting-permission' });
    let input: AudioInputHandle;
    try {
      input = await this.inputs!.acquire(options.deviceId, options.channelCount);
    } catch (error) {
      const engineError = error instanceof AudioEngineError ? error : microphoneError(error);
      this.setRecordingStatus({ phase: 'error', message: engineError.message });
      this.emit({ type: 'error', error: engineError.toEngineError() });
      throw engineError;
    }
    if (this.playState !== 'playing') await this.play();
    const session = new RecorderSession(ctx, input.source, options.channelCount);
    session.start();
    const startedAtTick = this.currentTick();
    this.recording = { session, input, options, clock: this.clock!, startedAtTick };
    this.setRecordingStatus({ phase: 'recording', startedAtTick, trackIds: options.trackIds });
    this.emitTransport();
  }

  async stopRecording(): Promise<RecordedTake[]> {
    const recording = this.recording;
    if (!recording) return [];
    this.recording = null;
    this.setRecordingStatus({ phase: 'finalizing' });
    const captured = await recording.session.stop();
    this.inputs?.release(recording.input);
    const latency =
      recording.options.latencyCompensationSeconds ?? this.estimateLatencySeconds(recording.input);
    const firstTime =
      captured.firstFrame !== null
        ? captured.firstFrame / captured.sampleRate
        : (this.ctx?.currentTime ?? 0);
    const startTick = tickAtTime(recording.clock, firstTime - latency);
    const takes = recording.options.trackIds.map((trackId, index) => ({
      trackId,
      pcm: {
        sampleRate: captured.sampleRate,
        channels: index === 0 ? captured.channels : captured.channels.map((c) => c.slice()),
      },
      startTick,
      latencyCompensationSeconds: latency,
      inputLabel: recording.input.label,
    }));
    this.setRecordingStatus({ phase: 'idle' });
    this.emitTransport();
    return takes;
  }

  async setInputMonitoring(trackId: TrackId, enabled: boolean): Promise<void> {
    if (!enabled) {
      this.stopMonitoring(trackId);
      return;
    }
    if (this.monitors.has(trackId)) return;
    await this.initialize();
    const channels = this.model?.tracks.get(trackId)?.inputChannels ?? 1;
    let handle: AudioInputHandle;
    try {
      handle = await this.inputs!.acquire(undefined, channels);
    } catch (error) {
      const engineError = error instanceof AudioEngineError ? error : microphoneError(error);
      this.emit({ type: 'error', error: engineError.toEngineError() });
      throw engineError;
    }
    this.monitors.set(trackId, handle);
    this.graph?.channel(trackId)?.setMonitorInput(handle.source);
  }

  private stopMonitoring(trackId: TrackId): void {
    const handle = this.monitors.get(trackId);
    if (!handle) return;
    this.monitors.delete(trackId);
    this.graph?.channel(trackId)?.setMonitorInput(null);
    this.inputs?.release(handle);
  }

  // ---------------------------------------------------------------------------
  // Offline render
  // ---------------------------------------------------------------------------

  async render(
    request: RenderRequest,
    options: {
      readonly signal?: AbortSignalLike;
      readonly onProgress?: (p: RenderProgress) => void;
    } = {},
  ): Promise<RenderedAudio> {
    const model = this.requireModel();
    return renderOffline({
      model: model.clone(),
      assets: this.assets,
      logger: this.logger,
      request,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
  }
}
