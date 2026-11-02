/**
 * Entry point of the dev-only main-process code (`pnpm dev`, see docs/dev-monitor.md).
 * main.ts imports it only when built with `__STUDIO_DEV__` and run with STUDIO_DEV=1, so
 * esbuild drops this module (and OpenTelemetry) from every production bundle.
 */
import type { App } from 'electron';
import { setDevLogSink } from './dev-log';
import { watchForReload } from './dev-reload';
import { startDevTelemetry } from './dev-telemetry';

export function startDevMode(app: App, distDir: string): void {
  if (process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    setDevLogSink(startDevTelemetry(app).log);
  }
  // The orchestrator stops Electron with SIGTERM: quit normally so `will-quit` flushes the
  // telemetry and the preferences instead of Node's immediate default exit.
  process.on('SIGTERM', () => app.quit());
  void app.whenReady().then(() => {
    const stop = watchForReload(distDir);
    app.on('will-quit', stop);
  });
}
