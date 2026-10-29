import type { Logger, LogLevel } from '@studio/platform-contracts';

export interface LogRecord {
  readonly level: LogLevel;
  readonly message: string;
  readonly data?: unknown;
  readonly timeMs: number;
}

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Console-backed logger keeping a bounded in-memory ring buffer for diagnostics. */
export class BrowserLogger implements Logger {
  private readonly records: LogRecord[] = [];

  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly capacity = 500,
  ) {}

  log(level: LogLevel, message: string, data?: unknown): void {
    const record: LogRecord = data === undefined ? { level, message, timeMs: performance.now() } : { level, message, data, timeMs: performance.now() };
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
    if (ORDER[level] < ORDER[this.minLevel]) return;
    const prefix = `[studio] ${message}`;
    if (level === 'error') console.error(prefix, ...(data === undefined ? [] : [data]));
    else if (level === 'warn') console.warn(prefix, ...(data === undefined ? [] : [data]));
    // debug/info are kept in the ring buffer only (no console noise in production).
  }

  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  recent(): readonly LogRecord[] {
    return this.records;
  }
}
