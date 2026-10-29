// Captures authentic screenshots of the running Studio (Vite host preview on :3200) for the
// landing page. Usage: pnpm --filter @studio/vite-host build && pnpm --filter @studio/vite-host preview &
//                      node scripts/capture-screenshots.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.STUDIO_URL ?? 'http://localhost:3200';
const out = join(process.cwd(), 'apps/web/public/screenshots');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
await page.goto(base);
await page.getByTestId('studio-root').waitFor();
await page.waitForSelector('[data-studio-status="ready"]', { timeout: 30_000 });

// Load the built-in demo project through the project menu (original content).
await page.getByTestId('project-menu').click();
await page.getByRole('menuitem', { name: 'New demo project' }).click();
await page.waitForTimeout(800);

const shot = async (name, locator) => {
  await page.waitForTimeout(300);
  await (locator ?? page).screenshot({ path: join(out, `${name}.png`) });
  console.log(`saved ${name}.png`);
};

await shot('studio-overview');
// Piano roll: open the first clip.
const lanes = page.getByTestId('arrangement-lanes');
const box = await lanes.boundingBox();
if (box) await page.mouse.dblclick(box.x + 60, box.y + 36 + 64 * 2);
await shot('piano-roll', page.getByTestId('piano-roll'));
// Mixer and controller views.
await page.getByRole('tab', { name: 'Mixer' }).click();
await shot('mixer', page.locator('#studio-bottom-panel'));
await page.getByRole('tab', { name: 'Controller' }).click();
await shot('controller', page.locator('#studio-bottom-panel'));

await browser.close();
