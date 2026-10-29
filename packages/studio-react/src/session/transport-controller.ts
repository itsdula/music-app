/**
 * Transport actions shared by the transport bar, keyboard shortcuts and MIDI actions.
 * Owns the play cursor and recording orchestration (audio takes via the engine, MIDI takes
 * via the MIDI controller hook).
 */
import type { AudioEngine, RecordedTake } from '@studio/audio-contracts';
import type { CommandHistory } from '@studio/commands';
import { clampBpm, orderedTracks, ticksPerBar, type TrackId } from '@studio/domain';
import type { Logger } from '@studio/platform-contracts';
import type { EngineStore } from '../state/engine-store';

export interface RecordingHooks {
  /** Starts MIDI capture for armed instrument tracks; returns false if none. */
  beginMidiRecording(trackIds: readonly TrackId[], startTick: number): boolean;
  /** Ends MIDI capture and commits recorded notes (one undo entry with audio takes). */
  endMidiRecording(endTick: number): void;
  /** Persists audio takes as assets + clips. */
  commitAudioTakes(takes: readonly RecordedTake[]): Promise<void>;
}

export class TransportController {
  private tapTimes: number[] = [];
  private recordingHooks: RecordingHooks | null = null;
  private audioRecording = false;
  private midiRecording = false;

  constructor(
    private readonly engine: AudioEngine,
    private readonly history: CommandHistory,
    private readonly engineStore: EngineStore,
    private readonly logger: Logger,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setRecordingHooks(hooks: RecordingHooks): void {
    this.recordingHooks = hooks;
  }

  /** Resumes the audio context (must run inside a user gesture in browsers). */
  async ensureAudio(): Promise<boolean> {
    try {
      if (this.engine.getLifecycleState() !== 'running') await this.engine.resume();
      return this.engine.getLifecycleState() === 'running';
    } catch (error) {
      this.logger.error('Audio could not start', error);
      return false;
    }
  }

  get isPlaying(): boolean {
    return this.engineStore.getState().playState === 'playing';
  }

  async play(fromTick?: number): Promise<void> {
    if (!(await this.ensureAudio())) return;
    const start = fromTick ?? this.engineStore.getState().cursorTick;
    await this.engine.play(start);
    this.engineStore.setState({ playState: 'playing' });
  }

  async pause(): Promise<void> {
    const position = this.engine.getTransportPosition();
    await this.engine.pause();
    this.engineStore.setState({ playState: 'paused', cursorTick: Math.round(position.ticks) });
  }

  get isRecording(): boolean {
    return this.audioRecording || this.midiRecording;
  }

  async stop(): Promise<void> {
    if (this.isRecording) {
      await this.stopRecording();
      return;
    }
    await this.engine.stop();
    this.engineStore.setState({ playState: 'stopped' });
  }

  async togglePlay(): Promise<void> {
    if (this.isPlaying) await this.stop();
    else await this.play();
  }

  async seek(tick: number): Promise<void> {
    const t = Math.max(0, Math.round(tick));
    this.engineStore.setState({ cursorTick: t });
    if (this.isPlaying) await this.engine.seek(t);
  }

  async rewind(): Promise<void> {
    await this.seek(0);
  }

  toggleLoop(): void {
    const { loop } = this.history.present;
    this.history.execute(
      { type: 'project.setLoop', loop: { enabled: !loop.enabled } },
      { label: 'Toggle Loop' },
    );
  }

  toggleMetronome(): void {
    const { metronome } = this.history.present;
    this.history.execute(
      { type: 'project.setMetronome', metronome: { enabled: !metronome.enabled } },
      { label: 'Toggle Metronome' },
    );
  }

  setTempo(bpm: number): void {
    this.history.execute(
      { type: 'project.setTempo', bpm: clampBpm(bpm) },
      { label: 'Set Tempo', coalesceKey: 'tempo' },
    );
  }

  /** Tap tempo: averages the last taps within 2 s windows. */
  tapTempo(): void {
    const t = this.now();
    this.tapTimes = this.tapTimes.filter((x) => t - x < 2000);
    this.tapTimes.push(t);
    if (this.tapTimes.length < 2) return;
    const intervals = this.tapTimes.slice(1).map((x, i) => x - this.tapTimes[i]!);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    this.setTempo(Math.round((60000 / mean) * 100) / 100);
  }

  /** Starts recording on armed tracks; plays from the cursor (with count-in if configured). */
  async record(): Promise<void> {
    const state = this.engineStore.getState();
    if (this.isRecording) {
      await this.stopRecording();
      return;
    }
    if (!(await this.ensureAudio())) return;
    const project = this.history.present;
    const armed = orderedTracks(project).filter((t) => t.armed);
    if (armed.length === 0) {
      this.engineStore.setState({
        lastError: {
          code: 'internal',
          message: 'Arm a track (the ● button on a track) before recording.',
        },
      });
      return;
    }
    const countIn = project.metronome.countInBars * ticksPerBar(project.meter);
    const startTick = Math.max(0, state.cursorTick - countIn);
    const audioTracks = armed.filter((t) => t.kind !== 'instrument').map((t) => t.id);
    const midiTracks = armed.filter((t) => t.kind === 'instrument').map((t) => t.id);
    try {
      // Start the transport first: takes are positioned from the transport clock at the
      // first captured frame, so capture must begin while the transport is running.
      await this.engine.play(startTick);
      this.engineStore.setState({ playState: 'playing' });
      if (audioTracks.length > 0) {
        const first = project.tracks[audioTracks[0]!];
        const manualMs = this.engineStore.getState().recordLatencyMs;
        await this.engine.startRecording({
          trackIds: audioTracks,
          channelCount: first?.inputChannels ?? 1,
          ...(manualMs !== null ? { latencyCompensationSeconds: manualMs / 1000 } : {}),
        });
        this.audioRecording = true;
      }
      if (
        midiTracks.length > 0 &&
        this.recordingHooks?.beginMidiRecording(midiTracks, state.cursorTick)
      ) {
        this.midiRecording = true;
        if (!this.audioRecording) {
          // The engine only reports audio capture; publish the MIDI-only recording state ourselves.
          this.engineStore.setState({
            recording: {
              phase: 'recording',
              startedAtTick: state.cursorTick,
              trackIds: midiTracks,
            },
          });
        }
      }
    } catch (error) {
      this.logger.error('Recording failed to start', error);
      // Never leave the transport running after a failed start (e.g. microphone denied).
      this.audioRecording = false;
      await this.engine.stop().catch(() => undefined);
      this.engineStore.setState({ playState: 'stopped' });
      if (!this.engineStore.getState().lastError) {
        const reason = error instanceof Error ? error.message : String(error);
        this.engineStore.setState({
          lastError: { code: 'internal', message: `Recording could not start: ${reason}` },
        });
      }
    }
  }

  async stopRecording(): Promise<void> {
    const position = this.engine.getTransportPosition();
    const hadAudio = this.audioRecording;
    const hadMidi = this.midiRecording;
    this.audioRecording = false;
    this.midiRecording = false;
    let takes: RecordedTake[] = [];
    if (hadAudio) {
      try {
        takes = await this.engine.stopRecording();
      } catch (error) {
        this.logger.error('Stopping the recording failed', error);
      }
    }
    if (hadMidi) this.recordingHooks?.endMidiRecording(Math.round(position.ticks));
    await this.engine.stop();
    this.engineStore.setState({
      playState: 'stopped',
      ...(hadAudio ? {} : { recording: { phase: 'idle' as const } }),
    });
    if (takes.length > 0) await this.recordingHooks?.commitAudioTakes(takes);
  }
}
