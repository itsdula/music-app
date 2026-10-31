/**
 * Turns one line of a child's stdout/stderr into a log record: strips ANSI escapes and
 * infers the severity from Next.js' log prefixes (`next/dist/build/output/log.js`),
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

const NEXT_PREFIXES: ReadonlyArray<readonly [string, number]> = [
  ['⨯', SEVERITY.ERROR],
  ['⚠', SEVERITY.WARN],
  ['✓', SEVERITY.INFO],
  ['○', SEVERITY.INFO],
  ['▲', SEVERITY.INFO],
  ['»', SEVERITY.INFO],
];

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
const BROWSER = /^\[browser\]\s*/;

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

  if (BROWSER.test(body)) {
    // `logging.browserToTerminal`: the page's console, forwarded by `next dev`.
    attributes['studio.source'] = 'next-browser';
    body = body.replace(BROWSER, '');
  }
  const chromium = CHROMIUM.exec(body);
  if (chromium) {
    const level = chromium[1]!;
    severity = level.startsWith('VERBOSE') ? SEVERITY.DEBUG : CHROMIUM_LEVEL[level];
    attributes['studio.source'] = 'chromium';
  }
  const trimmed = body.trimStart();
  if (severity === undefined) {
    for (const [prefix, level] of NEXT_PREFIXES) {
      if (trimmed.startsWith(prefix)) {
        severity = level;
        break;
      }
    }
  }
  if (severity === undefined) {
    if (ERROR_WORD.test(trimmed) || STACK_FRAME.test(trimmed)) severity = SEVERITY.ERROR;
    else if (WARN_WORD.test(trimmed)) severity = SEVERITY.WARN;
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

/** Finds the URL `next dev` prints (`- Local:        http://localhost:3000`). */
export function detectLocalUrl(line: string): string | null {
  const match = LOCAL_URL.exec(stripAnsi(line));
  return match ? match[1]!.replace(/\/$/, '') : null;
}
