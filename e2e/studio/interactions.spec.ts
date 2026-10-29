import { expect, test, type Page } from '@playwright/test';
import { openStudio, resetStorage } from '../helpers';

/**
 * Editor interactions: Studio-owned context menus (never the browser's), selection-aware
 * menu actions, piano-roll visibility and pointer cursors over regions and notes.
 *
 * Geometry (default view): track rows are 64 px tall, clips sit 2 px inside a row with a
 * 14 px header, and one 4/4 bar is 192 px wide at the default zoom.
 */
const BAR_PX = 192;

async function lanesBox(page: Page) {
  return (await page.getByTestId('arrangement-lanes').boundingBox())!;
}

/** Double-clicks empty lane space at bar `bar` (1-based) on the first track: creates a clip. */
async function createClipAtBar(page: Page, bar: number) {
  const box = await lanesBox(page);
  await page.mouse.dblclick(box.x + (bar - 1) * BAR_PX + 30, box.y + 30);
}

/** Point inside the body of the clip at bar `bar` on the first track. */
async function clipBody(page: Page, bar: number) {
  const box = await lanesBox(page);
  return { x: box.x + (bar - 1) * BAR_PX + BAR_PX / 2, y: box.y + 40 };
}

async function cursorOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el as HTMLElement).cursor);
}

/** Records `defaultPrevented` for every contextmenu event that reaches the document. */
async function recordContextMenus(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __contextMenus: boolean[] };
    w.__contextMenus = [];
    // Registered after Studio's listeners, so it observes the final state of the event.
    document.addEventListener('contextmenu', (e) => w.__contextMenus.push(e.defaultPrevented));
  });
}

async function contextMenusPrevented(page: Page): Promise<boolean[]> {
  return page.evaluate(() => (window as unknown as { __contextMenus: boolean[] }).__contextMenus);
}

test.describe('Editor interactions', () => {
  test.beforeEach(async ({ page }) => {
    await openStudio(page);
    await resetStorage(page);
    await page.reload();
    await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
      timeout: 30_000,
    });
  });

  test("right-clicking a region opens Studio's menu instead of the browser's", async ({ page }) => {
    await createClipAtBar(page, 1);
    await recordContextMenus(page);
    const body = await clipBody(page, 1);
    await page.mouse.click(body.x, body.y, { button: 'right' });

    const menu = page.getByTestId('studio-context-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-menu-target', 'region');
    await expect(menu.getByTestId('menu-clip-open')).toHaveText(/Open in piano roll/);
    await expect(menu.getByTestId('menu-clip-delete')).toBeVisible();
    await expect(menu.getByTestId('menu-clip-quantize')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Right-clicks elsewhere in Studio never reach the browser menu either.
    await page.getByTestId('transport-bar').click({ button: 'right', position: { x: 5, y: 5 } });
    const lanes = await lanesBox(page);
    await page.mouse.click(lanes.x + 5 * BAR_PX, lanes.y + 30, { button: 'right' });
    await expect(page.getByTestId('studio-context-menu')).toHaveAttribute(
      'data-menu-target',
      'lane',
    );
    await expect(page.getByTestId('menu-lane-new-clip')).toBeVisible();
    await page.keyboard.press('Escape');

    const prevented = await contextMenusPrevented(page);
    expect(prevented.length).toBe(3);
    expect(prevented.every(Boolean)).toBe(true);
  });

  test('deleting from the context menu acts on every selected region (undoable)', async ({
    page,
  }) => {
    await createClipAtBar(page, 1);
    await createClipAtBar(page, 2);
    await createClipAtBar(page, 3);
    const lanes = page.getByTestId('arrangement-lanes');
    const announcement = page.getByTestId('arrangement-announcement');

    const first = await clipBody(page, 1);
    const second = await clipBody(page, 2);
    await page.mouse.click(first.x, first.y);
    await page.keyboard.down('Shift');
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up('Shift');
    await expect(announcement).toHaveText('2 clips selected');

    // Right-click a selected region: the menu acts on the whole selection.
    await page.mouse.click(second.x, second.y, { button: 'right' });
    const menu = page.getByTestId('studio-context-menu');
    await expect(menu).toContainText('2 clips selected');
    await menu.getByTestId('menu-clip-delete').click();
    await expect(menu).toBeHidden();

    await lanes.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await expect(announcement).not.toContainText('clips selected'); // exactly one clip left
    await expect(announcement).toContainText(' to ');

    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+a');
    await expect(announcement).toHaveText('3 clips selected');

    // Right-clicking an unselected region selects just that region first.
    await page.mouse.click(first.x, first.y);
    await expect(announcement).not.toContainText('clips selected');
    const third = await clipBody(page, 3);
    await page.mouse.click(third.x, third.y, { button: 'right' });
    await expect(page.getByTestId('studio-context-menu')).not.toContainText('clips selected');
    await page.keyboard.press('Escape');
    await expect(announcement).not.toContainText('clips selected');
  });

  test('a single click on a MIDI clip shows the piano roll with at least two octaves', async ({
    page,
  }) => {
    await createClipAtBar(page, 1);
    await expect(page.getByTestId('piano-roll')).toBeVisible();
    // Close the editor: the Track tab explains how to reach the piano roll.
    await page.getByRole('button', { name: 'Show track devices' }).click();
    await expect(page.getByTestId('piano-roll')).toBeHidden();
    await expect(page.getByTestId('piano-roll-hint')).toContainText(
      'Select a MIDI clip to edit notes in the piano roll',
    );

    const body = await clipBody(page, 1);
    await page.mouse.click(body.x, body.y);
    const grid = page.getByTestId('piano-roll-grid');
    await expect(grid).toBeVisible();
    const rows = await grid.evaluate((el) => {
      const rowHeight = Number((el as HTMLElement).dataset.rowHeight);
      return el.getBoundingClientRect().height / rowHeight;
    });
    expect(rows).toBeGreaterThanOrEqual(24);

    // The velocity lane can be shown and hidden.
    const toggle = page.getByTestId('velocity-lane-toggle');
    const initiallyOpen = (await toggle.getAttribute('aria-expanded')) === 'true';
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', String(!initiallyOpen));
    await expect(page.getByTestId('velocity-lane')).toHaveCount(initiallyOpen ? 0 : 1);

    // Expand to the full-height editor and back.
    await page.getByTestId('editor-expand').click();
    await expect(page.getByTestId('editor-view')).toBeVisible();
    await expect(page.getByTestId('arrangement')).toBeHidden();
    await expect(page.getByTestId('editor-expand')).toHaveText('Back to arrangement');
    await page.getByTestId('editor-expand').click();
    await expect(page.getByTestId('arrangement')).toBeVisible();
  });

  test('the cursor shows the action under the pointer on regions and notes', async ({ page }) => {
    await createClipAtBar(page, 1);
    const box = await lanesBox(page);
    // Right edge, lower part: trim.
    await page.mouse.move(box.x + BAR_PX - 2, box.y + 45);
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('ew-resize');
    await expect(page.getByTestId('arrangement-lanes')).toHaveAttribute(
      'data-hover-region',
      'end-edge',
    );
    // Left edge: trim start.
    await page.mouse.move(box.x + 2, box.y + 45);
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('ew-resize');
    // Body: grab (Alt: copy).
    await page.mouse.move(box.x + BAR_PX / 2, box.y + 45);
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('grab');
    await page.keyboard.down('Alt');
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('copy');
    await page.keyboard.up('Alt');
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('grab');
    // Top-right corner: the loop handle has its own cursor.
    await page.mouse.move(box.x + BAR_PX - 2, box.y + 8);
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toContain('e-resize');
    await expect(page.getByTestId('arrangement-lanes')).toHaveAttribute(
      'data-hover-region',
      'loop-end',
    );
    // Empty lane.
    await page.mouse.move(box.x + 4 * BAR_PX, box.y + 30);
    await expect.poll(() => cursorOf(page, 'arrangement-lanes')).toBe('default');

    // Piano roll: draw a note, then hover its end edge.
    const grid = page.getByTestId('piano-roll-grid');
    const g = (await grid.boundingBox())!;
    await page.mouse.dblclick(g.x + g.width * 0.3, g.y + g.height * 0.5);
    await expect(grid.locator('.sr-only')).toContainText('1 notes');
    await page.mouse.move(g.x + g.width * 0.3 + 4, g.y + g.height * 0.5);
    await expect.poll(() => cursorOf(page, 'piano-roll-grid')).toBe('grab');
    // Walk right until the note's end edge is under the pointer.
    let found = false;
    for (let dx = 4; dx < 200 && !found; dx += 2) {
      await page.mouse.move(g.x + g.width * 0.3 + dx, g.y + g.height * 0.5);
      found = (await grid.getAttribute('data-hover-region')) === 'end-edge';
    }
    expect(found).toBe(true);
    expect(await cursorOf(page, 'piano-roll-grid')).toBe('ew-resize');
  });
});
