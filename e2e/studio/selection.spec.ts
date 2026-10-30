import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage } from '../helpers';

const clipTab = (page: Page) => page.getByRole('tab', { name: 'Piano Roll' });
const trackTab = (page: Page) => page.getByRole('tab', { name: 'Track', exact: true });
const selectedTracks = (page: Page) =>
  page.locator('[data-testid=track-header][aria-current=true]');

test.describe('Selection and the bottom panel', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
  });

  test('the piano roll follows the selected region and clicking away deselects it', async ({
    page,
  }) => {
    // No region yet: the piano roll tab is disabled and explains why on hover.
    await expect(trackTab(page)).toHaveAttribute('data-state', 'active');
    await expect(clipTab(page)).toBeDisabled();
    await page.getByTestId('clip-tab-disabled').hover();
    await expect(page.getByRole('tooltip')).toContainText('Select a MIDI region');

    const lanes = page.getByTestId('arrangement-lanes');
    const box = (await lanes.boundingBox())!;
    await page.mouse.dblclick(box.x + 30, box.y + 30); // create + open a region
    await expect(clipTab(page)).toHaveAttribute('data-state', 'active');

    // Working in the piano roll or on the track's buttons keeps the region.
    const grid = (await page.getByTestId('piano-roll-grid').boundingBox())!;
    await page.mouse.click(grid.x + grid.width / 2, grid.y + grid.height / 2);
    await page.getByTestId('track-mute').first().click();
    await expect(clipTab(page)).toHaveAttribute('data-state', 'active');

    // Clicking the track itself selects the track and drops the region.
    await page
      .getByTestId('track-header')
      .first()
      .click({ position: { x: 150, y: 12 } });
    await expect(clipTab(page)).toBeDisabled();
    await expect(trackTab(page)).toHaveAttribute('data-state', 'active');

    // A single click on the region makes it the piano roll target again; empty lane space drops it.
    await page.mouse.click(box.x + 30, box.y + 30);
    await expect(clipTab(page)).toBeEnabled();
    await page.mouse.click(box.x + box.width - 40, box.y + 30);
    await expect(clipTab(page)).toBeDisabled();

    // Empty space in the track list deselects the track.
    await expect(selectedTracks(page)).toHaveCount(1);
    const list = (await page.getByTestId('track-list').boundingBox())!;
    await page.mouse.click(list.x + 40, list.y + list.height - 20);
    await expect(selectedTracks(page)).toHaveCount(0);
  });

  test('browser items are added by double-click and by dropping on a track or its devices', async ({
    page,
  }) => {
    const browser = page.getByTestId('browser-panel');
    await page
      .getByTestId('track-header')
      .first()
      .click({ position: { x: 150, y: 12 } });

    await browser.getByRole('button', { name: 'Reverb' }).dblclick();
    await expect(page.getByTestId('effect-unit')).toHaveCount(1);
    await browser.getByRole('button', { name: 'Delay' }).dragTo(page.getByTestId('track-devices'));
    await expect(page.getByTestId('effect-unit')).toHaveCount(2);
    await browser
      .getByRole('button', { name: 'Gain' })
      .dragTo(page.getByTestId('track-header').first());
    await expect(page.getByTestId('effect-unit')).toHaveCount(3);

    // A new instrument track is selected and its devices are shown.
    await browser.getByRole('button', { name: 'Pluck' }).dblclick();
    await expect(page.getByTestId('track-header')).toHaveCount(2);
    await expect(selectedTracks(page)).toContainText('Pluck');
    await expect(page.getByTestId('effect-unit')).toHaveCount(0);
  });
});
