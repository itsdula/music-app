/**
 * The dev-monitor page: service status pills, links to the Next.js app, Electron controls
 * and one log pane per service (plus "All"), with severity filter, search, pause,
 * autoscroll and clear.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  SERVICES,
  SEVERITY,
  severityName,
  type LogRecord,
  type ServiceStatus,
  type SeverityName,
} from '../shared/types';
import { post, useMonitor, type Connection } from './use-monitor';

/** Rows rendered at once; older matches stay in memory but out of the DOM. */
const MAX_ROWS = 1000;

interface Tab {
  readonly id: string;
  readonly label: string;
  readonly services: readonly string[] | null;
}

const TABS: readonly Tab[] = [
  { id: 'all', label: 'All', services: null },
  { id: 'next', label: 'Next.js', services: [SERVICES.next] },
  { id: 'electron-main', label: 'Electron main', services: [SERVICES.electronMain] },
  { id: 'electron-renderer', label: 'Electron renderer', services: [SERVICES.electronRenderer] },
  { id: 'build', label: 'Build', services: [SERVICES.build] },
];

const SERVICE_LABEL: Record<string, string> = {
  [SERVICES.next]: 'next',
  [SERVICES.electronMain]: 'main',
  [SERVICES.electronRenderer]: 'renderer',
  [SERVICES.build]: 'build',
};

const LEVELS: readonly SeverityName[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

function formatTime(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function sourceOf(record: LogRecord): string {
  const source = record.attributes['studio.source'];
  if (typeof source === 'string') return source;
  const task = record.attributes['studio.task'];
  return typeof task === 'string' ? task : (SERVICE_LABEL[record.service] ?? record.service);
}

function StatusPill({ status }: { status: ServiceStatus }) {
  const title = [
    `${status.label}: ${status.state}`,
    status.pid ? `pid ${status.pid}` : '',
    status.detail ?? '',
    status.url ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="pill" data-state={status.state} title={title}>
      <span className="dot" aria-hidden="true" />
      <span className="pill-label">{status.label}</span>
      <span className="pill-state">{status.state}</span>
    </li>
  );
}

function ConnectionBadge({ connection }: { connection: Connection }) {
  const text =
    connection === 'open' ? 'live' : connection === 'connecting' ? 'connecting' : 'reconnecting';
  return (
    <span className="connection" data-state={connection} role="status">
      {text}
    </span>
  );
}

function LogRow({
  record,
  expanded,
  onToggle,
}: {
  record: LogRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const level = severityName(record.severityNumber);
  const detailsId = `rec-${record.id}`;
  return (
    <li className="row" data-level={level}>
      <button
        type="button"
        className="row-summary"
        aria-expanded={expanded}
        aria-controls={expanded ? detailsId : undefined}
        onClick={onToggle}
      >
        <time className="time" dateTime={new Date(record.timeMs).toISOString()}>
          {formatTime(record.timeMs)}
        </time>
        <span className="level">{record.severityText || level}</span>
        <span className="source">{sourceOf(record)}</span>
        <span className="body">{record.body}</span>
      </button>
      {expanded ? (
        <dl className="details" id={detailsId}>
          <dt>Time</dt>
          <dd>{new Date(record.timeMs).toISOString()}</dd>
          <dt>Severity</dt>
          <dd>
            {record.severityText || level} ({record.severityNumber})
          </dd>
          <dt>Service</dt>
          <dd>{record.service}</dd>
          {record.scope ? (
            <>
              <dt>Scope</dt>
              <dd>{record.scope}</dd>
            </>
          ) : null}
          <dt>Body</dt>
          <dd>
            <pre>{record.body}</pre>
          </dd>
          <dt>Attributes</dt>
          <dd>
            <pre>{JSON.stringify(record.attributes, null, 2)}</pre>
          </dd>
          {record.resource ? (
            <>
              <dt>Resource</dt>
              <dd>
                <pre>{JSON.stringify(record.resource, null, 2)}</pre>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}

export function App() {
  const [tab, setTab] = useState('all');
  const [minLevel, setMinLevel] = useState<SeverityName>('DEBUG');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const monitor = useMonitor(paused);
  const { records, statuses, connection } = monitor;
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const ids = useId();

  const nextStatus = statuses.get('next');
  const nextUrl = nextStatus?.url ?? 'http://localhost:3000';
  const electronStatus = statuses.get('electron');
  const electronRunning =
    electronStatus?.state === 'running' || electronStatus?.state === 'starting';

  const counts = useMemo(() => {
    const byService = new Map<string, number>();
    for (const record of records) {
      byService.set(record.service, (byService.get(record.service) ?? 0) + 1);
    }
    return byService;
  }, [records]);

  const visible = useMemo(() => {
    const services = TABS.find((t) => t.id === tab)?.services ?? null;
    const min = SEVERITY[minLevel];
    const needle = query.trim().toLowerCase();
    const matches: LogRecord[] = [];
    // Newest first so the cap keeps the most recent rows, then restore the order.
    for (let i = records.length - 1; i >= 0 && matches.length < MAX_ROWS; i--) {
      const record = records[i]!;
      if (services && !services.includes(record.service)) continue;
      if ((record.severityNumber || SEVERITY.INFO) < min) continue;
      if (
        needle &&
        !record.body.toLowerCase().includes(needle) &&
        !sourceOf(record).toLowerCase().includes(needle)
      ) {
        continue;
      }
      matches.push(record);
    }
    return matches.reverse();
  }, [records, tab, minLevel, query]);

  useEffect(() => {
    if (!autoscroll) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [visible, autoscroll]);

  const runAction = (path: string) => {
    setActionError(null);
    post(path).catch((error: unknown) => setActionError(String(error)));
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    let nextIndex: number;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    const nextTab = TABS[nextIndex]!;
    setTab(nextTab.id);
    tabRefs.current.get(nextTab.id)?.focus();
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const panelId = `${ids}-panel`;
  const truncated = visible.length >= MAX_ROWS;

  return (
    <div className="app">
      <header className="header">
        <div className="title">
          <h1>Studio dev monitor</h1>
          <ConnectionBadge connection={connection} />
        </div>
        <nav className="links" aria-label="Apps">
          <a className="link primary" href={`${nextUrl}/studio`} target="_blank" rel="noreferrer">
            Open Studio (Next.js)
          </a>
          <a className="link" href={nextUrl} target="_blank" rel="noreferrer">
            {nextUrl.replace(/^https?:\/\//, '')}
          </a>
          <button type="button" className="button" onClick={() => runAction('/api/electron/open')}>
            {electronRunning ? 'Focus Electron' : 'Open Electron'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => runAction('/api/electron/restart')}
          >
            Restart Electron
          </button>
        </nav>
        <ul className="pills" aria-label="Services">
          {[...statuses.values()].map((status) => (
            <StatusPill key={status.id} status={status} />
          ))}
        </ul>
        {actionError ? (
          <p className="error" role="alert">
            {actionError}
          </p>
        ) : null}
      </header>

      <div className="tabs" role="tablist" aria-label="Log sources">
        {TABS.map((t) => {
          const count = t.services
            ? t.services.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0)
            : records.length;
          const selected = t.id === tab;
          return (
            <button
              key={t.id}
              ref={(el) => {
                if (el) tabRefs.current.set(t.id, el);
                else tabRefs.current.delete(t.id);
              }}
              type="button"
              role="tab"
              id={`${ids}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className="tab"
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              {t.label} <span className="count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar">
        <label className="field">
          <span>Min severity</span>
          <select value={minLevel} onChange={(e) => setMinLevel(e.target.value as SeverityName)}>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="field grow">
          <span>Search</span>
          <input
            type="search"
            value={query}
            placeholder="Filter by text"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="button"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          Autoscroll
        </label>
        <button
          type="button"
          className="button"
          onClick={() => {
            monitor.clearLocal();
            setExpanded(new Set());
            runAction('/api/logs/clear');
          }}
        >
          Clear
        </button>
      </div>

      <div
        className="panel"
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${ids}-tab-${tab}`}
        ref={listRef}
        tabIndex={0}
      >
        {truncated ? (
          <p className="notice">Showing the latest {MAX_ROWS} matching records.</p>
        ) : null}
        {visible.length === 0 ? (
          <p className="empty">
            No records{query || minLevel !== 'DEBUG' ? ' match the filters' : ' yet'}.
          </p>
        ) : (
          <ol
            className="rows"
            role="log"
            aria-live={paused ? 'off' : 'polite'}
            aria-relevant="additions"
          >
            {visible.map((record) => (
              <LogRow
                key={record.id}
                record={record}
                expanded={expanded.has(record.id)}
                onToggle={() => toggle(record.id)}
              />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
