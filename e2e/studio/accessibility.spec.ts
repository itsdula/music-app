import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { detunedVocalWav } from '../audio-fixtures';
import { openStudio, resetStorage } from '../helpers';

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on Studio's main surfaces and dialogs.
 * Canvas content (arrangement, piano roll, pitch editor) is outside what axe can inspect;
 * those editors expose text alternatives and keyboard paths covered by other specs.
 * Automated checks find a subset of issues; a manual screen-reader pass is still needed.
 */
async function expectNoViolations(
  page: Page,
  label: string,
  selector = '[data-testid="studio-root"]',
) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const found = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} — ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ')}`,
  );
  expect(found, label).toEqual([]);
}

test.describe('Accessibility (axe, WCAG 2.1 AA)', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
  });

  test('arrangement, track devices, mixer and controller panel', async ({ page }) => {
    await page.getByTestId('project-menu').click();
    await page.getByRole('menuitem', { name: 'New demo project' }).click();
    await expect(page.getByTestId('track-header')).toHaveCount(3);
    await expectNoViolations(page, 'arrangement + track devices');
    await page.getByRole('tab', { name: 'Mixer' }).click();
    await expectNoViolations(page, 'mixer');
    await page.getByRole('tab', { name: 'Controller' }).click();
    await expectNoViolations(page, 'controller: hardware');
    for (const view of ['Mappings', 'Diagnostics', 'Compatibility']) {
      await page.getByTestId('controller-panel').getByRole('radio', { name: view }).click();
      await expectNoViolations(page, `controller: ${view}`);
    }
  });

  test('export, settings and keyboard-shortcut dialogs', async ({ page }) => {
    await page.getByTestId('open-export').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'export dialog', '[role="dialog"]');
    await page.keyboard.press('Escape');
    await page.getByTestId('open-settings').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'settings dialog', '[role="dialog"]');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoViolations(page, 'shortcuts dialog', '[role="dialog"]');
  });

  test('vocal editor after analysis', async ({ page }) => {
    test.setTimeout(90_000);
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('import-audio').click();
    await (
      await chooser
    ).setFiles({ name: 'Lead Vox.wav', mimeType: 'audio/wav', buffer: detunedVocalWav() });
    await page.getByTestId('arrangement-lanes').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio', { name: 'Pitch (vocal)' }).click();
    await expectNoViolations(page, 'vocal editor: before analysis');
    await page.getByRole('button', { name: /Analyze vocal/ }).click();
    await expect(page.getByTestId('vocal-editor')).toHaveAttribute('data-state', 'ready', {
      timeout: 60_000,
    });
    await page.getByTestId('vocal-notes-list-toggle').click();
    await expectNoViolations(page, 'vocal editor: analyzed, notes list open');
  });
});
