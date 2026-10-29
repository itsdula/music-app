import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/** Opens the Vite host with a fresh IndexedDB database and the download fallback for saves. */
export async function openStudio(page: Page, path = '/'): Promise<void> {
  await page.addInitScript(() => {
    // Force the <a download> path so Playwright can capture exported files.
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
  await page.goto(path);
  await expect(page.getByTestId('studio-root')).toHaveAttribute('data-studio-status', 'ready', {
    timeout: 30_000,
  });
}

export async function resetStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map(
        (db) =>
          new Promise<void>((resolve) => {
            if (!db.name) return resolve();
            const req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
  });
}

export async function readDownload(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(path));
}

/** Text of the bars.beats.sixteenths readout. */
export async function positionBars(page: Page): Promise<string> {
  return (await page.getByTestId('position-bars').textContent()) ?? '';
}
