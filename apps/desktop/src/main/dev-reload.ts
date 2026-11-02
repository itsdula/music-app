/**
 * Dev-only: reloads every window when the watch build rewrites dist/renderer or dist/preload
 * (`pnpm dev`; main itself is restarted by the orchestrator). Reached only through
 * dev-mode.ts behind `__STUDIO_DEV__`.
 */
import { watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { devLog } from './dev-log';

const DEBOUNCE_MS = 300;
/**
 * macOS FSEvents also reports writes made just before the watcher started (the first
 * build), which would reload the freshly opened window. Events in this window are ignored.
 */
export const STARTUP_SETTLE_MS = 1500;

export function watchForReload(distDir: string): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Set<string>();
  const startedAt = Date.now();
  const reload = () => {
    timer = undefined;
    const what = [...changed].sort().join(', ');
    changed.clear();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
    }
    devLog('info', `reloaded windows (${what} rebuilt)`, { 'studio.reload.reason': what });
  };
  const watchers: FSWatcher[] = [];
  for (const target of ['renderer', 'preload']) {
    try {
      const watcher = watch(join(distDir, target), { recursive: true }, () => {
        if (Date.now() - startedAt < STARTUP_SETTLE_MS) return;
        changed.add(target);
        if (timer) clearTimeout(timer);
        timer = setTimeout(reload, DEBOUNCE_MS);
      });
      watcher.on('error', (error) => devLog('warn', `watch ${target} failed: ${error.message}`));
      watchers.push(watcher);
    } catch (error) {
      devLog('warn', `cannot watch dist/${target}: ${String(error)}`);
    }
  }
  return () => {
    if (timer) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
