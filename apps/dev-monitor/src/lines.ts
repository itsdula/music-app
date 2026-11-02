/**
 * Turns one line of a child's stdout/stderr into a log record: strips ANSI escapes and
 * infers the severity from the browser console lines Vite forwards (`server.forwardConsole`),
 * Chromium's `[pid:tid:...:LEVEL:file(line)]` prefix, or the stream it came from.
 */
import { SEVERITY, severityName, type LogRecordInput } from './shared/types';

export type IoStream = 'stdout' | 'stderr';

// CSI / OSC sequences and lone ESC codes (what `strip-ansi` matches, without the dependency).
const ANSI =
  // eslint-disable-next-line no-control-regex -- matching terminal escape codes is the point
  /[\u001B\u009B](?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[[\]()#;?]*(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g;

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '');
}

/**
 * Vite's logger prefix when it logs with `timestamp: true`: the local time
 * (`toLocaleTimeString()`, so `12:34:56 PM` or `12:34:56`), the tag (`[vite+]` under Vite+,
 * `[vite]` under plain Vite) and the environment (`(client)`), e.g.
 * `8:50:10 PM [vite+] (client) [console.log] ready`.
 */
const VITE_PREFIX = /^(?:\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?\s+)?\[vite\+?\]\s+(?:\(\w+\)\s+)?/i;
/** `server.forwardConsole`: the page's console, forwarded by the Vite dev server. */
const VITE_CONSOLE = /^\[console\.(\w+)\]\s?/;
/** `server.forwardConsole`: an uncaught error or unhandled rejection in the page. */
const VITE_UNHANDLED = /^\[Unhandled (?:error|rejection)\]/;
/** Vite's dev-server failures (`[vite] Internal server error: ...`, `Pre-transform error: ...`). */
const VITE_ERROR = /^(?:internal server|pre-transform|transform) error\b/i;
const CONSOLE_LEVEL: Record<string, number> = {
  error: SEVERITY.ERROR,
  warn: SEVERITY.WARN,
  info: SEVERITY.INFO,
  log: SEVERITY.INFO,
  debug: SEVERITY.DEBUG,
};

// `[pid:tid:MMDD/HHMMSS.micros:LEVEL:file.cc(line)]`, with optional parts left out.
const CHROMIUM = /^\[[\d:/.]+:(VERBOSE\d*|INFO|WARNING|ERROR|FATAL):[^\]]*\]\s*/;
const CHROMIUM_LEVEL: Record<string, number> = {
  INFO: SEVERITY.INFO,
  WARNING: SEVERITY.WARN,
  ERROR: SEVERITY.ERROR,
  FATAL: SEVERITY.FATAL,
};
const ERROR_WORD = /^(?:error|uncaught|unhandled|fatal)\b|^\w*Error:/i;
/** A stack frame line: `at fn (file.js:1:2)` or `at file.js:1:2`. */
const STACK_FRAME = /^at\s+(?:.+\s\()?\S+:\d+:\d+\)?$/;
const WARN_WORD = /^(?:warn(?:ing)?)\b/i;

export interface LineContext {
  readonly service: string;
  readonly stream: IoStream;
  /** Extra attributes for every record of this child (e.g. `studio.task`). */
  readonly attributes?: Readonly<Record<string, unknown>>;
  /** Severity of an unrecognised stderr line (default WARN; tools that log progress on stderr use INFO). */
  readonly stderrSeverity?: number;
  readonly nowMs?: number;
}

/** Returns null for lines that are empty after stripping. */
export function lineToRecord(rawLine: string, context: LineContext): LogRecordInput | null {
  let body = stripAnsi(rawLine).replace(/\r$/, '').trimEnd();
  if (body.trim() === '') return null;
  const attributes: Record<string, unknown> = {
    ...context.attributes,
    'log.iostream': context.stream,
  };
  let severity: number | undefined;

  const vitePrefix = VITE_PREFIX.exec(body);
  const afterPrefix = vitePrefix ? body.slice(vitePrefix[0].length) : body;
  const browserConsole = VITE_CONSOLE.exec(afterPrefix);
  if (browserConsole) {
    attributes['studio.source'] = 'site-browser';
    severity = CONSOLE_LEVEL[browserConsole[1]!.toLowerCase()] ?? SEVERITY.INFO;
    body = afterPrefix.slice(browserConsole[0].length);
  } else if (VITE_UNHANDLED.test(afterPrefix)) {
    attributes['studio.source'] = 'site-browser';
    severity = SEVERITY.ERROR;
    body = afterPrefix;
  }
  const chromium = severity === undefined ? CHROMIUM.exec(body) : null;
  if (chromium) {
    const level = chromium[1]!;
    severity = level.startsWith('VERBOSE') ? SEVERITY.DEBUG : CHROMIUM_LEVEL[level];
    attributes['studio.source'] = 'chromium';
  }
  // Judge Vite's own messages by what follows its `[vite]` prefix; the body keeps the prefix.
  const trimmed = afterPrefix.trimStart();
  if (severity === undefined) {
    if (ERROR_WORD.test(trimmed) || VITE_ERROR.test(trimmed) || STACK_FRAME.test(trimmed)) {
      severity = SEVERITY.ERROR;
    } else if (WARN_WORD.test(trimmed)) severity = SEVERITY.WARN;
    else if (context.stream === 'stderr') severity = context.stderrSeverity ?? SEVERITY.WARN;
    else severity = SEVERITY.INFO;
  }

  return {
    service: context.service,
    timeMs: context.nowMs ?? Date.now(),
    severityNumber: severity,
    severityText: severityName(severity),
    body,
    scope: 'stdio',
    attributes,
  };
}

const LOCAL_URL = /(?:Local|url):\s+(https?:\/\/[^\s]+)/i;

/** Finds the URL the Vite dev server prints (`➜  Local:   http://localhost:3000/`). */
export function detectLocalUrl(line: string): string | null {
  const match = LOCAL_URL.exec(stripAnsi(line));
  return match ? match[1]!.replace(/\/$/, '') : null;
}
