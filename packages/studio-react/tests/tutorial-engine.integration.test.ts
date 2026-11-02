import { encodeWav } from '@studio/audio-dsp';
import type { ClipId, TrackId } from '@studio/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import {
  evaluateCondition,
  measure,
  snapshotSession,
  type TutorialBaseline,
} from '../src/features/tutorial/conditions';
import {
  OFFER_KEY,
  PROGRESS_KEY,
  TutorialController,
  type TutorialProgress,
} from '../src/features/tutorial/controller';
import type { Tutorial, TutorialCondition } from '../src/features/tutorial/schema';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { openClipInEditor } from '../src/state/ui-store';
import { createTestPlatform, type TestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];

async function startSession(platform: TestPlatform = createTestPlatform()) {
  const session = createStudioSession(platform, { ...DEFAULT_STUDIO_CONFIG, autosaveDelayMs: 5 });
  sessions.push(session);
  await session.start();
  await session.projects.newProject('empty');
  return { session, platform };
}

afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

function check(session: StudioSession, condition: TutorialCondition, baseline: TutorialBaseline) {
  return evaluateCondition(condition, snapshotSession(session), baseline);
}

describe('tutorial conditions against a real session', () => {
  it('evaluates navigation, panels and the assistant', async () => {
    const { session } = await startSession();
    const base = measure(snapshotSession(session));
    expect(check(session, { type: 'view', view: 'arrange' }, base)).toBe(true);
    expect(check(session, { type: 'panelOpen', panel: 'track' }, base)).toBe(true);
    expect(check(session, { type: 'panelOpen', panel: 'mixer' }, base)).toBe(false);
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomPanel: 'mixer' } }));
    expect(check(session, { type: 'panelOpen', panel: 'mixer' }, base)).toBe(true);
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomOpen: false } }));
    expect(check(session, { type: 'panelOpen', panel: 'mixer' }, base)).toBe(false);
    session.uiStore.setState({ view: 'projects' });
    expect(check(session, { type: 'view', view: 'projects' }, base)).toBe(true);
    expect(check(session, { type: 'assistantOpen' }, base)).toBe(false);
    session.uiStore.setState({ assistantOpen: true });
    expect(check(session, { type: 'assistantOpen' }, base)).toBe(true);
  });

  it('counts tracks, clips, notes and effects absolutely and relative to the baseline', async () => {
    const { session } = await startSession();
    const base = measure(snapshotSession(session));
    expect(check(session, { type: 'trackCount', min: 1 }, base)).toBe(true);
    expect(check(session, { type: 'trackCount', kind: 'instrument', added: 1 }, base)).toBe(false);
    expect(check(session, { type: 'trackExists', kind: 'audio' }, base)).toBe(false);
    session.edits.addTrack('audio');
    expect(check(session, { type: 'trackExists', kind: 'audio' }, base)).toBe(true);
    expect(check(session, { type: 'trackCount', kind: 'audio', added: 1 }, base)).toBe(true);
    expect(check(session, { type: 'trackCount', kind: 'instrument', added: 1 }, base)).toBe(false);
    session.edits.addTrack('instrument');
    expect(check(session, { type: 'trackCount', kind: 'instrument', added: 1 }, base)).toBe(true);
    expect(check(session, { type: 'trackCount', added: 2 }, base)).toBe(true);

    const trackId = session.history.present.trackOrder[0]!;
    expect(check(session, { type: 'midiClipOpen' }, base)).toBe(false);
    expect(check(session, { type: 'noClipOpen' }, base)).toBe(true);
    const clipId = session.edits.createMidiClip(trackId, 0)!;
    expect(check(session, { type: 'clipCount', kind: 'midi', added: 1 }, base)).toBe(true);
    expect(check(session, { type: 'clipCount', kind: 'audio', min: 1 }, base)).toBe(false);
    expect(check(session, { type: 'midiClipOpen' }, base)).toBe(true);
    expect(check(session, { type: 'noteCount', min: 1 }, base)).toBe(false);
    session.edits.addNotes(
      clipId,
      [0, 1, 2, 3].map((i) => ({
        startTick: i * 240,
        durationTicks: 240,
        pitch: 60 + i,
        velocity: 100,
      })),
    );
    expect(check(session, { type: 'noteCount', min: 4 }, base)).toBe(true);
    // The editor must actually be showing: hiding the bottom panel closes the piano roll view.
    session.uiStore.setState((s) => ({ ...s, panels: { ...s.panels, bottomOpen: false } }));
    expect(check(session, { type: 'midiClipOpen' }, base)).toBe(false);
    session.uiStore.setState((s) => openClipInEditor(s, null));
    expect(check(session, { type: 'noClipOpen' }, base)).toBe(true);
    expect(check(session, { type: 'noteCount', min: 1 }, base)).toBe(false);

    expect(check(session, { type: 'effectCount', added: 1 }, base)).toBe(false);
    session.edits.addEffect(trackId, 'reverb');
    expect(check(session, { type: 'effectCount', added: 1 }, base)).toBe(true);
    expect(check(session, { type: 'effectCount', min: 1 }, base)).toBe(true);
  });

  it('evaluates transport, loop, metronome and tempo', async () => {
    const { session } = await startSession();
    const base = measure(snapshotSession(session));
    expect(check(session, { type: 'stopped' }, base)).toBe(true);
    expect(check(session, { type: 'playing' }, base)).toBe(false);
    await session.transport.play();
    expect(check(session, { type: 'playing' }, base)).toBe(true);
    await session.transport.stop();
    expect(check(session, { type: 'loopEnabled' }, base)).toBe(false);
    expect(check(session, { type: 'loopEnabled', value: false }, base)).toBe(true);
    session.transport.toggleLoop();
    expect(check(session, { type: 'loopEnabled' }, base)).toBe(true);
    session.transport.toggleMetronome();
    expect(check(session, { type: 'metronomeEnabled' }, base)).toBe(
      session.history.present.metronome.enabled,
    );
    expect(check(session, { type: 'tempoChanged' }, base)).toBe(false);
    session.transport.setTempo(97);
    expect(check(session, { type: 'tempoChanged' }, base)).toBe(true);
    expect(check(session, { type: 'recording' }, base)).toBe(false);
    session.engineStore.setState({
      recording: { phase: 'recording', startedAtTick: 0, trackIds: [] },
    });
    expect(check(session, { type: 'recording' }, base)).toBe(true);
  });

  it('evaluates project rename/change, selection, arming and MIDI', async () => {
    const { session } = await startSession();
    const base = measure(snapshotSession(session));
    expect(check(session, { type: 'trackSelected' }, base)).toBe(true);
    expect(check(session, { type: 'projectRenamed' }, base)).toBe(false);
    session.projects.rename('My Song');
    expect(check(session, { type: 'projectRenamed' }, base)).toBe(true);
    expect(check(session, { type: 'projectChanged' }, base)).toBe(false);
    await session.projects.newProject('empty');
    expect(check(session, { type: 'projectChanged' }, base)).toBe(true);
    expect(check(session, { type: 'projectRenamed' }, base)).toBe(false);

    const trackId = session.history.present.trackOrder[0] as TrackId;
    expect(check(session, { type: 'trackArmed' }, base)).toBe(false);
    session.history.execute(
      { type: 'track.update', trackId, patch: { armed: true } },
      { label: 'Arm' },
    );
    expect(check(session, { type: 'trackArmed' }, base)).toBe(true);

    expect(check(session, { type: 'midiConnected' }, base)).toBe(false);
    await session.midi.requestAccess();
    expect(check(session, { type: 'midiConnected' }, base)).toBe(true);
    expect(check(session, { type: 'midiMappingCount', added: 1 }, base)).toBe(false);
  });

  it('detects the vocal pitch editor and a finished analysis', async () => {
    const { session, platform } = await startSession();
    const base = measure(snapshotSession(session));
    const sampleRate = 48000;
    const data = new Float32Array(sampleRate / 2);
    for (let i = 0; i < data.length; i++)
      data[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    platform.pickFiles = [
      {
        name: 'vox.wav',
        mimeType: 'audio/wav',
        bytes: encodeWav({ sampleRate, channels: [data] }, { bitDepth: 16 }),
      },
    ];
    const files = await platform.fileDialogs.openFiles({ accept: ['audio/*'], multiple: true });
    await session.edits.importAudio(files, { atTick: 0 });
    expect(check(session, { type: 'clipCount', kind: 'audio', added: 1 }, base)).toBe(true);
    const clipId = Object.keys(session.history.present.clips)[0] as ClipId;
    session.uiStore.setState((s) => openClipInEditor(s, clipId));
    expect(check(session, { type: 'audioClipOpen' }, base)).toBe(true);
    expect(check(session, { type: 'pitchEditorOpen' }, base)).toBe(false);
    session.uiStore.setState({ audioEditorMode: 'pitch' });
    expect(check(session, { type: 'pitchEditorOpen' }, base)).toBe(true);
    expect(check(session, { type: 'vocalAnalyzed' }, base)).toBe(false);
  });

  it('combines conditions with all/any', async () => {
    const { session } = await startSession();
    const base = measure(snapshotSession(session));
    expect(
      check(
        session,
        { type: 'all', conditions: [{ type: 'stopped' }, { type: 'loopEnabled' }] },
        base,
      ),
    ).toBe(false);
    expect(
      check(
        session,
        { type: 'any', conditions: [{ type: 'stopped' }, { type: 'loopEnabled' }] },
        base,
      ),
    ).toBe(true);
  });
});

const TOUR: Tutorial = {
  id: 'tour',
  title: 'Tour',
  description: 'A test tour.',
  steps: [
    { id: 'intro', title: 'Intro', body: 'Hello.', advance: { type: 'next' } },
    {
      id: 'add',
      title: 'Add a track',
      body: 'Add an audio track.',
      target: 'add-track',
      before: { navigate: 'arrange' },
      advance: { type: 'condition', condition: { type: 'trackCount', kind: 'audio', added: 1 } },
    },
    {
      id: 'loop',
      title: 'Loop',
      body: 'Turn on loop.',
      target: 'transport-loop',
      advance: { type: 'condition', condition: { type: 'loopEnabled' } },
    },
    { id: 'tool', title: 'Tool', body: 'Ask.', advance: { type: 'tool', name: 'list_tutorials' } },
    {
      id: 'click',
      title: 'Click',
      body: 'Click play.',
      target: 'transport-play',
      advance: { type: 'click' },
    },
    {
      id: 'mixer',
      title: 'Mixer',
      body: 'This is the mixer.',
      before: { openPanel: 'mixer' },
      advance: { type: 'next' },
    },
  ],
};

async function tourController(platform?: TestPlatform) {
  const { session, platform: p } = await startSession(platform);
  const controller = new TutorialController(session, [TOUR]);
  await controller.load();
  return { session, platform: p, controller };
}

const stepId = (c: TutorialController) => {
  const active = c.store.getState().active;
  return active ? active.tutorial.steps[active.stepIndex]!.id : null;
};

describe('TutorialController', () => {
  it('is shared per session', async () => {
    const { session } = await startSession();
    expect(TutorialController.forSession(session)).toBe(TutorialController.forSession(session));
  });

  it('starts, advances on next/condition/tool/click, applies before, and completes', async () => {
    const { session, controller, platform } = await tourController();
    session.uiStore.setState({ view: 'projects' });
    expect(controller.start('nope')).toBe(false);
    expect(controller.start('tour')).toBe(true);
    expect(stepId(controller)).toBe('intro');
    controller.next();
    expect(stepId(controller)).toBe('add');
    expect(session.uiStore.getState().view).toBe('arrange');
    session.edits.addTrack('instrument');
    expect(stepId(controller)).toBe('add');
    session.edits.addTrack('audio');
    expect(stepId(controller)).toBe('loop');
    session.transport.toggleLoop();
    expect(stepId(controller)).toBe('tool');
    await expect(session.tools.call('start_tutorial', { id: 'missing' })).rejects.toThrow();
    expect(stepId(controller)).toBe('tool');
    await session.tools.call('list_tutorials', {});
    expect(stepId(controller)).toBe('click');
    expect(controller.reportClick((t) => t === 'transport-stop')).toBe(false);
    expect(controller.reportClick((t) => t === 'transport-play')).toBe(true);
    expect(stepId(controller)).toBe('click');
    await nextTask();
    expect(stepId(controller)).toBe('mixer');
    expect(session.uiStore.getState().panels).toMatchObject({
      bottomOpen: true,
      bottomPanel: 'mixer',
    });
    controller.next();
    expect(controller.store.getState()).toMatchObject({
      active: null,
      finished: { id: 'tour', title: 'Tour' },
    });
    controller.dismissFinished();
    expect(controller.store.getState().finished).toBeNull();
    await nextTask();
    const saved =
      await platform.settingsRepository.get<Record<string, TutorialProgress>>(PROGRESS_KEY);
    expect(saved?.tour?.status).toBe('completed');
  });

  it('skips a condition step that already holds when entered forward, but not via Back', async () => {
    const { session, controller } = await tourController();
    session.transport.toggleLoop(); // loop already on
    controller.start('tour');
    controller.next();
    session.edits.addTrack('audio');
    // "loop" is already satisfied, so the tour moves straight on to "tool".
    expect(stepId(controller)).toBe('tool');
    controller.back();
    expect(stepId(controller)).toBe('loop');
    // Unrelated changes don't bounce it forward; it re-arms once the condition stops holding.
    session.edits.addTrack('instrument');
    expect(stepId(controller)).toBe('loop');
    session.transport.toggleLoop();
    expect(stepId(controller)).toBe('loop');
    session.transport.toggleLoop();
    expect(stepId(controller)).toBe('tool');
  });

  it('measures "added" from the moment the step starts', async () => {
    const { session, controller } = await tourController();
    controller.start('tour');
    session.edits.addTrack('audio'); // before the "add" step: does not count
    controller.next();
    expect(stepId(controller)).toBe('add');
    session.edits.addTrack('audio');
    expect(stepId(controller)).toBe('loop');
  });

  it('back is a no-op on the first step; ignores stale click advances', async () => {
    const { controller } = await tourController();
    controller.start('tour');
    controller.back();
    expect(stepId(controller)).toBe('intro');
    controller.next();
    controller.next();
    controller.next();
    controller.next();
    expect(stepId(controller)).toBe('click');
    controller.reportClick(() => true);
    controller.back(); // the user moved on before the deferred advance ran
    await nextTask();
    expect(stepId(controller)).toBe('tool');
  });

  it('runs one tutorial at a time and stops listening when stopped', async () => {
    const { session, controller, platform } = await tourController();
    const other: Tutorial = { ...TOUR, id: 'other', title: 'Other' };
    controller.register(other);
    controller.start('tour');
    controller.next();
    controller.start('other');
    expect(controller.store.getState().active?.tutorial.id).toBe('other');
    expect(stepId(controller)).toBe('intro');
    controller.stop();
    expect(controller.store.getState().active).toBeNull();
    session.edits.addTrack('audio');
    expect(controller.store.getState()).toMatchObject({ active: null, finished: null });
    // Custom (non built-in) tours are listed but never recorded as completed.
    controller.start('other');
    for (let i = 0; i < 10 && controller.store.getState().active; i++) controller.next();
    expect(controller.store.getState().finished?.id).toBe('other');
    expect(controller.list().find((t) => t.id === 'other')).toMatchObject({
      builtIn: false,
      status: 'new',
    });
    await nextTask();
    expect(await platform.settingsRepository.get(PROGRESS_KEY)).toBeUndefined();
    expect(() => controller.register({ ...TOUR })).toThrow(/built-in/);
  });

  it('persists completion and dismissal of built-in tours and hides the first-run offer', async () => {
    const platform = createTestPlatform();
    const { controller } = await tourController(platform);
    expect(controller.store.getState().offer).toBe('show');
    expect(controller.list()).toEqual([
      {
        id: 'tour',
        title: 'Tour',
        description: 'A test tour.',
        steps: 6,
        builtIn: true,
        status: 'new',
      },
    ]);
    controller.start('tour');
    expect(controller.store.getState().offer).toBe('hidden');
    controller.skip();
    await nextTask();
    expect(controller.list()[0]!.status).toBe('dismissed');
    const saved =
      await platform.settingsRepository.get<Record<string, TutorialProgress>>(PROGRESS_KEY);
    expect(saved?.tour?.status).toBe('dismissed');
    expect(await platform.settingsRepository.get(OFFER_KEY)).toBe('accepted');

    controller.start('tour');
    for (let i = 0; i < 10 && controller.store.getState().active; i++) controller.next();
    await nextTask();
    expect(controller.list()[0]!.status).toBe('completed');
    // Skipping a replay keeps "completed".
    controller.start('tour');
    controller.skip();
    expect(controller.list()[0]!.status).toBe('completed');

    // A new controller over the same settings reads it back and doesn't offer the tour again.
    const { session: second } = await startSession(platform);
    const again = new TutorialController(second, [TOUR]);
    await again.load();
    expect(again.list()[0]!.status).toBe('completed');
    expect(again.store.getState().offer).toBe('hidden');
  });

  it('declining the first-run offer is remembered', async () => {
    const platform = createTestPlatform();
    const { controller, session } = await tourController(platform);
    controller.declineOffer();
    await nextTask();
    expect(await platform.settingsRepository.get(OFFER_KEY)).toBe('dismissed');
    const again = new TutorialController(session, [TOUR]);
    await again.load();
    expect(again.store.getState().offer).toBe('hidden');
  });
});
