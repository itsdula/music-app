import { expect, test, type Page } from '@playwright/test';
import { sineWav, wavStats } from '../audio-fixtures';
import { openStudio, readDownload, resetStorage } from '../helpers';

async function ready(page: Page): Promise<void> {
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
}

async function importWav(page: Page, name: string, wav: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('import-audio').click();
  await (await chooser).setFiles({ name, mimeType: 'audio/wav', buffer: wav });
}

async function renameProject(page: Page, name: string): Promise<void> {
  await page.getByTestId('project-name').dblclick();
  const input = page.getByRole('textbox', { name: 'Project name' });
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByTestId('project-name')).toHaveText(name);
}

async function waitForSave(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved', {
    timeout: 10_000,
  });
}

async function exportWav(page: Page): Promise<Uint8Array> {
  await page.getByTestId('open-export').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('export-start').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.wav$/);
  const bytes = await readDownload((await file.path())!);
  await page.keyboard.press('Escape');
  return bytes;
}

test.describe('Phases 3–4: audio import, persistence, bundles and effects', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await ready(page);
  });

  test('autosaves edits and restores them, including audio, after a reload', async ({ page }) => {
    await renameProject(page, 'Autosave Song');
    await importWav(page, 'tone.wav', sineWav({ seconds: 1 }));
    await expect(page.getByTestId('track-header')).toHaveCount(2);
    await waitForSave(page);

    await page.reload();
    await ready(page);
    await expect(page.getByTestId('project-name')).toHaveText('Autosave Song');
    await expect(page.getByTestId('track-header')).toHaveCount(2);
    await expect(page.getByTestId('browser-panel')).toContainText('tone');
    // The restored audio is real: the bounce contains the 1 s tone.
    const stats = wavStats(await exportWav(page));
    expect(stats.peak).toBeGreaterThan(0.2);
  });

  test('exports a .studio bundle and imports it back with its audio', async ({ page }) => {
    await renameProject(page, 'Bundle Song');
    await importWav(page, 'tone.wav', sineWav({ seconds: 1 }));
    await expect(page.getByTestId('track-header')).toHaveCount(2);

    await page.getByTestId('project-menu').click();
    const download = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export project bundle…' }).click();
    const bundleFile = await download;
    expect(bundleFile.suggestedFilename()).toMatch(/\.studio$/);
    const bundle = await readDownload((await bundleFile.path())!);
    expect(String.fromCharCode(bundle[0]!, bundle[1]!)).toBe('PK'); // zip container

    await page.getByTestId('project-menu').click();
    await page.getByRole('menuitem', { name: 'New project' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Untitled Project');
    await expect(page.getByTestId('track-header')).toHaveCount(1);

    await page.getByTestId('project-menu').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: 'Import project bundle…' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'bundle-song.studio',
      mimeType: 'application/zip',
      buffer: Buffer.from(bundle),
    });
    await expect(page.getByTestId('project-name')).toHaveText('Bundle Song');
    await expect(page.getByTestId('track-header')).toHaveCount(2);
    expect(wavStats(await exportWav(page)).peak).toBeGreaterThan(0.2);
  });

  test('an inserted Gain effect audibly changes the bounce', async ({ page }) => {
    await importWav(page, 'tone.wav', sineWav({ seconds: 1, amplitude: 0.5 }));
    await expect(page.getByTestId('track-header')).toHaveCount(2);
    const dry = wavStats(await exportWav(page));
    expect(dry.peak).toBeGreaterThan(0.2);

    // The imported audio track is selected; its device panel shows the effect chain.
    await page.getByRole('tab', { name: /Track|Clip/ }).click();
    const showDevices = page.getByRole('button', { name: 'Show track devices' });
    if (await showDevices.isVisible()) await showDevices.click();
    await page.getByTestId('add-effect').click();
    await page.getByRole('menuitem', { name: 'Gain', exact: true }).click();
    const gain = page.getByTestId('effect-unit').getByRole('slider', { name: 'Gain', exact: true });
    await gain.focus();
    await gain.press('Home'); // −60 dB
    const quiet = wavStats(await exportWav(page));
    expect(quiet.peak).toBeLessThan(dry.peak * 0.01);

    // Bypass restores the dry level.
    await page.getByTestId('effect-unit').getByRole('switch', { name: 'Gain on' }).click();
    const bypassed = wavStats(await exportWav(page));
    expect(bypassed.peak).toBeCloseTo(dry.peak, 1);
  });
});
