import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage } from '../helpers';

async function freshStudio(page: Page): Promise<void> {
  await openStudio(page);
  await resetStorage(page);
  await page.reload();
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
}

test.describe('AI assistant', () => {
  test('opens from the toolbar and explains that no assistant is configured', async ({ page }) => {
    // The site (GitHub Pages) ships without an assistant transport.
    await freshStudio(page);
    await page.getByTestId('open-assistant').click();
    const panel = page.getByTestId('assistant-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('alert')).toContainText(
      "The AI assistant isn't available here: no assistant endpoint is configured for this copy of Nawa.",
    );
    await expect(page.getByTestId('assistant-input')).toBeDisabled();
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="assistant-panel"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    await panel.getByRole('button', { name: 'Close assistant' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('exposes Studio tools to in-page agents through WebMCP', async ({ page }) => {
    // A stand-in for a browser agent: a fake document.modelContext (current WebMCP draft shape).
    await page.addInitScript(() => {
      type Tool = {
        name: string;
        inputSchema: unknown;
        annotations?: { readOnlyHint?: boolean };
        execute: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
      };
      const tools = new Map<string, Tool>();
      Object.defineProperty(window, '__webmcpTools', { value: tools });
      Object.defineProperty(document, 'modelContext', {
        configurable: true,
        value: {
          registerTool(tool: Tool, options?: { signal?: AbortSignal }) {
            tools.set(tool.name, tool);
            options?.signal?.addEventListener('abort', () => tools.delete(tool.name));
            return Promise.resolve();
          },
        },
      });
    });
    await freshStudio(page);

    const names = await page.evaluate(() => {
      const tools = (window as unknown as { __webmcpTools: Map<string, unknown> }).__webmcpTools;
      return [...tools.keys()];
    });
    expect(names).toEqual(
      expect.arrayContaining(['get_project_summary', 'add_track', 'add_drum_pattern', 'navigate']),
    );

    // An agent builds a beat and opens the mixer; the UI reflects it.
    const results = await page.evaluate(async () => {
      type Result = { content: { text: string }[]; isError?: boolean };
      const tools = (
        window as unknown as {
          __webmcpTools: Map<string, { execute: (input: unknown) => Promise<Result> }>;
        }
      ).__webmcpTools;
      const run = (name: string, input: unknown) => tools.get(name)!.execute(input);
      return [
        await run('add_track', { instrument: 'drums', name: 'Agent Drums' }),
        await run('add_drum_pattern', {
          trackId: 'Agent Drums',
          bars: 2,
          pattern: { kick: 'x---x---x---x---', clap: '----x-------x---' },
        }),
        await run('set_tempo', { bpm: 9999 }),
        await run('navigate', { view: 'mixer' }),
      ];
    });
    expect(results.map((r) => Boolean(r.isError))).toEqual([false, false, true, false]);
    expect(JSON.parse(results[1]!.content[0]!.text)).toMatchObject({
      clip: { lengthBars: 2, noteCount: 12 },
    });
    expect(results[2]!.content[0]!.text).toContain('bpm must be');

    await expect(page.getByTestId('track-header')).toHaveCount(2);
    await expect(page.getByTestId('track-header').nth(1)).toContainText('Agent Drums');
    // Agent edits are ordinary undoable edits.
    await expect(page.getByRole('button', { name: 'Undo Add Drum Pattern' })).toBeEnabled();
  });
});
