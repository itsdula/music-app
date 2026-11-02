import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage, startEmptyProject } from '../helpers';

async function fresh(page: Page): Promise<void> {
  await openStudio(page);
  await resetStorage(page);
  await page.reload();
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
  await startEmptyProject(page);
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

test.describe('Start dialog', () => {
  test('asks for a project on load, opens a sample and comes back after closing it', async ({
    page,
  }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    const dialog = page.getByRole('dialog', { name: 'No project open' });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    // It cannot be dismissed: there is no project behind it to go back to.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    await page.getByTestId('start-tab-recent').click();
    await expect(page.getByTestId('start-recent-empty')).toBeVisible();
    await page.getByTestId('start-tab-samples').click();
    await expect(page.getByTestId('start-sample')).toHaveCount(30);
    await page.getByRole('button', { name: 'Techno', exact: true }).click();
    await page.getByTestId('start-sample').first().click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('project-name')).toHaveText('Black Diamond');

    await page.getByTestId('project-menu').click();
    await page.getByTestId('menu-close-project').click();
    await expect(dialog).toBeVisible();
    // With saved projects, the dialog opens on "Your projects".
    const recent = page.getByTestId('start-recent');
    await expect(recent).toHaveCount(1);
    await expect(recent).toContainText('Black Diamond');
    await expect(recent).toContainText('Last opened');

    await page.reload();
    await page.getByTestId('start-recent').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('project-name')).toHaveText('Black Diamond');
  });
});
