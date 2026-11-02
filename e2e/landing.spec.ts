import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const SECTIONS = [
  'Everything a song needs. In one tab.',
  'From first note to final take',
  'Turn a knob. Hear it.',
  'Your music stays on your machine. In a tab or its own window.',
  'Browser support',
  'Start your next track in the browser',
];

const DOWNLOAD_URL = 'https://github.com/itsdula/nawa/releases/latest';
const RELEASES_URL = 'https://github.com/itsdula/nawa/releases';
const GITHUB_URL = 'https://github.com/itsdula/nawa';

/** Scrolls to the bottom in steps so every scroll-triggered reveal has played. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(40);
  }
  // Reveals take under a second; let the last ones settle before measuring.
  await page.waitForTimeout(1200);
}

test.describe('landing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the hero heading and pitch', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'Nawa' })).toBeVisible();
    await expect(page.getByText('A local-first music workstation in your browser.')).toBeVisible();
  });

  test('"Open Nawa" links point to the Studio page', async ({ page }) => {
    const hero = page.getByRole('region', { name: 'Nawa' });
    await expect(hero.getByRole('link', { name: 'Open Nawa' })).toHaveAttribute('href', '/studio/');

    const all = page.getByRole('link', { name: 'Open Nawa' });
    const count = await all.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < count; i++) {
      await expect(all.nth(i)).toHaveAttribute('href', '/studio/');
    }
  });

  // The download buttons are gated on HAS_DESKTOP_RELEASE (apps/site/src/landing/links.ts):
  // before the first release they would land on an empty page. Either state must be coherent.
  test('download and GitHub links point at the repository', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Nawa on GitHub' })).toHaveAttribute(
      'href',
      GITHUB_URL,
    );

    const downloads = page.getByRole('link', { name: 'Download for desktop' });
    const hasRelease = (await downloads.count()) > 0;
    for (const link of await downloads.all()) {
      await expect(link).toHaveAttribute('href', DOWNLOAD_URL);
    }

    const hero = page.getByRole('region', { name: 'Nawa' });
    const download = page.getByRole('region', { name: SECTIONS[3] });
    if (hasRelease) {
      await expect(hero.getByRole('link', { name: 'Download for desktop' })).toBeVisible();
      await expect(download.getByRole('link', { name: 'Download for desktop' })).toBeAttached();
    } else {
      await expect(hero.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute(
        'href',
        GITHUB_URL,
      );
      await expect(
        download.getByRole('link', { name: 'Follow releases on GitHub' }),
      ).toHaveAttribute('href', RELEASES_URL);
      // Nothing may point at a release that does not exist yet.
      await expect(page.locator(`a[href="${DOWNLOAD_URL}"]`)).toHaveCount(0);
    }
  });

  test('declares a social preview with absolute URLs', async ({ page }) => {
    const image = page.locator('meta[property="og:image"]');
    await expect(image).toHaveAttribute('content', /^https:\/\/.+\/og\.png$/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );
    const response = await page.request.get('og.png');
    expect(response.ok()).toBe(true);
  });

  test('shows every section heading in order', async ({ page }) => {
    await scrollThrough(page);
    for (const name of SECTIONS) {
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    }
    const h2s = await page.getByRole('heading', { level: 2 }).allTextContents();
    expect(h2s.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(SECTIONS);
  });

  test('shows each feature heading', async ({ page }) => {
    const features = page.getByRole('region', { name: SECTIONS[0] });
    for (const name of [
      'Multitrack arrangement',
      'Mixer with meters',
      'Instruments and effects',
      'Microphone recording',
      'Web MIDI controllers',
      'Guided tutorials',
      'Projects stay local',
      'Offline WAV export',
    ]) {
      await expect(features.getByRole('heading', { level: 3, name })).toBeAttached();
    }
    const workflow = page.getByRole('region', { name: SECTIONS[1] });
    for (const name of [
      'Write parts in the piano roll',
      'Record a take and tune it',
      'Play it on a controller',
    ]) {
      await expect(workflow.getByRole('heading', { level: 3, name })).toBeAttached();
    }
  });

  test('has landmarks and working section anchors', async ({ page }) => {
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeAttached();

    await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('link', { name: 'Features' })
      .click();
    await expect(page).toHaveURL(/#features$/);
    await expect(page.getByRole('heading', { level: 2, name: SECTIONS[0] })).toBeInViewport();
  });

  test('the demo knobs are keyboard sliders and the loop plays', async ({ page }) => {
    const cutoff = page.getByRole('slider', { name: 'Cutoff' });
    await cutoff.scrollIntoViewIfNeeded();
    const before = await cutoff.getAttribute('aria-valuenow');
    await cutoff.focus();
    await page.keyboard.press('PageUp');
    await expect(cutoff).not.toHaveAttribute('aria-valuenow', before ?? '');
    await page.keyboard.press('End');
    await expect(cutoff).toHaveAttribute('aria-valuenow', '100');
    await expect(cutoff).toHaveAttribute('aria-valuetext', '8.0 kHz');

    const play = page.getByRole('button', { name: 'Play demo loop' });
    await play.click();
    const stop = page.getByRole('button', { name: 'Stop demo loop' });
    await expect(stop).toHaveAttribute('aria-pressed', 'true');
    await stop.click();
    await expect(page.getByRole('button', { name: 'Play demo loop' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('has no automatically detectable WCAG 2.1 AA violations', async ({ page }) => {
    await scrollThrough(page);
    const results = await new AxeBuilder({ page })
      .options({
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        rules: { 'label-content-name-mismatch': { enabled: true } },
      })
      .analyze();
    const found = results.violations.map(
      (v) =>
        `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help} — ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    );
    expect(found).toEqual([]);
  });

  test('"Open Nawa" navigates to the workstation', async ({ page }) => {
    await page.getByRole('main').getByRole('link', { name: 'Open Nawa' }).first().click();
    await expect(page).toHaveURL(/\/studio\/$/);
  });
});

test.describe('landing page, reduced motion and small screens', () => {
  test('with reduced motion everything is visible without scrolling', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    // Below-the-fold content must not wait for a scroll-triggered reveal.
    const card = page.getByRole('heading', { level: 3, name: 'Offline WAV export' });
    const opacity = await card.evaluate((el) => {
      let node: Element | null = el;
      let value = 1;
      while (node) {
        value *= Number(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      return value;
    });
    expect(opacity).toBe(1);
  });

  test('phones get a desktop hint and cropped screenshots', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByText('Best on a laptop or desktop with Chrome or Edge.')).toBeVisible();
    const hero = page.getByRole('img', { name: /Nawa playing its demo project/ });
    await expect(hero).toHaveJSProperty('complete', true);
    expect(await hero.evaluate((img: HTMLImageElement) => img.currentSrc)).toMatch(
      /studio-overview-mobile\.webp$/,
    );
  });

  test('has no horizontal scroll at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto('/');
    await scrollThrough(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

test.describe('landing page on a touch screen', () => {
  test.use({ hasTouch: true });

  test('double-tapping a knob resets it', async ({ page }) => {
    await page.goto('/');
    const cutoff = page.getByRole('slider', { name: 'Cutoff' });
    await cutoff.scrollIntoViewIfNeeded();
    const initial = await cutoff.getAttribute('aria-valuenow');
    await cutoff.focus();
    await page.keyboard.press('End');
    await expect(cutoff).toHaveAttribute('aria-valuenow', '100');
    const box = await cutoff.boundingBox();
    if (!box) throw new Error('knob has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(cutoff).toHaveAttribute('aria-valuenow', initial ?? '');
  });
});
