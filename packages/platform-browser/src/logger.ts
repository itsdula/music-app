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

  /**
   * @param consoleLevel lowest level also printed to the console. `warn` by default (no
   *   console noise in production); dev builds lower it so host tooling can capture info/debug.
   */
  constructor(
    private readonly minLevel: LogLevel = 'info',
    private readonly capacity = 500,
    private readonly consoleLevel: LogLevel = 'warn',
  ) {}

  log(level: LogLevel, message: string, data?: unknown): void {
    const record: LogRecord =
      data === undefined
        ? { level, message, timeMs: performance.now() }
        : { level, message, data, timeMs: performance.now() };
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
    if (ORDER[level] < ORDER[this.minLevel] || ORDER[level] < ORDER[this.consoleLevel]) return;
    const prefix = `[studio] ${message}`;
    const args = data === undefined ? [] : [data];
    if (level === 'error') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    // eslint-disable-next-line no-console -- only reached when consoleLevel was lowered (dev)
    else if (level === 'info') console.info(prefix, ...args);
    // eslint-disable-next-line no-console -- only reached when consoleLevel was lowered (dev)
    else console.debug(prefix, ...args);
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
