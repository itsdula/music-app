/**
 * Supervised child processes. Each child runs in its own process group (`detached`) so a
 * stop signal reaches its whole tree (next dev forks next-server; Electron spawns helpers),
 * and every stdout/stderr line becomes a log record instead of terminal output.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { lineToRecord, type IoStream } from './lines';
import type { LogHub } from './log-hub';
import type { ProcessState } from './shared/types';

export interface ChildSpec {
  readonly id: string;
  readonly label: string;
  /** `service.name` of the records made from its output. */
  readonly service: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly attributes?: Readonly<Record<string, unknown>>;
  /** See `LineContext.stderrSeverity`. */
  readonly stderrSeverity?: number;
  /** Marks the child `running` when it returns true (default: as soon as it spawns). */
  readonly isReady?: (line: string) => boolean;
  /** Sees every raw line (after its record is published, before `isReady`). */
  readonly onLine?: (line: string, stream: IoStream) => void;
}

/** Child environment: no colours, no Electron-as-Node (VS Code terminals export it). */
export function childEnv(
  base: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...extra, NO_COLOR: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.FORCE_COLOR;
  return env;
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

const live = new Set<number>();
let exitHookInstalled = false;

/** Last resort: if the orchestrator dies, take every child group with it. */
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const pid of live) killGroup(pid, 'SIGKILL');
  });
}

export class ManagedProcess {
  private child: ChildProcess | null = null;
  private stopping = false;
  private exitWaiters: Array<() => void> = [];
  private url: string | undefined;

  constructor(
    private readonly spec: ChildSpec,
    private readonly hub: LogHub,
    private readonly onExit?: (code: number | null, signal: NodeJS.Signals | null) => void,
  ) {
    installExitHook();
    this.setState('pending');
  }

  get running(): boolean {
    return this.child !== null;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  setUrl(url: string): void {
    this.url = url;
    const current = this.hub.status(this.spec.id);
    if (current) this.hub.setStatus({ ...current, url });
  }

  setState(state: ProcessState, extra: { exitCode?: number | null; detail?: string } = {}): void {
    this.hub.setStatus({
      id: this.spec.id,
      label: this.spec.label,
      state,
      ...(this.child?.pid !== undefined && (state === 'starting' || state === 'running')
        ? { pid: this.child.pid }
        : {}),
      ...(this.url ? { url: this.url } : {}),
      ...extra,
      sinceMs: Date.now(),
    });
  }

  start(): void {
    if (this.child) return;
    this.stopping = false;
    const { spec, hub } = this;
    const child = spawn(spec.command, [...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      // stdin stays an open pipe: some watchers (the Tailwind CLI) exit when stdin closes.
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    this.child = child;
    if (child.pid !== undefined) live.add(child.pid);
    this.setState(spec.isReady ? 'starting' : 'running');
    let ready = !spec.isReady;

    const follow = (stream: NodeJS.ReadableStream, name: IoStream) => {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      lines.on('line', (line) => {
        const record = lineToRecord(line, {
          service: spec.service,
          stream: name,
          attributes: { 'studio.process': spec.id, ...spec.attributes },
          ...(spec.stderrSeverity !== undefined ? { stderrSeverity: spec.stderrSeverity } : {}),
        });
        if (record) hub.publish(record);
        spec.onLine?.(line, name);
        if (!ready && this.child === child && spec.isReady?.(line)) {
          ready = true;
          this.setState('running');
        }
      });
    };
    follow(child.stdout!, 'stdout');
    follow(child.stderr!, 'stderr');

    child.on('error', (error) => {
      hub.publish({
        service: spec.service,
        timeMs: Date.now(),
        severityNumber: 17,
        severityText: 'ERROR',
        body: `${spec.label}: failed to start: ${error.message}`,
        scope: 'dev-monitor',
        attributes: { 'studio.process': spec.id },
      });
    });
    child.on('exit', (code, signal) => {
      if (child.pid !== undefined) live.delete(child.pid);
      // Helpers left in the group (e.g. a forked next-server) must not outlive it.
      if (child.pid !== undefined) killGroup(child.pid, 'SIGTERM');
      this.child = null;
      const stopped = this.stopping;
      if (stopped) this.setState('stopped', { exitCode: code });
      else if (code === 0) this.setState('exited', { exitCode: code });
      else this.setState('crashed', { exitCode: code, detail: signal ?? `exit code ${code}` });
      hub.publish({
        service: spec.service,
        timeMs: Date.now(),
        severityNumber: stopped || code === 0 ? 9 : 17,
        severityText: stopped || code === 0 ? 'INFO' : 'ERROR',
        body: `${spec.label} exited (${signal ?? `code ${code}`})`,
        scope: 'dev-monitor',
        attributes: { 'studio.process': spec.id },
      });
      const waiters = this.exitWaiters;
      this.exitWaiters = [];
      for (const resolve of waiters) resolve();
      if (!stopped) this.onExit?.(code, signal);
    });
  }

  /** Sends `signal` to the process group, then SIGKILL after `timeoutMs`. */
  async stop(timeoutMs = 5000, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) return;
    this.stopping = true;
    const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve));
    killGroup(child.pid, signal);
    const timer = setTimeout(() => {
      if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL');
    }, timeoutMs);
    await exited;
    clearTimeout(timer);
  }

  /** Resolves when the child exits (immediately when it is not running). */
  waitForExit(): Promise<void> {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => this.exitWaiters.push(resolve));
  }
}
