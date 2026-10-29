import { expect, test } from '@playwright/test';

/**
 * Runs on both hosts (Next.js /studio and the Vite host): the same portable <Studio />
 * must boot to a ready state with the transport and arrangement visible.
 */
test('the portable <Studio /> boots in this host', async ({ page, baseURL }) => {
  const path = baseURL?.includes('3100') ? '/studio' : '/';
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(path);
  const root = page.getByTestId('studio-root');
  await expect(root).toHaveAttribute('data-studio-status', 'ready', { timeout: 20_000 });
  await expect(page.getByTestId('transport-bar')).toBeVisible();
  await expect(page.getByTestId('arrangement')).toBeVisible();
  await expect(page.getByTestId('track-header').first()).toBeVisible();
  expect(errors).toEqual([]);
});
