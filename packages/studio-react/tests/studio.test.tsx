import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Studio } from '../src/Studio';
import { createTestPlatform } from './helpers/test-platform';
import { startEmptyProject } from './helpers/start';

async function renderStudio() {
  const platform = createTestPlatform();
  const utils = render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
  await waitFor(
    () => expect(screen.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready'),
    { timeout: 5000 },
  );
  await startEmptyProject();
  return { platform, ...utils };
}

describe('start screen', () => {
  it('asks for a project on load and lists saved projects on the next load', async () => {
    const platform = createTestPlatform();
    const first = render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
    expect(
      await screen.findByRole('heading', { name: 'No project open' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('transport-bar')).not.toBeInTheDocument();
    expect(await screen.findByTestId('start-recent-empty')).toBeInTheDocument();
    expect(screen.getAllByTestId('start-sample').length).toBeGreaterThan(0);

    await startEmptyProject();
    expect(screen.getByTestId('project-name')).toHaveTextContent('Untitled Project');
    first.unmount();

    render(
      <Studio
        platform={{ ...platform, dispose: async () => {} }}
        config={{ autosaveDelayMs: 5 }}
      />,
    );
    const recent = await screen.findByTestId('start-recent', {}, { timeout: 5000 });
    expect(recent).toHaveTextContent('Untitled Project');
    expect(within(recent).getByText('Last opened')).toBeInTheDocument();
    await userEvent.setup().click(recent);
    expect(await screen.findByTestId('transport-bar', {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('<Studio /> with an injected platform', () => {
  it('boots and renders the transport, browser and arrangement', async () => {
    await renderStudio();
    expect(screen.getByTestId('transport-bar')).toBeInTheDocument();
    expect(screen.getByTestId('browser-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('track-header')).toHaveLength(1);
    expect(screen.getByTestId('project-name')).toHaveTextContent('Untitled Project');
  });

  it('adds a track from the browser and undoes it from the transport bar', async () => {
    const user = userEvent.setup();
    await renderStudio();
    const browser = screen.getByTestId('browser-panel');
    await user.dblClick(within(browser).getByText('Bright Lead'));
    expect(screen.getAllByTestId('track-header')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(screen.getAllByTestId('track-header')).toHaveLength(1);
  });

  it('plays and stops with the Space shortcut', async () => {
    const user = userEvent.setup();
    const { platform } = await renderStudio();
    await user.click(screen.getByTestId('arrangement-lanes'));
    await user.keyboard(' ');
    await waitFor(() => expect(platform.engine.getTransportPosition().state).toBe('playing'));
    await user.keyboard(' ');
    await waitFor(() => expect(platform.engine.getTransportPosition().state).toBe('stopped'));
  });

  it('mutes a track from its header', async () => {
    const user = userEvent.setup();
    await renderStudio();
    const header = screen.getAllByTestId('track-header')[0]!;
    const mute = within(header).getByTestId('track-mute');
    await user.click(mute);
    expect(mute).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the MIDI device section and connects to a scripted device', async () => {
    const user = userEvent.setup();
    const { platform } = await renderStudio();
    await user.click(screen.getByTestId('midi-connect'));
    act(() =>
      platform.midiPort.connect({
        id: 'in-1',
        name: 'MPK mini 3',
        type: 'input',
        state: 'connected',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('midi-device')).toHaveTextContent('MPK mini 3'));
  });
});

describe('arrangement keyboard access', () => {
  it('selects clips with ] and moves them with arrow keys', async () => {
    const user = userEvent.setup();
    const platform = createTestPlatform();
    render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
    await waitFor(
      () =>
        expect(screen.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready'),
      { timeout: 5000 },
    );
    await startEmptyProject();
    // Create a clip on the first track through the lanes' double-click handler.
    const lanes = screen.getByTestId('arrangement-lanes');
    await user.dblClick(lanes);
    await user.click(lanes);
    await user.keyboard(']');
    await waitFor(() =>
      expect(screen.getByTestId('arrangement-announcement')).toHaveTextContent(
        /1\.1\.1 to 2\.1\.1/,
      ),
    );
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() =>
      expect(screen.getByTestId('arrangement-announcement')).toHaveTextContent(
        /2\.1\.1 to 3\.1\.1/,
      ),
    );
  });
});
