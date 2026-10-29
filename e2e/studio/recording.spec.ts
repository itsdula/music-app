import { expect, test } from '@playwright/test';
import { wavStats } from '../audio-fixtures';
import { openStudio, readDownload, resetStorage } from '../helpers';

/**
 * Phase 4 recording with Chromium's synthetic microphone (--use-fake-device-for-media-stream
 * emits periodic beeps). Verifies the capture → take → clip → bounce path, not real-device
 * latency, which depends on hardware (see the Settings dialog's latency compensation).
 */
test.describe('Phase 4: microphone recording (fake capture device)', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', { timeout: 30_000 });
  });

  test('records an armed audio track into a new clip that is audible in the bounce', async ({ page }) => {
    await page.getByTestId('add-track').click();
    await page.getByTestId('add-audio-track').click();
    const headers = page.getByTestId('track-header');
    await expect(headers).toHaveCount(2);
    // Arm only the new audio track (the starter instrument track stays unarmed).
    await headers.nth(1).getByTestId('track-arm').click();
    await expect(headers.nth(1).getByTestId('track-arm')).toHaveAttribute('aria-pressed', 'true');

    await page.getByTestId('transport-record').click();
    await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(2500); // let the fake device emit at least two beeps
    await page.getByTestId('transport-stop').click();
    await expect(page.getByTestId('transport-record')).toHaveAttribute('aria-pressed', 'false');

    // The take is registered as a project asset and placed as a clip.
    await expect(page.getByTestId('browser-panel')).toContainText('take', { timeout: 10_000 });
    await page.getByTestId('open-export').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-start').click();
    const stats = wavStats(await readDownload((await (await download).path())!));
    expect(stats.seconds).toBeGreaterThan(2);
    expect(stats.peak).toBeGreaterThan(0.01);
  });
});
