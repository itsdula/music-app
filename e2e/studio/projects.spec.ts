import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage } from '../helpers';

async function fresh(page: Page): Promise<void> {
  await openStudio(page);
  await resetStorage(page);
  await page.reload();
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
}

async function goToProjects(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Projects' }).click();
  await expect(page.getByTestId('projects-page')).toBeVisible();
}

test.describe('Projects page', () => {
  test.beforeEach(async ({ page }) => fresh(page));

  test('lists all 30 sample projects and opens one as an editable copy', async ({ page }) => {
    await goToProjects(page);
    await expect(page.getByTestId('sample-open')).toHaveCount(30);
    await page.getByRole('button', { name: 'Techno', exact: true }).click();
    await expect(page.getByTestId('sample-open')).toHaveCount(5);
    await page.getByTestId('sample-open').first().click();
    // Opening switches to the arrangement with the sample's tracks.
    await expect(page.getByRole('radio', { name: 'Arrange' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByTestId('track-header').nth(2)).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText('Black Diamond');
  });

  test('creates, renames, duplicates and deletes projects', async ({ page }) => {
    await goToProjects(page);
    await expect(page.getByTestId('project-row')).toHaveCount(1);
    await page.getByTestId('projects-new').click();
    await goToProjects(page);
    await expect(page.getByTestId('project-row')).toHaveCount(2);

    // Rename the project that is not open.
    const other = page.getByTestId('project-row').filter({ hasNotText: 'Open' }).first();
    await other.getByRole('button', { name: /^Rename/ }).click();
    const input = page.getByRole('textbox', { name: 'Project name' });
    await input.fill('Renamed Song');
    await input.press('Enter');
    await expect(page.getByTestId('project-row').filter({ hasText: 'Renamed Song' })).toHaveCount(
      1,
    );

    // Duplicate it, then delete the copy (with confirmation).
    await page
      .getByTestId('project-row')
      .filter({ hasText: 'Renamed Song' })
      .getByTestId('project-duplicate')
      .click();
    await expect(
      page.getByTestId('project-row').filter({ hasText: 'Renamed Song (copy)' }),
    ).toHaveCount(1);
    await page
      .getByTestId('project-row')
      .filter({ hasText: 'Renamed Song (copy)' })
      .getByTestId('project-delete')
      .click();
    await page.getByTestId('project-delete-confirm').click();
    await expect(page.getByTestId('project-row')).toHaveCount(2);
  });

  test('edits the open project settings undoably', async ({ page }) => {
    await goToProjects(page);
    await page.getByTestId('project-settings').click();
    const tempo = page.getByRole('spinbutton', { name: 'Tempo (BPM)' }).last();
    await tempo.fill('97');
    await tempo.press('Enter');
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('radio', { name: 'Arrange' }).click();
    await expect(page.getByRole('spinbutton', { name: 'Tempo (BPM)' })).toHaveValue('97');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByRole('spinbutton', { name: 'Tempo (BPM)' })).toHaveValue('120');
  });
});
