import { decodeWav } from '@studio/audio-dsp';
import { expect, test } from '@playwright/test';
import { openStudio, positionBars, readDownload, resetStorage } from '../helpers';

test.describe('Phase 2 vertical slice: MIDI clip → piano roll → synth → loop → WAV', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', { timeout: 30_000 });
  });

  test('create a clip, draw notes, play, loop, stop, seek and export an audible WAV', async ({ page }) => {
    const lanes = page.getByTestId('arrangement-lanes');
    const box = (await lanes.boundingBox())!;
    // Double-click the first instrument track lane at bar 1 → new MIDI clip opens in the piano roll.
    await page.mouse.dblclick(box.x + 30, box.y + 30);
    const grid = page.getByTestId('piano-roll-grid');
    await expect(grid).toBeVisible();

    // Draw four notes by double-clicking across the clip (piano roll zooms to fit the clip).
    const g = (await grid.boundingBox())!;
    for (let i = 0; i < 4; i++) {
      await page.mouse.dblclick(g.x + g.width * (0.08 + i * 0.22), g.y + g.height * (0.3 + i * 0.08));
    }
    await expect(grid.locator('.sr-only')).toContainText('4 notes');

    // Play from the start; the position readout advances with the audio clock.
    await page.getByTestId('transport-play').click();
    await expect.poll(() => positionBars(page), { timeout: 5_000 }).not.toBe('1.1.1');
    // Loop on, then stop: the cursor returns to the play start.
    await page.getByTestId('transport-loop').click();
    await expect(page.getByTestId('transport-loop')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('transport-stop').click();
    await expect.poll(() => positionBars(page)).toBe('1.1.1');

    // Seek by clicking the ruler (below the loop strip) half-way across the first bar.
    const ruler = (await page.getByTestId('arrangement-ruler').boundingBox())!;
    await page.mouse.click(ruler.x + 150, ruler.y + ruler.height - 6);
    await expect.poll(() => positionBars(page)).not.toBe('1.1.1');

    // Export the arrangement and verify the WAV is audible and the right length.
    await page.getByTestId('open-export').click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export-start').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.wav$/);
    const bytes = await readDownload((await download.path())!);
    const pcm = decodeWav(bytes);
    expect(pcm.channels).toHaveLength(2);
    const seconds = pcm.channels[0]!.length / pcm.sampleRate;
    expect(seconds).toBeGreaterThan(1.9); // one 4/4 bar at 120 BPM (+ tail)
    let peak = 0;
    for (const ch of pcm.channels) for (const v of ch) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.01);
    await expect(page.getByTestId('export-result')).toContainText('Exported');
  });

  test('undo and redo restore piano-roll edits', async ({ page }) => {
    const box = (await page.getByTestId('arrangement-lanes').boundingBox())!;
    await page.mouse.dblclick(box.x + 30, box.y + 30);
    const grid = page.getByTestId('piano-roll-grid');
    const g = (await grid.boundingBox())!;
    await page.mouse.dblclick(g.x + g.width * 0.2, g.y + g.height * 0.4);
    await expect(grid.locator('.sr-only')).toContainText('1 notes');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(grid.locator('.sr-only')).toContainText('0 notes');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(grid.locator('.sr-only')).toContainText('1 notes');
  });
});
