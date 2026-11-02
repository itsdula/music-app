/**
 * Structured main-process lifecycle log for `pnpm dev`. A no-op unless the dev build
 * (`__STUDIO_DEV__`) installed a sink, so production code can call it freely; it carries no
 * telemetry code itself (that lives in dev-telemetry.ts, compiled only into dev builds).
 */
export type DevLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type DevLogAttributes = Readonly<Record<string, string | number | boolean>>;
export type DevLogSink = (level: DevLogLevel, body: string, attributes?: DevLogAttributes) => void;

let sink: DevLogSink | null = null;

export function setDevLogSink(next: DevLogSink | null): void {
  sink = next;
}

export function devLog(level: DevLogLevel, body: string, attributes?: DevLogAttributes): void {
  sink?.(level, body, attributes);
}
