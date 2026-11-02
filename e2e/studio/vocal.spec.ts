import { decodeWav } from '@studio/audio-dsp';
import { analyzeVocal } from '@studio/vocal-dsp';
import { expect, test } from '@playwright/test';
import { detunedVocalWav, VOCAL_NOTES } from '../audio-fixtures';
import { openStudio, readDownload, resetStorage, startEmptyProject } from '../helpers';

/**
 * Phases 6–7 in a real browser: analysis runs in Studio's Web Worker (inline Blob bundle),
 * Auto Tune renders with TD-PSOLA, and the exported WAV is re-analysed here in Node to prove
 * the correction is audible — not just drawn. The input is a synthetic vowel with known,
 * deliberately detuned pitches (no recorded voices are used).
 */
const NOTES = VOCAL_NOTES;

/** Detected note centres (fractional MIDI) of a WAV, by the same analysis Studio uses. */
function noteCentres(bytes: Uint8Array): number[] {
  return analyzeVocal(decodeWav(bytes)).segments.map((s) => s.detectedMidi);
}

test.describe('Phases 6–7: vocal analysis and pitch correction', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
    await startEmptyProject(page);
  });

  test('analyzes a detuned vocal, shows its notes and exports an audibly corrected WAV', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const input = detunedVocalWav();
    const before = noteCentres(input);
    expect(before.map((m) => Math.round(m))).toEqual(NOTES);

    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('import-audio').click();
    await (await chooser).setFiles({ name: 'Lead Vox.wav', mimeType: 'audio/wav', buffer: input });
    await expect(page.getByTestId('track-header')).toHaveCount(2);

    // Open the imported (selected) clip and switch the editor to pitch mode.
    await page.getByTestId('arrangement-lanes').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio', { name: 'Pitch (vocal)' }).click();
    await page.getByRole('button', { name: /Analyze vocal/ }).click();
    const editor = page.getByTestId('vocal-editor');
    await expect(editor).toHaveAttribute('data-state', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('vocal-limitations')).toBeAttached();

    // One row per sung note, named by its nearest pitch.
    await page.getByTestId('vocal-notes-list-toggle').click();
    const rows = page.getByTestId('vocal-note-row');
    await expect(rows).toHaveCount(3);
    for (const [i, name] of ['A3', 'C4', 'E4'].entries()) {
      await expect(rows.nth(i)).toContainText(name);
    }

    // Full Auto Tune, then A/B: the toggle names what is playing.
    const amount = page.getByRole('slider', { name: 'Auto Tune' });
    await amount.focus();
    await amount.press('End');
    await expect(page.getByTestId('vocal-ab')).toContainText('B · Corrected');
    await page.getByTestId('vocal-ab').click();
    await expect(page.getByTestId('vocal-ab')).toContainText('A · Original');
    await page.getByTestId('vocal-ab').click();
    await expect(page.getByTestId('vocal-ab')).toContainText('B · Corrected');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export corrected WAV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/corrected\)\.wav$/);
    const after = noteCentres(await readDownload((await file.path())!));

    expect(after).toHaveLength(3);
    const cents = (values: number[]) =>
      values.map((m, i) => `${((m - NOTES[i]!) * 100).toFixed(1)}¢`).join(', ');
    process.stdout.write(`vocal pitch error before: ${cents(before)} | after: ${cents(after)}\n`);
    for (const [i, midi] of after.entries()) {
      const errorBefore = Math.abs(before[i]! - NOTES[i]!) * 100;
      const errorAfter = Math.abs(midi - NOTES[i]!) * 100;
      expect(
        errorAfter,
        `note ${i}: ${errorBefore.toFixed(1)}¢ → ${errorAfter.toFixed(1)}¢`,
      ).toBeLessThan(Math.min(10, errorBefore / 2));
    }
  });
});
