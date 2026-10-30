import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { TUTORIAL_ANCHORS } from '../src/features/tutorial/anchors';
import { TutorialController } from '../src/features/tutorial/controller';
import { CONDITION_TYPES } from '../src/features/tutorial/schema';
import { TOOL_NAME_PATTERN } from '../src/session/tools/registry';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { createTestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];

async function startSession() {
  const session = createStudioSession(createTestPlatform(), {
    ...DEFAULT_STUDIO_CONFIG,
    autosaveDelayMs: 5,
  });
  sessions.push(session);
  await session.start();
  return { session, controller: TutorialController.forSession(session) };
}

afterEach(async () => {
  while (sessions.length) await sessions.pop()!.dispose();
});

const reverbTour = {
  id: 'add-reverb',
  title: 'Add reverb',
  description: 'Put reverb on the selected track.',
  steps: [
    {
      id: 'devices',
      title: 'Show the devices',
      body: 'Open the track devices.',
      target: 'button:Show track devices',
      before: { openPanel: 'editor' },
      advance: { type: 'condition', condition: { type: 'noClipOpen' } },
    },
    {
      id: 'add',
      title: 'Add Reverb',
      body: 'Click Add effect and choose Reverb.',
      target: 'add-effect',
      advance: { type: 'condition', condition: { type: 'effectCount', added: 1 } },
    },
    { id: 'done', title: 'Done', body: 'Nice.', advance: { type: 'next' } },
  ],
};

describe('tutorial tools', () => {
  it('registers valid tools whose descriptions document anchors and conditions', async () => {
    const { session } = await startSession();
    const names = ['list_tutorials', 'start_tutorial', 'create_tutorial', 'stop_tutorial'];
    for (const name of names) {
      const tool = session.tools.get(name);
      expect(tool, name).toBeDefined();
      expect(name).toMatch(TOOL_NAME_PATTERN);
      expect(tool!.inputSchema.type).toBe('object');
    }
    expect(session.tools.get('list_tutorials')!.readOnly).toBe(true);
    const description = session.tools.get('create_tutorial')!.description;
    for (const anchor of TUTORIAL_ANCHORS) expect(description).toContain(`- ${anchor.id}: `);
    for (const type of CONDITION_TYPES) expect(description).toContain(`- ${type}`);
  });

  it('lists tutorials with their state and the running one', async () => {
    const { session } = await startSession();
    const result = (await session.tools.call('list_tutorials', {})) as {
      tutorials: { id: string; builtIn: boolean; status: string }[];
      active: unknown;
    };
    expect(result.tutorials.map((t) => t.id)).toEqual([
      'getting-started',
      'midi-controller',
      'vocal-pitch',
      'recording-audio',
    ]);
    expect(result.tutorials.every((t) => t.builtIn && t.status === 'new')).toBe(true);
    expect(result.active).toBeNull();
  });

  it('starts and stops a built-in tutorial', async () => {
    const { session, controller } = await startSession();
    await expect(session.tools.call('start_tutorial', { id: 'nope' })).rejects.toThrow(
      /Unknown tutorial "nope". Available: getting-started/,
    );
    const started = await session.tools.call('start_tutorial', { id: 'getting-started' });
    expect(started).toMatchObject({
      started: 'getting-started',
      active: { id: 'getting-started', step: 1, of: 14, stepTitle: 'Welcome to Studio' },
    });
    expect(controller.store.getState().active?.tutorial.id).toBe('getting-started');
    expect(await session.tools.call('stop_tutorial', {})).toEqual({ stopped: 'getting-started' });
    expect(controller.store.getState().active).toBeNull();
    expect(await session.tools.call('stop_tutorial', {})).toEqual({ stopped: null });
  });

  it('create_tutorial returns precise errors for the model to fix', async () => {
    const { session, controller } = await startSession();
    const bad = {
      ...reverbTour,
      id: 'getting-started',
      steps: [
        { ...reverbTour.steps[0], target: 'reverb-button' },
        { ...reverbTour.steps[1], advance: { type: 'tool', name: 'summon_reverb' } },
      ],
    };
    const result = (await session.tools.call('create_tutorial', { tutorial: bad })) as {
      ok: boolean;
      errors: string[];
    };
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      'tutorial.id "getting-started" is reserved by a built-in tutorial; choose another id',
      expect.stringMatching(/^tutorial\.steps\[0\]\.target "reverb-button" is not a known anchor/),
      'tutorial.steps[1].advance.name "summon_reverb" is not an available tool',
    ]);
    expect(controller.store.getState().active).toBeNull();
    // Schema-level problems are rejected by the registry before the tool runs.
    await expect(session.tools.call('create_tutorial', {})).rejects.toThrow(
      'input.tutorial is required',
    );
  });

  it('create_tutorial registers and starts a valid tutorial that advances on real edits', async () => {
    const { session, controller } = await startSession();
    const trackId = session.history.present.trackOrder[0]!;
    session.edits.createMidiClip(trackId, 0); // opens the clip, so step 1 has work to do
    const result = await session.tools.call('create_tutorial', { tutorial: reverbTour });
    expect(result).toMatchObject({
      ok: true,
      id: 'add-reverb',
      started: true,
      active: { id: 'add-reverb', step: 1, of: 3 },
    });
    expect(session.uiStore.getState().panels).toMatchObject({
      bottomOpen: true,
      bottomPanel: 'editor',
    });
    expect(controller.list().at(-1)).toMatchObject({ id: 'add-reverb', builtIn: false });
    session.uiStore.setState((s) => ({ ...s, selection: { ...s.selection, editorClipId: null } }));
    expect(controller.store.getState().active?.stepIndex).toBe(1);
    session.edits.addEffect(trackId, 'reverb');
    expect(controller.store.getState().active?.stepIndex).toBe(2);
    // A step can wait for any tool, including the assistant's own.
    const listed = (await session.tools.call('list_tutorials', {})) as {
      active: { id: string; step: number };
    };
    expect(listed.active).toMatchObject({ id: 'add-reverb', step: 3 });
    // Creating again with the same id replaces it.
    await session.tools.call('create_tutorial', {
      tutorial: { ...reverbTour, title: 'Reverb v2' },
    });
    expect(controller.list().filter((t) => t.id === 'add-reverb')).toHaveLength(1);
    expect(controller.store.getState().active?.tutorial.title).toBe('Reverb v2');
  });

  it('stops the running tutorial when the tools are uninstalled (session dispose)', async () => {
    const { session, controller } = await startSession();
    await session.tools.call('start_tutorial', { id: 'getting-started' });
    await session.dispose();
    sessions.length = 0;
    expect(controller.store.getState().active).toBeNull();
    expect(session.tools.get('create_tutorial')).toBeUndefined();
  });
});
