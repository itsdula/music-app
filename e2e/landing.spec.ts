import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the hero heading', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();
    await expect(page.getByText('A music workstation that runs in your browser.')).toBeVisible();
  });

  test('"Open Studio" links point to /studio', async ({ page }) => {
    const hero = page.getByRole('region', { name: 'Studio' });
    const heroCta = hero.getByRole('link', { name: 'Open Studio' });
    await expect(heroCta).toHaveAttribute('href', '/studio');

    const all = page.getByRole('link', { name: 'Open Studio' });
    const count = await all.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      await expect(all.nth(i)).toHaveAttribute('href', '/studio');
    }
  });

  test('shows every section heading in order', async ({ page }) => {
    const sections = [
      'A complete workstation, in a tab',
      'AKAI Professional MPK Mini MK3 integration',
      'Vocal pitch editor',
      'Built to be portable',
      'Browser support',
      'Start your next track in the browser',
    ];
    for (const name of sections) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    const h2s = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(h2s.map((t) => t.trim())).toEqual(sections);
  });

  test('shows each feature heading', async ({ page }) => {
    const features = page.getByRole('region', { name: 'A complete workstation, in a tab' });
    for (const name of [
      'Multitrack arrangement',
      'Piano roll and instruments',
      'Mixer and effects',
      'Microphone recording',
      'Offline WAV export',
      'Local projects',
    ]) {
      await expect(features.getByRole('heading', { level: 3, name })).toBeVisible();
    }
  });

  test('has landmarks and a working features anchor', async ({ page }) => {
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();

    await page.getByRole('link', { name: 'See what it does' }).click();
    await expect(page).toHaveURL(/#features$/);
  });

  test('"Open Studio" navigates to the workstation', async ({ page }) => {
    await page.getByRole('main').getByRole('link', { name: 'Open Studio' }).first().click();
    await expect(page).toHaveURL(/\/studio$/);
  });
});
