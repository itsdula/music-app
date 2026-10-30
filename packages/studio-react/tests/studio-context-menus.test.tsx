import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Studio } from '../src/Studio';
import { createTestPlatform } from './helpers/test-platform';

async function renderStudio() {
  const platform = createTestPlatform();
  const utils = render(<Studio platform={platform} config={{ autosaveDelayMs: 5 }} />);
  await waitFor(
    () => expect(screen.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready'),
    { timeout: 5000 },
  );
  return { platform, ...utils };
}

describe('Studio context menus', () => {
  it('duplicates a track from its header menu (undoable)', async () => {
    const user = userEvent.setup();
    await renderStudio();
    const header = screen.getAllByTestId('track-header')[0]!;
    fireEvent.contextMenu(header, { clientX: 20, clientY: 20 });
    const menu = await screen.findByTestId('studio-context-menu');
    expect(menu).toHaveAttribute('data-menu-target', 'track');
    await user.click(within(menu).getByTestId('menu-track-duplicate'));
    expect(screen.getAllByTestId('track-header')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(screen.getAllByTestId('track-header')).toHaveLength(1);
  });

  it('renames a track from its header menu', async () => {
    const user = userEvent.setup();
    await renderStudio();
    fireEvent.contextMenu(screen.getAllByTestId('track-header')[0]!, { clientX: 20, clientY: 20 });
    await user.click(await screen.findByTestId('menu-track-rename'));
    const input = await screen.findByTestId('track-rename-input');
    await waitFor(() => expect(input).toHaveFocus());
    await user.clear(input);
    await user.type(input, 'Piano{Enter}');
    expect(screen.getAllByTestId('track-header')[0]).toHaveAttribute('aria-label', 'Piano track');
  });

  it('suppresses the browser menu anywhere inside Studio', async () => {
    await renderStudio();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    screen.getByTestId('transport-bar').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('points to the piano roll while no clip is open', async () => {
    await renderStudio();
    expect(screen.getByTestId('piano-roll-hint')).toHaveTextContent(
      'Select a MIDI clip to edit notes in the piano roll',
    );
  });
});
