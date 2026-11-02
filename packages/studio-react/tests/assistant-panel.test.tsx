import type { AssistantResponse } from '@studio/platform-contracts';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Studio } from '../src/Studio';
import {
  assistantError,
  createTestPlatform,
  FakeAssistantTransport,
} from './helpers/test-platform';

async function renderStudio(transport?: FakeAssistantTransport) {
  const platform = createTestPlatform(transport ? { assistant: transport } : {});
  const utils = render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
  await waitFor(
    () => expect(screen.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready'),
    { timeout: 5000 },
  );
  return { platform, ...utils };
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('open-assistant'));
  return screen.getByTestId('assistant-panel');
}

describe('<AssistantPanel />', () => {
  it('explains that the assistant is not configured when the host has no transport', async () => {
    const user = userEvent.setup();
    await renderStudio();
    const panel = await openPanel(user);
    expect(panel).toHaveAccessibleName('AI assistant');
    expect(within(panel).getByRole('alert')).toHaveTextContent(
      "The AI assistant isn't available here: no assistant endpoint is configured for this copy of Nawa.",
    );
    expect(screen.getByTestId('assistant-input')).toBeDisabled();
    expect(screen.getByTestId('assistant-send')).toBeDisabled();
  });

  it('shows the not-configured message when the transport reports not-configured', async () => {
    const user = userEvent.setup();
    await renderStudio(new FakeAssistantTransport([assistantError('not-configured')]));
    await openPanel(user);
    await user.type(screen.getByTestId('assistant-input'), 'hello{Enter}');
    expect(await screen.findByTestId('assistant-not-configured')).toHaveTextContent(
      'no assistant endpoint is configured',
    );
  });

  it('runs a scripted conversation that creates a clip and navigates, showing tool chips', async () => {
    const user = userEvent.setup();
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([
        {
          name: 'add_chord_progression',
          input: { trackId: 'Keys', chords: ['Am', 'F', 'C', 'G'] },
        },
        { name: 'navigate', input: { view: 'editor' } },
      ]),
      FakeAssistantTransport.reply(
        'Added a progression:\n\n- Am\n- F\n- C\n- G\n\nIt is on the `Keys` track.',
      ),
    );
    const { platform } = await renderStudio(transport);
    await openPanel(user);
    expect(screen.getByTestId('assistant-input')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Add a chord progression in A minor' }));

    await waitFor(() => expect(screen.getAllByTestId('assistant-message')).toHaveLength(2));
    const [userMsg, reply] = screen.getAllByTestId('assistant-message');
    expect(userMsg).toHaveTextContent('Add a chord progression in A minor');
    expect(within(reply!).getAllByRole('listitem')).toHaveLength(4);
    expect(within(reply!).getByText('Keys').tagName).toBe('CODE');
    expect(screen.getByTestId('assistant-live')).toHaveTextContent(/Assistant: Added/);

    const chips = screen.getAllByTestId('assistant-tool-call');
    expect(chips.map((c) => c.getAttribute('data-tool'))).toEqual([
      'add_chord_progression',
      'navigate',
    ]);
    expect(chips.every((c) => c.getAttribute('data-status') === 'ok')).toBe(true);
    const toggle = within(chips[0]!).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(chips[0]).toHaveTextContent('"chords"');
    expect(chips[0]).toHaveTextContent('Result');

    // The edits happened in the real session (one undo entry) and the page changed.
    expect(screen.getByTestId('editor-view')).toBeInTheDocument();
    const clipAdds = () =>
      platform.engine.changes.flat().filter((c) => c.type === 'clip.add').length;
    await waitFor(() => expect(clipAdds()).toBe(1));
    const undo = screen.getByRole('button', { name: 'Undo Add Chord Progression' });
    await user.click(undo);
    await waitFor(() =>
      expect(platform.engine.changes.flat().some((c) => c.type === 'clip.remove')).toBe(true),
    );
  });

  it('sends with Enter, inserts newlines with Shift+Enter and clears the chat', async () => {
    const user = userEvent.setup();
    const transport = new FakeAssistantTransport([
      FakeAssistantTransport.reply('First'),
      FakeAssistantTransport.reply('Second'),
    ]);
    await renderStudio(transport);
    await openPanel(user);
    const input = screen.getByTestId('assistant-input');
    await user.type(input, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(input).toHaveValue('line one\nline two');
    expect(transport.requests).toHaveLength(0);
    await user.keyboard('{Enter}');
    await screen.findByText('First');
    expect(input).toHaveValue('');
    const sent = transport.requests[0]!.messages.at(-1);
    expect(sent).toEqual({ role: 'user', content: 'line one\nline two' });
    await user.type(input, 'again');
    await user.click(screen.getByTestId('assistant-send'));
    await screen.findByText('Second');
    await user.click(screen.getByTestId('assistant-clear'));
    expect(screen.queryAllByTestId('assistant-message')).toHaveLength(0);
    expect(screen.getAllByTestId('assistant-suggestion').length).toBeGreaterThan(2);
  });

  it('shows a loading state with a stop button that aborts the turn', async () => {
    const user = userEvent.setup();
    const transport = new FakeAssistantTransport([
      () => new Promise<AssistantResponse>(() => undefined),
    ]);
    await renderStudio(transport);
    await openPanel(user);
    await user.type(screen.getByTestId('assistant-input'), 'take your time{Enter}');
    expect(await screen.findByRole('status', { name: 'Assistant is working' })).toBeInTheDocument();
    await user.click(screen.getByTestId('assistant-stop'));
    expect(await screen.findByTestId('assistant-notice')).toHaveTextContent('Stopped');
    expect(screen.getByTestId('assistant-send')).toBeInTheDocument();
  });

  it('shows errors with a retry button', async () => {
    const user = userEvent.setup();
    const transport = new FakeAssistantTransport([
      assistantError('network', 'fetch failed'),
      FakeAssistantTransport.reply('Back online'),
    ]);
    await renderStudio(transport);
    await openPanel(user);
    await user.type(screen.getByTestId('assistant-input'), 'hello{Enter}');
    expect(await screen.findByTestId('assistant-error')).toHaveTextContent(
      'Could not reach the assistant server',
    );
    await user.click(screen.getByTestId('assistant-retry'));
    await screen.findByText('Back online');
    expect(screen.queryByTestId('assistant-error')).not.toBeInTheDocument();
  });

  it('states deletions on the tool chip and follows the user into a project it creates', async () => {
    const user = userEvent.setup();
    const transport = new FakeAssistantTransport();
    transport.enqueue(
      transport.toolCalls([{ name: 'delete_track', input: { trackId: 'Keys' } }]),
      FakeAssistantTransport.reply('Removed the Keys track.'),
      transport.toolCalls([{ name: 'new_project', input: { name: 'Next' } }]),
      FakeAssistantTransport.reply('Opened a fresh project.'),
    );
    await renderStudio(transport);
    await openPanel(user);
    await user.type(screen.getByTestId('assistant-input'), 'delete keys{Enter}');
    expect(await screen.findByTestId('assistant-deletion')).toHaveTextContent(
      'Deleted track “Keys”. Undo restores it.',
    );
    await screen.findByText('Removed the Keys track.');
    await user.type(screen.getByTestId('assistant-input'), 'new project{Enter}');
    // The assistant switched projects itself, so the conversation follows to the new project.
    await waitFor(() => expect(screen.getByTestId('project-name')).toHaveTextContent('Next'));
    await screen.findByText('Opened a fresh project.');
    expect(screen.getAllByTestId('assistant-message')).toHaveLength(4);
  });

  it('closes from its header', async () => {
    const user = userEvent.setup();
    await renderStudio(new FakeAssistantTransport());
    await openPanel(user);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Close assistant' }));
    });
    expect(screen.queryByTestId('assistant-panel')).not.toBeInTheDocument();
  });
});
