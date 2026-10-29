// Captures authentic screenshots of the running Studio for the landing page.
// Usage: pnpm --filter @studio/vite-host build && pnpm --filter @studio/vite-host preview &
//        node scripts/capture-screenshots.mjs
// Everything shown is original: the built-in demo project and a synthesized vowel phrase.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.STUDIO_URL ?? 'http://localhost:3200';
const out = join(process.cwd(), 'apps/web/public/screenshots');
mkdirSync(out, { recursive: true });

/** A short sung-vowel-like phrase (harmonic stack with vibrato), slightly out of tune. */
function synthVocalWav() {
  const sampleRate = 44_100;
  const notes = [
    [57, 0.15, 0.7, -35],
    [60, 0.95, 0.55, 25],
    [64, 1.6, 0.8, -20],
    [62, 2.5, 0.9, 15],
  ];
  const seconds = 3.6;
  const data = new Float32Array(Math.round(seconds * sampleRate));
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const note = notes.find(([, start, dur]) => t >= start && t < start + dur);
    if (!note) continue;
    const [midi, start, dur, cents] = note;
    const vibrato = 0.35 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, (t - start) / 0.25);
    const f0 = 440 * 2 ** ((midi + cents / 100 + vibrato / 12 - 69) / 12);
    phase += (2 * Math.PI * f0) / sampleRate;
    const env = Math.min(1, (t - start) / 0.04, (start + dur - t) / 0.06);
    let v = 0;
    for (let k = 1; k <= 24; k++) {
      const fk = k * f0;
      // Rough /a/ formants at 700, 1200 and 2600 Hz.
      const formant =
        Math.exp(-(((fk - 700) / 130) ** 2)) +
        0.7 * Math.exp(-(((fk - 1200) / 150) ** 2)) +
        0.3 * Math.exp(-(((fk - 2600) / 200) ** 2));
      v += ((0.15 + formant) / k) * Math.sin(k * phase);
    }
    data[i] = 0.25 * env * v;
  }
  const bytes = Buffer.alloc(44 + data.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + data.length * 2, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(data.length * 2, 40);
  for (let i = 0; i < data.length; i++) {
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, data[i])) * 32767), 44 + i * 2);
  }
  return bytes;
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});
const shot = async (name, locator) => {
  await page.waitForTimeout(400);
  await (locator ?? page).screenshot({ path: join(out, `${name}.png`) });
  process.stdout.write(`saved ${name}.png\n`);
};

await page.goto(base);
await page.waitForSelector('[data-studio-status="ready"]', { timeout: 30_000 });

// 1. Overview: the original demo groove with the mixer open.
await page.getByTestId('project-menu').click();
await page.getByRole('menuitem', { name: 'New demo project' }).click();
await page.waitForTimeout(800);
await page.getByRole('tab', { name: 'Mixer' }).click();
await shot('studio-overview');

// 2. Piano roll on the bass clip (second track lane).
const lanes = page.getByTestId('arrangement-lanes');
const box = await lanes.boundingBox();
if (box) await page.mouse.dblclick(box.x + 80, box.y + 32 + 64);
await shot('piano-roll', page.locator('#studio-bottom-panel'));

// 3. Controller panel: Studio's own drawing of the MPK Mini MK3 layout.
await page.getByRole('tab', { name: 'Controller' }).click();
await shot('controller', page.locator('#studio-bottom-panel'));

// 4. Vocal editor on a synthesized phrase, analyzed and with Auto Tune applied.
const chooser = page.waitForEvent('filechooser');
await page.getByTestId('import-audio').click();
await (
  await chooser
).setFiles({ name: 'Vocal take.wav', mimeType: 'audio/wav', buffer: synthVocalWav() });
await page.waitForTimeout(500);
await page.getByTestId('arrangement-lanes').focus();
await page.keyboard.press('Enter');
await page.getByRole('radio', { name: 'Pitch (vocal)' }).click();
await page.getByRole('button', { name: /Analyze vocal/ }).click();
await page.waitForSelector('[data-testid="vocal-editor"][data-state="ready"]', { timeout: 60_000 });
const amount = page.getByRole('slider', { name: 'Auto Tune' });
await amount.focus();
for (let i = 0; i < 8; i++) await amount.press('PageUp');
await page.waitForTimeout(800);
await shot('vocal-editor', page.locator('#studio-bottom-panel'));

await browser.close();
