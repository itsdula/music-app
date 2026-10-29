/**
 * Connects the device-independent MidiService to Studio: validated events are routed to
 * MIDI Learn, the mapping engine (parameters/actions via commands), live instrument input,
 * and the note recorder. Diagnostics and per-control activity are kept outside React.
 */
import type { AudioEngine } from '@studio/audio-contracts';
import type { CommandHistory } from '@studio/commands';
import { PPQ, type MappingTarget, type MidiMapping, type StudioActionId, type TrackId } from '@studio/domain';
import { mpkMiniMk3Profile } from '@studio/midi-akai-mpk-mini-mk3';
import {
  MappingEngine,
  MidiNoteRecorder,
  MidiService,
  applyVelocityCurve,
  createMidiLearnSession,
  describeMidiMessage,
  formatMidiBytes,
  encodeMidiMessage,
  shouldInvokeAction,
  type MidiDeviceProfile,
  type MidiInputEvent,
  type MidiLearnSession,
  type ParameterValueReader,
  type VelocityCurve,
} from '@studio/midi-core';
import type { PlatformServices } from '@studio/platform-contracts';
import { createMidiStore, type MidiDeviceView, type MidiStore } from '../state/midi-store';
import type { UiStore } from '../state/ui-store';
import type { EditController } from './edit-controller';
import { commandForNormalized, normalizedValue, resolveParameter } from './parameters';
import type { TransportController } from './transport-controller';

const GLOBAL_MAPPINGS_KEY = 'studio.midi.globalMappings.v1';
const SETTINGS_KEY = 'studio.midi.settings.v1';
const DIAGNOSTIC_CAPACITY = 200;

export const DEVICE_PROFILES: readonly MidiDeviceProfile[] = [mpkMiniMk3Profile];

export interface MidiDiagnosticEntry {
  readonly seq: number;
  readonly timeMs: number;
  readonly portName: string;
  readonly text: string;
  readonly bytes: string;
  readonly controlId: string | undefined;
  readonly routed: 'mapping' | 'instrument' | 'learn' | 'ignored';
}

interface LiveNoteKey {
  readonly trackId: TrackId;
  readonly pitch: number;
}

export class MidiController {
  readonly service: MidiService;
  readonly store: MidiStore;
  private readonly mapper = new MappingEngine();
  private readonly learn: MidiLearnSession;
  private readonly liveNotes = new Map<string, LiveNoteKey>();
  private readonly diagnostics: MidiDiagnosticEntry[] = [];
  private readonly diagnosticListeners = new Set<() => void>();
  /** Last activity per physical control id (read by the hardware panel in rAF). */
  readonly activity = new Map<string, { value: number; timeMs: number }>();
  private seq = 0;
  private recorder: MidiNoteRecorder | null = null;
  private recordTrackId: TrackId | null = null;
  private recordStartTick = 0;
  private recordStartHostMs = 0;
  private learnTimer: ReturnType<typeof setInterval> | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private lastProjectMappings: readonly MidiMapping[] | null = null;

  constructor(
    private readonly platform: PlatformServices,
    private readonly history: CommandHistory,
    private readonly ui: UiStore,
    private readonly engine: AudioEngine,
    private readonly transport: TransportController,
    private readonly edits: EditController,
  ) {
    this.service = new MidiService({ port: platform.midiAccess, profiles: DEVICE_PROFILES, now: () => performance.now() });
    this.store = createMidiStore(this.service.supported);
    this.learn = createMidiLearnSession({ now: () => performance.now(), scope: 'project' });
    this.unsubscribers.push(
      this.service.subscribe((event) => this.handleEvent(event)),
      this.service.subscribeDevices(() => this.refreshDevices()),
      this.service.subscribeErrors((error) =>
        this.store.setState({
          lastError: error.kind === 'invalid-input' ? `Ignored invalid MIDI from ${error.portName}: ${error.error.message}` : error.message,
        }),
      ),
      this.learn.subscribe((learn) => this.store.setState({ learn })),
      this.history.subscribe(({ present, reason }) => {
        if (present.midiMappings !== this.lastProjectMappings) this.applyMappings();
        if (reason === 'reset') this.mapper.resetTakeover();
      }),
    );
  }

  async init(): Promise<void> {
    const saved = await this.platform.settingsRepository.get<MidiMapping[]>(GLOBAL_MAPPINGS_KEY);
    const globalMappings = saved ?? this.createDefaultGlobalMappings();
    if (!saved) await this.platform.settingsRepository.set(GLOBAL_MAPPINGS_KEY, globalMappings);
    const settings = await this.platform.settingsRepository.get<{ velocityCurve: VelocityCurve; transpose: number }>(SETTINGS_KEY);
    this.store.setState({ globalMappings, ...(settings ?? {}) });
    this.applyMappings();
    // Reconnect silently when permission was granted in an earlier session (no prompt).
    if (this.service.supported && (await this.platform.permissions.query('midi')) === 'granted') {
      await this.requestAccess();
    }
  }

  async requestAccess(): Promise<void> {
    this.store.setState({ status: 'requesting', lastError: null });
    const status = await this.service.requestAccess({ sysex: false });
    this.store.setState({ status });
    this.refreshDevices();
  }

  private refreshDevices(): void {
    const devices: MidiDeviceView[] = this.service.listDevices().map((d) => ({
      portId: d.port.id,
      name: d.port.name,
      displayName: d.displayName,
      manufacturer: d.port.manufacturer,
      type: d.port.type,
      state: d.port.state,
      profileId: d.profile?.id,
      profileName: d.profile?.displayName,
    }));
    this.store.setState({ devices, status: this.service.getStatus() });
  }

  // --- mappings ---------------------------------------------------------------------------

  createDefaultGlobalMappings(): MidiMapping[] {
    return DEVICE_PROFILES.flatMap((profile) =>
      profile.defaultMappings().map((m) => ({ ...m, id: this.edits.newMappingId(), scope: 'global' as const })),
    );
  }

  private applyMappings(): void {
    const project = this.history.present;
    this.lastProjectMappings = project.midiMappings;
    this.mapper.setMappings([...this.store.getState().globalMappings, ...project.midiMappings]);
  }

  async setGlobalMappings(mappings: readonly MidiMapping[]): Promise<void> {
    this.store.setState({ globalMappings: mappings });
    this.applyMappings();
    await this.platform.settingsRepository.set(GLOBAL_MAPPINGS_KEY, mappings);
  }

  async resetGlobalMappings(): Promise<void> {
    await this.setGlobalMappings(this.createDefaultGlobalMappings());
  }

  async updateSettings(patch: Partial<{ velocityCurve: VelocityCurve; transpose: number }>): Promise<void> {
    this.store.setState(patch);
    const { velocityCurve, transpose } = this.store.getState();
    await this.platform.settingsRepository.set(SETTINGS_KEY, { velocityCurve, transpose });
  }

  /** All mappings (global + project) for display. */
  allMappings(): readonly MidiMapping[] {
    return [...this.store.getState().globalMappings, ...this.history.present.midiMappings];
  }

  // --- learn ------------------------------------------------------------------------------

  startLearn(target: MappingTarget): void {
    this.learn.start(target);
    if (this.learnTimer) clearInterval(this.learnTimer);
    this.learnTimer = setInterval(() => {
      const state = this.learn.checkTimeout();
      if (state.phase !== 'listening' && this.learnTimer) {
        clearInterval(this.learnTimer);
        this.learnTimer = null;
      }
    }, 500);
  }

  cancelLearn(): void {
    this.learn.cancel();
    if (this.learnTimer) clearInterval(this.learnTimer);
    this.learnTimer = null;
  }

  /** Stores the captured mapping (project scope by default, or global). */
  async confirmLearn(scope: 'project' | 'global' = 'project'): Promise<MidiMapping | null> {
    const state = this.learn.getState();
    if (state.phase !== 'captured') return null;
    const mapping: MidiMapping = { ...state.mapping, id: this.edits.newMappingId(), scope };
    // Replace existing mappings for the same source so a control has one meaning.
    const sameSource = (m: MidiMapping) => JSON.stringify(m.source) === JSON.stringify(mapping.source) && JSON.stringify(m.device) === JSON.stringify(mapping.device);
    if (scope === 'project') {
      const replaced = this.history.present.midiMappings.filter(sameSource).map((m) => m.id);
      this.history.executeBatch(
        [...(replaced.length > 0 ? [{ type: 'mapping.remove' as const, mappingIds: replaced }] : []), { type: 'mapping.add', mapping }],
        { label: 'MIDI Learn' },
      );
    } else {
      await this.setGlobalMappings([...this.store.getState().globalMappings.filter((m) => !sameSource(m)), mapping]);
    }
    this.cancelLearn();
    return mapping;
  }

  // --- event handling ------------------------------------------------------------------------

  private readonly reader: ParameterValueReader = {
    getNormalized: (address) => {
      const resolved = resolveParameter(this.history.present, address, this.ui.getState().selection.trackId);
      return resolved ? normalizedValue(resolved) : undefined;
    },
  };

  private handleEvent(event: MidiInputEvent): void {
    if (event.control) this.activity.set(event.control.controlId, { value: event.control.value, timeMs: event.timestampMs });
    const message = event.message;
    if (message.type === 'clock' || message.type === 'activeSensing') return;

    if (this.learn.getState().phase !== 'idle' && message.type !== 'noteOff') {
      const before = this.learn.getState().phase;
      this.learn.handle(event);
      if (before === 'listening') {
        this.log(event, 'learn');
        return;
      }
    }

    const effects = this.mapper.process(event, this.reader);
    if (effects.length > 0) {
      for (const effect of effects) {
        if (effect.kind === 'setParameter') {
          const resolved = resolveParameter(this.history.present, effect.address, this.ui.getState().selection.trackId);
          if (resolved) {
            this.history.execute(commandForNormalized(resolved, effect.normalized), {
              label: `MIDI: ${resolved.label}`,
              coalesceKey: `midi:${effect.mappingId}`,
            });
          }
        } else if (shouldInvokeAction(effect)) {
          this.runAction(effect.action);
        }
      }
      this.log(event, 'mapping');
      return;
    }
    this.log(event, this.routeToInstrument(event) ? 'instrument' : 'ignored');
  }

  private routeToInstrument(event: MidiInputEvent): boolean {
    const message = event.message;
    const key = (channel: number, note: number) => `${event.portId}:${channel}:${note}`;
    if (message.type === 'noteOff') {
      const live = this.liveNotes.get(key(message.channel, message.note));
      if (!live) return false;
      this.liveNotes.delete(key(message.channel, message.note));
      this.engine.live.noteOff(live.trackId, live.pitch);
      if (this.recorder && live.trackId === this.recordTrackId) this.recorder.handle(event);
      return true;
    }
    const trackId = this.edits.liveInstrumentTrack();
    if (!trackId) return false;
    const track = this.history.present.tracks[trackId];
    const routing = track?.midiInput;
    if (routing && routing.channel !== 'all' && 'channel' in message && message.channel !== routing.channel) return false;
    const { velocityCurve, transpose } = this.store.getState();
    switch (message.type) {
      case 'noteOn': {
        const pitch = Math.min(127, Math.max(0, message.note + transpose + (routing?.transpose ?? 0)));
        const velocity = applyVelocityCurve(message.velocity, velocityCurve);
        this.liveNotes.set(key(message.channel, message.note), { trackId, pitch });
        if (this.engine.getLifecycleState() !== 'running') void this.transport.ensureAudio();
        this.engine.live.noteOn(trackId, pitch, velocity);
        if (this.recorder && trackId === this.recordTrackId) {
          this.recorder.handle({ ...event, message: { ...message, note: pitch, velocity } });
        }
        return true;
      }
      case 'pitchBend':
        this.engine.live.pitchBend(trackId, message.value / 8192);
        return true;
      case 'controlChange':
        if (message.controller === 1) {
          this.engine.live.modulation(trackId, message.value / 127);
          return true;
        }
        if (message.controller === 64) {
          this.engine.live.sustain(trackId, message.value >= 64);
          if (this.recorder && trackId === this.recordTrackId) this.recorder.handle(event);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  private runAction(action: StudioActionId): void {
    const t = this.transport;
    switch (action) {
      case 'transport.play':
        void t.play();
        break;
      case 'transport.stop':
        void t.stop();
        break;
      case 'transport.togglePlay':
        void t.togglePlay();
        break;
      case 'transport.record':
        void t.record();
        break;
      case 'transport.toggleLoop':
        t.toggleLoop();
        break;
      case 'transport.toggleMetronome':
        t.toggleMetronome();
        break;
      case 'transport.rewind':
        void t.rewind();
        break;
      case 'transport.tapTempo':
        t.tapTempo();
        break;
      case 'edit.undo':
        this.history.undo();
        break;
      case 'edit.redo':
        this.history.redo();
        break;
      case 'track.selectNext':
      case 'track.selectPrevious': {
        const order = this.history.present.trackOrder;
        const current = this.ui.getState().selection.trackId;
        const index = current ? order.indexOf(current) : -1;
        const next = order[Math.min(order.length - 1, Math.max(0, index + (action === 'track.selectNext' ? 1 : -1)))];
        if (next) this.ui.setState((s) => ({ ...s, selection: { ...s.selection, trackId: next } }));
        this.mapper.resetTakeover();
        break;
      }
      case 'track.toggleArmSelected':
      case 'track.toggleMuteSelected':
      case 'track.toggleSoloSelected': {
        const id = this.ui.getState().selection.trackId;
        const track = id ? this.history.present.tracks[id] : undefined;
        if (!track || !id) break;
        if (action === 'track.toggleArmSelected') this.history.execute({ type: 'track.update', trackId: id, patch: { armed: !track.armed } });
        else if (action === 'track.toggleMuteSelected') this.history.execute({ type: 'track.setMixer', trackId: id, mixer: { mute: !track.mixer.mute } });
        else this.history.execute({ type: 'track.setMixer', trackId: id, mixer: { solo: !track.mixer.solo } });
        break;
      }
    }
  }

  panic(): void {
    this.service.panic();
    this.liveNotes.clear();
    this.engine.live.allNotesOff();
  }

  // --- recording --------------------------------------------------------------------------

  beginRecording(trackIds: readonly TrackId[], startTick: number): boolean {
    const trackId = trackIds[0];
    if (!trackId) return false;
    this.recordTrackId = trackId;
    this.recordStartTick = startTick;
    this.recordStartHostMs = performance.now();
    const bpm = () => this.history.present.bpm;
    const latencyMs = () => ((this.engine.getCapabilities()?.outputLatencySeconds ?? 0) + (this.engine.getCapabilities()?.baseLatencySeconds ?? 0)) * 1000;
    this.recorder = new MidiNoteRecorder({
      tickAt: (hostMs) => {
        // Position from the engine clock when available, falling back to host-time extrapolation.
        const position = this.engine.getTransportPosition();
        const nowMs = performance.now();
        const ticksPerMs = (bpm() * PPQ) / 60000;
        const base = position.state === 'playing' ? position.ticks - (nowMs - hostMs) * ticksPerMs : this.recordStartTick + (hostMs - this.recordStartHostMs) * ticksPerMs;
        // Players react to what they hear, which is late by the output latency.
        return base - latencyMs() * ticksPerMs;
      },
    });
    return true;
  }

  endRecording(endTick: number): void {
    const recorder = this.recorder;
    const trackId = this.recordTrackId;
    this.recorder = null;
    this.recordTrackId = null;
    if (!recorder || !trackId) return;
    const notes = recorder.finish(endTick);
    this.edits.commitMidiTake({
      trackId,
      startTick: this.recordStartTick,
      endTick: Math.max(endTick, this.recordStartTick + PPQ),
      notes,
    });
  }

  // --- diagnostics ------------------------------------------------------------------------

  private log(event: MidiInputEvent, routed: MidiDiagnosticEntry['routed']): void {
    this.diagnostics.push({
      seq: ++this.seq,
      timeMs: event.timestampMs,
      portName: event.portName,
      text: describeMidiMessage(event.message),
      bytes: formatMidiBytes(encodeMidiMessage(event.message)),
      controlId: event.control?.controlId,
      routed,
    });
    if (this.diagnostics.length > DIAGNOSTIC_CAPACITY) this.diagnostics.shift();
    for (const listener of this.diagnosticListeners) listener();
  }

  recentEvents(): readonly MidiDiagnosticEntry[] {
    return this.diagnostics;
  }

  subscribeDiagnostics(listener: () => void): () => void {
    this.diagnosticListeners.add(listener);
    return () => this.diagnosticListeners.delete(listener);
  }

  dispose(): void {
    this.cancelLearn();
    for (const u of this.unsubscribers) u();
    this.service.dispose();
  }
}
