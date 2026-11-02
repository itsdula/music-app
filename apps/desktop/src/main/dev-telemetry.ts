/**
 * Dev-only OpenTelemetry log export for `pnpm dev` (see docs/dev-monitor.md). Reached only
 * through dev-mode.ts, which main.ts imports behind `__STUDIO_DEV__` and `STUDIO_DEV=1`, so
 * production bundles contain none of this.
 *
 * Two LoggerProviders share one process: `studio-electron-main` (lifecycle, IPC errors,
 * crashed processes) and `studio-electron-renderer` (every renderer `console` message,
 * including the sandboxed preload, captured through `webContents` `console-message`; the
 * renderer itself keeps its production CSP and sends nothing). Records go to
 * OTEL_EXPORTER_OTLP_LOGS_ENDPOINT as OTLP/HTTP JSON and are flushed before the app quits.
 */
import { SeverityNumber, type Logger } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';
import type { App } from 'electron';
import type { DevLogLevel, DevLogSink } from './dev-log';

const SEVERITY: Record<DevLogLevel, readonly [SeverityNumber, string]> = {
  debug: [SeverityNumber.DEBUG, 'DEBUG'],
  info: [SeverityNumber.INFO, 'INFO'],
  warn: [SeverityNumber.WARN, 'WARN'],
  error: [SeverityNumber.ERROR, 'ERROR'],
  fatal: [SeverityNumber.FATAL, 'FATAL'],
};

const CONSOLE_LEVEL: Record<string, DevLogLevel> = {
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
};

function createProvider(serviceName: string): LoggerProvider {
  return new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.namespace': 'studio',
      'process.pid': process.pid,
      'process.runtime.name': 'electron',
      'process.runtime.version': process.versions.electron ?? '',
    }),
    processors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 250 }),
    ],
  });
}

function emit(
  logger: Logger,
  level: DevLogLevel,
  body: string,
  attributes?: Readonly<Record<string, string | number | boolean>>,
): void {
  const [severityNumber, severityText] = SEVERITY[level];
  logger.emit({ severityNumber, severityText, body, ...(attributes ? { attributes } : {}) });
}

export interface DevTelemetry {
  readonly log: DevLogSink;
}

export function startDevTelemetry(app: App): DevTelemetry {
  const mainProvider = createProvider('studio-electron-main');
  const rendererProvider = createProvider('studio-electron-renderer');
  const main = mainProvider.getLogger('studio.electron.main');
  const renderer = rendererProvider.getLogger('studio.electron.renderer.console');
  const log: DevLogSink = (level, body, attributes) => emit(main, level, body, attributes);
  // Helper processes are killed on every quit; only report them as failures while running.
  let quitting = false;
  app.on('before-quit', () => {
    quitting = true;
  });
  const goneLevel = (reason: string) =>
    reason === 'clean-exit' || (quitting && reason === 'killed') ? 'info' : null;

  app.on('web-contents-created', (_event, contents) => {
    // Electron 45: the message fields live on the event object.
    contents.on('console-message', (event) => {
      emit(renderer, CONSOLE_LEVEL[event.level] ?? 'info', event.message, {
        'code.file.path': event.sourceId,
        'code.line.number': event.lineNumber,
        'webcontents.id': contents.id,
      });
    });
    contents.on('render-process-gone', (_e, details) => {
      log(goneLevel(details.reason) ?? 'fatal', `renderer gone: ${details.reason}`, {
        'process.exit.code': details.exitCode,
        'webcontents.id': contents.id,
      });
    });
    contents.on('preload-error', (_e, preloadPath, error) => {
      log('error', `preload failed: ${error.message}`, { 'code.file.path': preloadPath });
    });
    contents.on('did-fail-load', (_e, code, description, url) => {
      log('error', `load failed: ${description} (${code})`, { 'url.full': url });
    });
  });
  app.on('child-process-gone', (_e, details) => {
    log(goneLevel(details.reason) ?? 'error', `${details.type} gone: ${details.reason}`, {
      'process.exit.code': details.exitCode,
    });
  });
  // `uncaughtExceptionMonitor` observes without changing Electron's default crash handling.
  process.on('uncaughtExceptionMonitor', (error) => {
    log('fatal', `uncaught exception: ${error.stack ?? error.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    log(
      'error',
      `unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    );
  });

  // Flush both providers before the process exits (records are batched every 250 ms).
  let flushed = false;
  app.on('will-quit', (event) => {
    if (flushed) return;
    flushed = true;
    event.preventDefault();
    log('info', 'app quitting');
    void Promise.allSettled([mainProvider.shutdown(), rendererProvider.shutdown()]).then(() =>
      app.quit(),
    );
  });

  return { log };
}
