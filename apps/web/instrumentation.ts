/**
 * Next.js instrumentation hook. Under `pnpm dev` (apps/dev-monitor) the orchestrator sets
 * OTEL_EXPORTER_OTLP_LOGS_ENDPOINT and OTEL_SERVICE_NAME, and the Node.js server exports its
 * structured logs (request errors, explicit `logs.getLogger(...)` calls) to the dev monitor.
 * Without the variable (production, `next build`, tests) nothing is loaded and
 * `onRequestError` emits to the API's no-op logger. See docs/dev-monitor.md.
 */
import type { Instrumentation } from 'next';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
    await import('./instrumentation.node');
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { logs, SeverityNumber } = await import('@opentelemetry/api');
  const err = error instanceof Error ? error : new Error(String(error));
  logs.getLogger('studio.next.request-error').emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: 'ERROR',
    body: err.message,
    attributes: {
      'exception.type': err.name,
      'exception.stacktrace': err.stack ?? '',
      'url.path': request.path,
      'http.request.method': request.method,
      'next.route': context.routePath,
      'next.route_type': context.routeType,
      'next.router_kind': context.routerKind,
    },
  });
};
