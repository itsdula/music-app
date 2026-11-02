import { StudioPortalProvider } from '@studio/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudioShell } from '../src/components/StudioShell';
import { DEFAULT_STUDIO_CONFIG } from '../src/config';
import { TutorialController } from '../src/features/tutorial/controller';
import type { Tutorial } from '../src/features/tutorial/schema';
import { StudioSessionProvider } from '../src/session/context';
import { createStudioSession, type StudioSession } from '../src/session/studio-session';
import { createTestPlatform } from './helpers/test-platform';

const sessions: StudioSession[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (sessions.length) await sessions.pop()!.dispose();
});

/** Renders the real shell around a session the test can reach (tools, stores). */
async function renderShell() {
  const platform = createTestPlatform();
  const session = createStudioSession(platform, { ...DEFAULT_STUDIO_CONFIG, autosaveDelayMs: 5 });
  sessions.push(session);
  await session.start();
  await session.projects.newProject('empty');
  const controller = TutorialController.forSession(session);
  await controller.load();
  const utils = render(
    <div data-testid="studio-root" className="studio-root">
      <StudioSessionProvider session={session}>
        <StudioPortalProvider container={null}>
          <StudioShell />
        </StudioPortalProvider>
      </StudioSessionProvider>
    </div>,
  );
  return { session, controller, platform, ...utils };
}

/** jsdom has no layout: give every element a box so targets resolve and get a spotlight. */
function fakeLayout() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const root = this.matches('[data-testid="studio-root"]');
    const rect = root
      ? { left: 0, top: 0, width: 1200, height: 800 }
      : { left: 100, top: 100, width: 80, height: 28 };
    return {
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => rect,
    } as DOMRect;
  });
}

const card = () => screen.getByTestId('tutorial-card');

const SIMPLE: Tutorial = {
  id: 'simple',
  title: 'Simple tour',
  description: 'Three explanation steps.',
  steps: [
    { id: 'one', title: 'First', body: 'Body one.', advance: { type: 'next' } },
    { id: 'two', title: 'Second', body: 'Body two.', advance: { type: 'next' } },
    { id: 'three', title: 'Third', body: 'Body three.', advance: { type: 'next' } },
  ],
};

function startSimple(controller: TutorialController) {
  act(() => {
    controller.register(SIMPLE);
    controller.start('simple');
  });
}

describe('tutorial card', () => {
  it('shows title, body and progress, and moves with Next/Back', async () => {
    const user = userEvent.setup();
    const { controller } = await renderShell();
    startSimple(controller);
    const dialog = await screen.findByRole('dialog', { name: 'First' });
    expect(dialog).toBe(card());
    expect(dialog).toHaveAccessibleDescription('Body one.');
    expect(screen.getByTestId('tutorial-progress')).toHaveTextContent('1 of 3');
    expect(screen.getByTestId('tutorial-back')).toBeDisabled();
    // Step changes are announced politely.
    expect(document.querySelector('[aria-live="polite"][aria-atomic="true"]')).toHaveTextContent(
      'Simple tour, step 1 of 3: First. Body one.',
    );
    await user.click(screen.getByTestId('tutorial-next'));
    expect(card()).toHaveAttribute('data-step-id', 'two');
    expect(screen.getByTestId('tutorial-progress')).toHaveTextContent('2 of 3');
    await user.click(screen.getByTestId('tutorial-back'));
    expect(card()).toHaveAttribute('data-step-id', 'one');
    await user.click(screen.getByTestId('tutorial-next'));
    await user.click(screen.getByTestId('tutorial-next'));
    expect(screen.getByTestId('tutorial-next')).toHaveTextContent('Finish');
    await user.click(screen.getByTestId('tutorial-next'));
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
    const done = screen.getByTestId('tutorial-complete');
    expect(done).toHaveTextContent('You finished “Simple tour”');
    await user.click(within(done).getByTestId('tutorial-done'));
    expect(screen.queryByTestId('tutorial-complete')).not.toBeInTheDocument();
  });

  it('takes focus when nothing has it, and Escape on the card exits the tour', async () => {
    const user = userEvent.setup();
    const { controller } = await renderShell();
    startSimple(controller);
    const title = await screen.findByRole('heading', { name: 'First' });
    await waitFor(() => expect(title).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
    expect(controller.store.getState().active).toBeNull();
  });

  it('does not steal focus from a control the user is operating', async () => {
    const { controller } = await renderShell();
    const play = screen.getByTestId('transport-play');
    play.focus();
    startSimple(controller);
    await screen.findByTestId('tutorial-card');
    expect(play).toHaveFocus();
  });

  it('Skip ends the tour', async () => {
    const user = userEvent.setup();
    const { controller } = await renderShell();
    startSimple(controller);
    await user.click(await screen.findByTestId('tutorial-skip'));
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tutorial-complete')).not.toBeInTheDocument();
  });

  it('spotlights the target and advances when the user clicks it', async () => {
    fakeLayout();
    const user = userEvent.setup();
    const { controller } = await renderShell();
    act(() => {
      controller.register({
        id: 'click-play',
        title: 'Click play',
        description: 'Click.',
        steps: [
          {
            id: 'play',
            title: 'Press Play',
            body: 'Press it.',
            target: 'transport-play',
            advance: { type: 'click' },
          },
          { id: 'after', title: 'After', body: 'Done.', advance: { type: 'next' } },
        ],
      });
      controller.start('click-play');
    });
    const spot = await screen.findByTestId('tutorial-spotlight');
    // Padded around the target, relative to the Studio root.
    await waitFor(() =>
      expect(spot).toHaveStyle({ left: '94px', top: '94px', width: '92px', height: '40px' }),
    );
    expect(card()).not.toHaveAttribute('data-target-missing');
    // Clicking somewhere else does nothing; clicking the target advances.
    await user.click(screen.getByTestId('transport-stop'));
    await new Promise((r) => setTimeout(r, 10));
    expect(card()).toHaveAttribute('data-step-id', 'play');
    await user.click(screen.getByTestId('transport-play'));
    await waitFor(() => expect(card()).toHaveAttribute('data-step-id', 'after'));
    expect(screen.queryByTestId('tutorial-spotlight')).not.toBeInTheDocument();
  });

  it('falls back to a centered card when the target is not on screen', async () => {
    fakeLayout();
    const { controller } = await renderShell();
    act(() => {
      controller.register({
        id: 'missing',
        title: 'Missing',
        description: 'Target is not mounted.',
        steps: [
          {
            id: 'strip',
            title: 'Master strip',
            body: 'Look at the master strip.',
            target: 'master-strip',
            advance: { type: 'next' },
          },
        ],
      });
      controller.start('missing');
    });
    await waitFor(() => expect(card()).toHaveAttribute('data-target-missing', 'true'), {
      timeout: 4000,
    });
    expect(screen.getByTestId('tutorial-target-missing')).toBeInTheDocument();
    expect(screen.queryByTestId('tutorial-spotlight')).not.toBeInTheDocument();
    // The target appears later (mixer opened): the spotlight follows.
    act(() =>
      sessions[0]!.uiStore.setState((s) => ({
        ...s,
        panels: { ...s.panels, bottomPanel: 'mixer' },
      })),
    );
    await screen.findByTestId('tutorial-spotlight');
    await waitFor(() => expect(card()).not.toHaveAttribute('data-target-missing'));
  });
});

describe('Tutorial Creator end to end (jsdom)', () => {
  it('runs a tutorial created through create_tutorial by performing its steps in the UI', async () => {
    fakeLayout();
    const user = userEvent.setup();
    const { session } = await renderShell();
    const result = await act(() =>
      session.tools.call('create_tutorial', {
        tutorial: {
          id: 'audio-and-mixer',
          title: 'Audio track and mixer',
          description: 'Add an audio track and look at it in the mixer.',
          steps: [
            {
              id: 'add',
              title: 'Add an audio track',
              body: 'Click + and choose Audio track.',
              target: 'add-track',
              advance: {
                type: 'condition',
                condition: { type: 'trackCount', kind: 'audio', added: 1 },
              },
            },
            {
              id: 'mixer',
              title: 'Open the mixer',
              body: 'Switch to the Mixer tab.',
              target: 'tab:Mixer',
              advance: { type: 'condition', condition: { type: 'panelOpen', panel: 'mixer' } },
            },
            {
              id: 'strip',
              title: 'Your new channel',
              body: 'The newest track is on the right.',
              target: 'channel-strip:last',
              advance: { type: 'next' },
            },
          ],
        },
      }),
    );
    expect(result).toMatchObject({ ok: true, id: 'audio-and-mixer' });
    expect(await screen.findByRole('dialog', { name: 'Add an audio track' })).toBeInTheDocument();
    await screen.findByTestId('tutorial-spotlight');

    await user.click(screen.getByTestId('add-track'));
    await user.click(await screen.findByTestId('add-audio-track'));
    await waitFor(() => expect(card()).toHaveAttribute('data-step-id', 'mixer'));

    await user.click(screen.getByRole('tab', { name: 'Mixer' }));
    await waitFor(() => expect(card()).toHaveAttribute('data-step-id', 'strip'));
    expect(screen.getAllByTestId('channel-strip')).toHaveLength(2);
    await user.click(screen.getByTestId('tutorial-next'));
    expect(await screen.findByTestId('tutorial-complete')).toHaveTextContent(
      'Audio track and mixer',
    );
  });
});

describe('first-run offer and tutorial menu', () => {
  it('offers the tour once, without starting it, and remembers "Not now"', async () => {
    const user = userEvent.setup();
    const { controller, platform } = await renderShell();
    const offer = await screen.findByTestId('tutorial-offer');
    expect(offer).toHaveAccessibleName('Nawa tour');
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
    await user.click(within(offer).getByTestId('tutorial-offer-dismiss'));
    expect(screen.queryByTestId('tutorial-offer')).not.toBeInTheDocument();
    expect(controller.store.getState().active).toBeNull();
    await waitFor(async () =>
      expect(await platform.settingsRepository.get('studio.tutorials.firstRunOffer')).toBe(
        'dismissed',
      ),
    );
  });

  it('starts Getting started from the offer', async () => {
    const user = userEvent.setup();
    await renderShell();
    await user.click(await screen.findByTestId('tutorial-offer-start'));
    expect(card()).toHaveAttribute('data-tutorial-id', 'getting-started');
    expect(screen.getByTestId('tutorial-progress')).toHaveTextContent('1 of 14');
    expect(screen.queryByTestId('tutorial-offer')).not.toBeInTheDocument();
  });

  it('lists tutorials with completion state and starts or restarts them', async () => {
    const user = userEvent.setup();
    const { controller } = await renderShell();
    await user.click(screen.getByTestId('tutorial-menu'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
      'tutorial-item-getting-started',
      'tutorial-item-midi-controller',
      'tutorial-item-vocal-pitch',
      'tutorial-item-recording-audio',
      'tutorial-ask-assistant',
    ]);
    expect(screen.getByTestId('tutorial-item-recording-audio')).toHaveAttribute(
      'data-status',
      'new',
    );
    await user.click(screen.getByTestId('tutorial-item-recording-audio'));
    expect(card()).toHaveAttribute('data-tutorial-id', 'recording-audio');
    // Finish it, then the menu shows it as completed; the assistant hint opens the assistant.
    act(() => {
      for (let i = 0; i < 10 && controller.store.getState().active; i++) controller.next();
    });
    await user.click(screen.getByTestId('tutorial-menu'));
    expect(await screen.findByTestId('tutorial-item-recording-audio')).toHaveAttribute(
      'data-status',
      'completed',
    );
    await user.click(screen.getByTestId('tutorial-ask-assistant'));
    expect(sessions[0]!.uiStore.getState().assistantOpen).toBe(true);
  });

  it('can stop a running tutorial from the menu', async () => {
    const user = userEvent.setup();
    const { controller } = await renderShell();
    startSimple(controller);
    await user.click(screen.getByTestId('tutorial-menu'));
    expect(await screen.findByTestId('tutorial-item-simple')).toHaveAttribute(
      'data-status',
      'running',
    );
    await user.click(screen.getByTestId('tutorial-stop'));
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
  });
});
