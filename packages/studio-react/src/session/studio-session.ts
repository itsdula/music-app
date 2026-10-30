/**
 * Composition root for one mounted <Studio />. Wires platform services, history, stores,
 * engine and controllers. Not a God object: it owns lifetimes and hands out focused
 * collaborators; behaviour lives in the controllers.
 */
import type { AudioEngine } from '@studio/audio-contracts';
import { createHistory, type CommandHistory } from '@studio/commands';
import { createIdFactory, type IdFactory } from '@studio/domain';
import type { PlatformServices } from '@studio/platform-contracts';
import { RenderLoop } from '../canvas/render-loop';
import type { StudioConfig } from '../config';
import { createEngineStore, type EngineStore } from '../state/engine-store';
import { createProjectStore, type ProjectStore } from '../state/project-store';
import { createUiStore, pruneSelection, type UiStore } from '../state/ui-store';
import { AssetLibrary } from './asset-library';
import { createStarterProject } from './demo-project';
import { EditController } from './edit-controller';
import { EngineBridge } from './engine-bridge';
import { userFacingEngineMessage } from './engine-messages';
import { ExportController } from './export-controller';
import { MidiController } from './midi-controller';
import { ProjectController } from './project-controller';
import { TransportController } from './transport-controller';
import { VocalController } from './vocal-controller';
import { installStudioTools } from './tools';
import { ToolRegistry } from './tools/registry';

export interface StudioSession {
  readonly platform: PlatformServices;
  readonly config: StudioConfig;
  readonly ids: IdFactory;
  readonly history: CommandHistory;
  readonly projectStore: ProjectStore;
  readonly uiStore: UiStore;
  readonly engineStore: EngineStore;
  readonly engine: AudioEngine;
  readonly renderLoop: RenderLoop;
  readonly assets: AssetLibrary;
  readonly transport: TransportController;
  readonly edits: EditController;
  readonly projects: ProjectController;
  readonly exporter: ExportController;
  readonly midi: MidiController;
  readonly vocal: VocalController;
  /** Capabilities shared by the AI assistant, WebMCP and tutorials. */
  readonly tools: ToolRegistry;
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export function createStudioSession(
  platform: PlatformServices,
  config: StudioConfig,
): StudioSession {
  const ids = createIdFactory(platform.randomId);
  const history = createHistory(createStarterProject(ids, platform.now()), {
    limit: config.undoLimit,
  });
  const { store: projectStore, detach: detachProjectStore } = createProjectStore(history);
  const uiStore = createUiStore();
  const engineStore = createEngineStore();
  const assets = new AssetLibrary(platform, () => history.present, ids);
  const engine = platform.audioBackendFactory.create({
    assets,
    latencyHint: 'interactive',
    logger: platform.logger,
  });
  const bridge = new EngineBridge(engine, history, platform.logger);
  const renderLoop = new RenderLoop();
  const transport = new TransportController(engine, history, engineStore, platform.logger);
  const edits = new EditController(history, uiStore, ids, assets);
  const projects = new ProjectController(
    platform,
    history,
    projectStore,
    assets,
    ids,
    config.autosaveDelayMs,
  );
  const exporter = new ExportController(engine, platform.fileDialogs);
  const midi = new MidiController(platform, history, uiStore, engine, transport, edits);
  const vocal = new VocalController(platform, history, engine, assets);

  transport.setRecordingHooks({
    beginMidiRecording: (trackIds, startTick) => midi.beginRecording(trackIds, startTick),
    endMidiRecording: (endTick) => midi.endRecording(endTick),
    commitAudioTakes: (takes) => edits.commitAudioTakes(takes),
  });

  // Keep selection valid after undo/redo/deletes/project switches.
  const detachPrune = history.subscribe(({ present }) => {
    uiStore.setState((s) =>
      pruneSelection(s, {
        track: (id) => Boolean(present.tracks[id]),
        clip: (id) => Boolean(present.clips[id]),
        note: (clipId, noteId) => {
          const clip = present.clips[clipId];
          return clip?.kind === 'midi' && clip.notes.some((n) => n.id === noteId);
        },
      }),
    );
  });

  const unsubscribeEngine = engine.subscribe((event) => {
    switch (event.type) {
      case 'lifecycle':
        engineStore.setState({ lifecycle: event.state });
        break;
      case 'transport':
        engineStore.setState({ playState: event.transport.state });
        break;
      case 'recording':
        engineStore.setState({ recording: event.status });
        break;
      case 'error':
        engineStore.setState({
          lastError: { ...event.error, message: userFacingEngineMessage(event.error) },
        });
        platform.logger.warn(event.error.message, event.error.detail);
        break;
      case 'asset':
        engineStore.setState((s) => ({
          loadingAssets: Math.max(0, s.loadingAssets + (event.status === 'loading' ? 1 : -1)),
        }));
        break;
    }
  });

  let started = false;
  let disposed = false;
  let uninstallTools: (() => void) | null = null;

  const session: StudioSession = {
    platform,
    config,
    ids,
    history,
    projectStore,
    uiStore,
    engineStore,
    engine,
    renderLoop,
    assets,
    transport,
    edits,
    projects,
    exporter,
    midi,
    vocal,
    tools: new ToolRegistry(() => ({ session })),
    async start() {
      if (started) return;
      started = true;
      const capabilities = await engine.initialize();
      const recordLatencyMs =
        (await platform.settingsRepository.get<number | null>('studio.recording.latencyMs')) ??
        null;
      engineStore.setState({
        capabilities,
        lifecycle: engine.getLifecycleState(),
        recordLatencyMs,
      });
      await projects.openInitial(config.initialProjectId);
      if (disposed) return;
      await bridge.attach();
      if (config.features.midi) {
        await midi
          .init()
          .catch((error: unknown) => platform.logger.warn('MIDI initialisation failed', error));
      }
      // Select the first track so live MIDI and shortcuts have a target.
      const first = history.present.trackOrder[0];
      if (first) uiStore.setState((s) => ({ ...s, selection: { ...s.selection, trackId: first } }));
      uninstallTools = installStudioTools(session);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      uninstallTools?.();
      unsubscribeEngine();
      midi.dispose();
      vocal.dispose();
      detachPrune();
      detachProjectStore();
      bridge.detach();
      renderLoop.dispose();
      await projects.flush().catch(() => undefined);
      projects.dispose();
      await engine.dispose().catch(() => undefined);
      await platform.dispose().catch(() => undefined);
    },
  };
  return session;
}
