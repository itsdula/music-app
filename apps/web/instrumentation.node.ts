/**
 * Node.js-only half of instrumentation.ts: a global OpenTelemetry LoggerProvider exporting
 * OTLP/HTTP JSON to OTEL_EXPORTER_OTLP_LOGS_ENDPOINT (the dev monitor). Loaded only when that
 * variable is set. Console output is not wrapped here: the dev monitor already captures the
 * `next dev` stdout/stderr, so wrapping would log every line twice.
 */
import { logs, SeverityNumber } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';

// Dev reloads can evaluate this module again; keep one provider per process.
const KEY = Symbol.for('studio.dev-telemetry.next');
const globals = globalThis as typeof globalThis & { [KEY]?: LoggerProvider };

if (!globals[KEY]) {
  const provider = new LoggerProvider({
    resource: defaultResource()
      .merge(detectResources({ detectors: [envDetector] }))
      .merge(
        resourceFromAttributes({
          'service.name': process.env.OTEL_SERVICE_NAME ?? 'studio-next',
          'service.namespace': 'studio',
          'process.pid': process.pid,
        }),
      ),
    processors: [
      new BatchLogRecordProcessor({ exporter: new OTLPLogExporter(), scheduledDelayMillis: 250 }),
    ],
  });
  logs.setGlobalLoggerProvider(provider);
  globals[KEY] = provider;
  // No SIGTERM/SIGINT listener on purpose: adding one would replace Node's default exit on
  // that signal. Records are batched every 250 ms, so at most that much is lost on shutdown.
  logs.getLogger('studio.next').emit({
    severityNumber: SeverityNumber.INFO,
    severityText: 'INFO',
    body: `next server telemetry ready (pid ${process.pid}, ${process.env.NODE_ENV ?? 'unknown'})`,
  });
}
