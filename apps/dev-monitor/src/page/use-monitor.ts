/** Subscribes to the monitor's SSE stream and keeps records and service statuses in state. */
import { useEffect, useRef, useState } from 'react';
import type { LogRecord, ServiceStatus } from '../shared/types';

/** Records kept in the page (matches the server's ring buffer). */
export const MAX_RECORDS = 5000;
const FLUSH_MS = 150;

export type Connection = 'connecting' | 'open' | 'closed';

export interface MonitorState {
  readonly records: readonly LogRecord[];
  readonly statuses: ReadonlyMap<string, ServiceStatus>;
  readonly connection: Connection;
}

export function useMonitor(paused: boolean): MonitorState & { clearLocal(): void } {
  const [records, setRecords] = useState<readonly LogRecord[]>([]);
  const [statuses, setStatuses] = useState<ReadonlyMap<string, ServiceStatus>>(new Map());
  const [connection, setConnection] = useState<Connection>('connecting');
  const pending = useRef<LogRecord[]>([]);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const source = new EventSource('/events');
    // The server replays its ring buffer on every (re)connect: start from scratch.
    source.addEventListener('open', () => {
      setConnection('open');
      pending.current = [];
      setRecords([]);
    });
    source.addEventListener('error', () => setConnection('closed'));
    source.addEventListener('log', (event) => {
      const queue = pending.current;
      queue.push(JSON.parse((event as MessageEvent<string>).data) as LogRecord);
      // While paused the queue keeps only what the list could show anyway.
      if (queue.length > MAX_RECORDS) queue.splice(0, queue.length - MAX_RECORDS);
    });
    source.addEventListener('clear', () => {
      pending.current = [];
      setRecords([]);
    });
    source.addEventListener('status', (event) => {
      const status = JSON.parse((event as MessageEvent<string>).data) as ServiceStatus;
      setStatuses((prev) => new Map(prev).set(status.id, status));
    });
    source.addEventListener('status-remove', (event) => {
      const { id } = JSON.parse((event as MessageEvent<string>).data) as { id: string };
      setStatuses((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    });
    // Batch incoming records so a burst (or the replay) renders once per interval.
    const timer = setInterval(() => {
      if (pausedRef.current || pending.current.length === 0) return;
      const batch = pending.current;
      pending.current = [];
      setRecords((prev) => {
        const next = prev.concat(batch);
        return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
      });
    }, FLUSH_MS);
    return () => {
      clearInterval(timer);
      source.close();
    };
  }, []);

  return {
    records,
    statuses,
    connection,
    clearLocal: () => {
      pending.current = [];
      setRecords([]);
    },
  };
}

export async function post(path: string): Promise<void> {
  const response = await fetch(path, { method: 'POST' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
}
