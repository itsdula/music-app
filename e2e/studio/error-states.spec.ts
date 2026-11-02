import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage, startEmptyProject } from '../helpers';

async function freshStudio(page: Page): Promise<void> {
  await openStudio(page);
  await resetStorage(page);
  await page.reload();
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
  await startEmptyProject(page);
}

test.describe('Error states are explained, not silent', () => {
  test('a browser without Web MIDI shows an unsupported state instead of a broken button', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        value: undefined,
        configurable: true,
      });
    });
    await freshStudio(page);
    const section = page.getByTestId('midi-devices');
    await expect(section.getByRole('status')).toContainText('no Web MIDI support');
    await expect(page.getByTestId('midi-connect')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Controller' }).click();
    await expect(page.getByTestId('controller-panel')).toContainText('Web MIDI unavailable');
  });

  test('denied MIDI permission explains how to allow it', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      });
    });
    await freshStudio(page);
    await page.getByTestId('midi-connect').click();
    await expect(page.getByTestId('midi-devices').getByRole('status')).toContainText(
      'MIDI permission was denied',
    );
    // The user can retry after changing the site setting.
    await expect(page.getByTestId('midi-connect')).toBeVisible();
  });

  test('a denied microphone stops the transport and says how to fix it', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
      });
    });
    await freshStudio(page);
    await page.getByTestId('add-track').click();
    await page.getByTestId('add-audio-track').click();
    const headers = page.getByTestId('track-header');
    await headers.nth(1).getByTestId('track-arm').click();
    await page.getByTestId('transport-record').click();
    await expect(page.getByText('Microphone access was denied', { exact: false })).toBeVisible();
    await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('transport-play')).toHaveAccessibleName(/Play/);
  });

  test('a corrupt project bundle is rejected and the open project is untouched', async ({
    page,
  }) => {
    await freshStudio(page);
    const before = await page.getByTestId('project-name').textContent();
    await page.getByTestId('project-menu').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import project bundle…' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'broken.studio',
      mimeType: 'application/zip',
      buffer: Buffer.from('PK\u0003\u0004 definitely not a zip'),
    });
    await expect(
      page.getByText('This bundle could not be imported', { exact: false }),
    ).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText(before ?? '');
    await expect(page.getByTestId('track-header')).toHaveCount(1);
  });
});
