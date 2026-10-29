import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openStudio, positionBars, resetStorage } from '../helpers';

/**
 * Tutorials in a real browser: the built-in "Getting started" tour is run end to end by
 * actually performing every step (each step advances only when Studio's state changes), and
 * the first-run offer never starts a tour on its own. Tutorials created by the assistant via
 * `create_tutorial` are covered by a jsdom integration test (the session isn't reachable here).
 */
async function freshStudio(page: Page) {
  await openStudio(page);
  await resetStorage(page);
  await page.reload();
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
}

test.describe('Tutorials', () => {
  test.beforeEach(async ({ page }) => {
    await freshStudio(page);
  });

  test('Getting started: every step is completed by doing it', async ({ page }) => {
    const card = page.getByTestId('tutorial-card');
    const spotlight = page.getByTestId('tutorial-spotlight');
    const atStep = async (id: string, progress?: string) => {
      await expect(card).toHaveAttribute('data-step-id', id);
      if (progress) await expect(page.getByTestId('tutorial-progress')).toHaveText(progress);
    };

    // First run: a non-blocking offer, no tour until the user accepts.
    await expect(page.getByTestId('tutorial-offer')).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByTestId('tutorial-offer-start').click();
    await expect(page.getByTestId('tutorial-offer')).toHaveCount(0);
    await atStep('welcome', '1 of 14');
    await expect(card).toHaveAttribute('role', 'dialog');
    await page.getByTestId('tutorial-next').click();

    // 1. Create a project from the Studio menu.
    await atStep('create-project', '2 of 14');
    await expect(spotlight).toBeVisible();
    // The spotlight surrounds the real control.
    await expect
      .poll(async () => {
        const s = (await spotlight.boundingBox())!;
        const t = (await page.getByTestId('project-menu').boundingBox())!;
        return (
          s.x <= t.x &&
          s.y <= t.y &&
          s.x + s.width >= t.x + t.width &&
          s.y + s.height >= t.y + t.height
        );
      })
      .toBe(true);
    await page.getByTestId('project-menu').click();
    await page.getByRole('menuitem', { name: 'New project' }).click();

    // 2. Add an instrument track.
    await atStep('add-track');
    await page.getByTestId('add-track').click();
    await page.getByTestId('add-instrument-track').click();
    await expect(page.getByTestId('track-header')).toHaveCount(2);

    // 3. Double-click a lane: a MIDI clip is created and opens in the piano roll, so the
    //    "open the piano roll" step is already done and the tour moves on to drawing.
    await atStep('create-clip');
    const lanes = (await page.getByTestId('arrangement-lanes').boundingBox())!;
    await page.mouse.dblclick(lanes.x + 30, lanes.y + 30);
    await atStep('draw-notes', '6 of 14');

    // 4. Draw four notes.
    const grid = page.getByTestId('piano-roll-grid');
    const g = (await grid.boundingBox())!;
    for (let i = 0; i < 4; i++) {
      await page.mouse.dblclick(
        g.x + g.width * (0.08 + i * 0.22),
        g.y + g.height * (0.3 + i * 0.08),
      );
    }
    await expect(grid.locator('.sr-only')).toContainText('4 notes');

    // 5. Play, 6. loop.
    await atStep('play');
    await page.getByTestId('transport-play').click();
    await atStep('loop');
    await expect.poll(() => positionBars(page), { timeout: 5_000 }).not.toBe('1.1.1');
    await page.getByTestId('transport-loop').click();
    await expect(page.getByTestId('transport-loop')).toHaveAttribute('aria-pressed', 'true');

    // 7. Show the track's devices and add an effect.
    await atStep('show-devices');
    await page.getByRole('button', { name: 'Show track devices' }).click();
    await atStep('add-effect');
    await page.getByTestId('add-effect').click();
    await page.getByRole('menuitem', { name: 'Reverb' }).click();
    await expect(page.getByTestId('effect-unit')).toHaveCount(1);

    // 8. Open the mixer.
    await atStep('open-mixer');
    await page.getByRole('tab', { name: 'Mixer' }).click();
    await atStep('mix');
    await expect(page.getByTestId('mixer')).toBeVisible();
    await page.getByTestId('transport-stop').click();
    await page.getByTestId('tutorial-next').click();

    // 9. Export: open the dialog, then render the WAV.
    await atStep('open-export', '13 of 14');
    await page.getByTestId('open-export').click();
    await atStep('export', '14 of 14');
    await expect(page.getByTestId('export-dialog')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('export-start').click();
    expect((await download).suggestedFilename()).toMatch(/\.wav$/);
    await expect(page.getByTestId('tutorial-complete')).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByTestId('tutorial-done').click();
    await expect(page.getByTestId('tutorial-complete')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The menu remembers it, across a reload, and the first-run offer doesn't come back.
    await page.getByTestId('tutorial-menu').click();
    await expect(page.getByTestId('tutorial-item-getting-started')).toHaveAttribute(
      'data-status',
      'completed',
    );
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
    await page.getByTestId('tutorial-menu').click();
    await expect(page.getByTestId('tutorial-item-getting-started')).toHaveAttribute(
      'data-status',
      'completed',
    );
    await expect(page.getByTestId('tutorial-offer')).toHaveCount(0);
  });

  test('tours start from the menu, Back/Next move between steps and Escape exits', async ({
    page,
  }) => {
    await page.getByTestId('tutorial-offer-dismiss').click();
    await expect(page.getByTestId('tutorial-offer')).toHaveCount(0);
    await page.getByTestId('tutorial-menu').click();
    await page.getByTestId('tutorial-item-recording-audio').click();
    const card = page.getByTestId('tutorial-card');
    await expect(card).toHaveAttribute('data-step-id', 'add-audio-track');
    await expect(page.getByTestId('tutorial-spotlight')).toBeVisible();
    await expect(card).toHaveCSS('opacity', '1');
    const axe = await new AxeBuilder({ page })
      .include('[data-testid="tutorial-card"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    // The highlighted control stays usable through the overlay.
    await page.getByTestId('add-track').click();
    await page.getByTestId('add-audio-track').click();
    await expect(card).toHaveAttribute('data-step-id', 'arm');
    await page.getByTestId('tutorial-back').click();
    await expect(card).toHaveAttribute('data-step-id', 'add-audio-track');
    await page.getByTestId('tutorial-next').click();
    await expect(card).toHaveAttribute('data-step-id', 'arm');
    await card.focus();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    // Dismissing the offer is remembered.
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
    await page.getByTestId('tutorial-menu').click();
    await expect(page.getByTestId('tutorial-item-recording-audio')).toHaveAttribute(
      'data-status',
      'dismissed',
    );
    await expect(page.getByTestId('tutorial-offer')).toHaveCount(0);
  });

  test('the spotlight and card animate only without reduced motion', async ({ page }) => {
    const seconds = (testId: string) =>
      page
        .getByTestId(testId)
        .evaluate((el) =>
          Math.max(...getComputedStyle(el).transitionDuration.split(',').map(parseFloat)),
        );
    await page.getByTestId('tutorial-offer-start').click();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByTestId('tutorial-spotlight')).toBeVisible();
    expect(await seconds('tutorial-card')).toBeCloseTo(0.2);
    expect(await seconds('tutorial-spotlight')).toBeCloseTo(0.2);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => seconds('tutorial-card')).toBeLessThan(0.001);
    expect(await seconds('tutorial-spotlight')).toBeLessThan(0.001);
  });
});
