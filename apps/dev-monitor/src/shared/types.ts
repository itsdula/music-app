/**
 * Types shared by the orchestrator (Node) and the monitor page (browser). Everything that
 * crosses the SSE stream or the JSON API is described here.
 */

/** OpenTelemetry severity numbers (first value of each range). */
export const SEVERITY = {
  TRACE: 1,
  DEBUG: 5,
  INFO: 9,
  WARN: 13,
  ERROR: 17,
  FATAL: 21,
} as const;

export type SeverityName = keyof typeof SEVERITY;

/** Maps an OTel severity number (1-24, 0 = unspecified) to its range name. */
export function severityName(severityNumber: number): SeverityName {
  if (severityNumber >= SEVERITY.FATAL) return 'FATAL';
  if (severityNumber >= SEVERITY.ERROR) return 'ERROR';
  if (severityNumber >= SEVERITY.WARN) return 'WARN';
  if (severityNumber >= SEVERITY.INFO) return 'INFO';
  if (severityNumber >= SEVERITY.DEBUG) return 'DEBUG';
  if (severityNumber >= SEVERITY.TRACE) return 'TRACE';
  return 'INFO';
}

/** Service names (`service.name`) the monitor knows how to group. Others land in "All". */
export const SERVICES = {
  site: 'studio-site',
  electronMain: 'studio-electron-main',
  electronRenderer: 'studio-electron-renderer',
  build: 'studio-build',
} as const;

/** A log record before the hub assigns its id. */
export interface LogRecordInput {
  readonly service: string;
  readonly timeMs: number;
  readonly severityNumber: number;
  readonly severityText: string;
  readonly body: string;
  readonly scope?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly resource?: Readonly<Record<string, unknown>>;
}

export interface LogRecord extends LogRecordInput {
  /** Monotonic per orchestrator run; the page uses it as a React key. */
  readonly id: number;
}

export type ProcessState =
  'pending' | 'starting' | 'running' | 'restarting' | 'exited' | 'crashed' | 'stopped';

/** One supervised child process (or step) of the dev environment. */
export interface ServiceStatus {
  readonly id: string;
  readonly label: string;
  readonly state: ProcessState;
  readonly pid?: number;
  readonly url?: string;
  readonly exitCode?: number | null;
  readonly detail?: string;
  /** Epoch ms of the last state change. */
  readonly sinceMs: number;
}
