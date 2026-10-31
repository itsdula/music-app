/**
 * In-memory hub between log producers (OTLP receiver, child stdio) and SSE clients: a bounded
 * ring buffer replayed to every new client, plus the current status of each service.
 */
import type { LogRecord, LogRecordInput, ServiceStatus } from './shared/types';

/** Anything an SSE frame can be written to (an `http.ServerResponse` in practice). */
export interface SseSink {
  write(chunk: string): unknown;
  /** Bytes queued but not yet flushed (Node `ServerResponse`). */
  readonly writableLength?: number;
  /** Drops the connection; EventSource reconnects and gets the ring replayed. */
  destroy?(): void;
}

/** A client whose unflushed backlog passes this is considered stalled and dropped. */
export const MAX_CLIENT_BACKLOG_BYTES = 4 * 1024 * 1024;

export const DEFAULT_RING_CAPACITY = 5000;

export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class LogHub {
  private readonly ring: LogRecord[] = [];
  private readonly clients = new Set<SseSink>();
  private readonly statuses = new Map<string, ServiceStatus>();
  private nextId = 1;

  constructor(private readonly capacity = DEFAULT_RING_CAPACITY) {}

  publish(input: LogRecordInput): LogRecord {
    const record: LogRecord = { ...input, id: this.nextId++ };
    this.ring.push(record);
    if (this.ring.length > this.capacity) this.ring.splice(0, this.ring.length - this.capacity);
    this.broadcast(sseFrame('log', record));
    return record;
  }

  publishAll(inputs: readonly LogRecordInput[]): void {
    for (const input of inputs) this.publish(input);
  }

  /** Records currently held (oldest first). */
  records(): readonly LogRecord[] {
    return this.ring;
  }

  clear(): void {
    this.ring.length = 0;
    this.broadcast(sseFrame('clear', {}));
  }

  setStatus(status: ServiceStatus): void {
    this.statuses.set(status.id, status);
    this.broadcast(sseFrame('status', status));
  }

  removeStatus(id: string): void {
    if (this.statuses.delete(id)) this.broadcast(sseFrame('status-remove', { id }));
  }

  status(id: string): ServiceStatus | undefined {
    return this.statuses.get(id);
  }

  allStatuses(): ServiceStatus[] {
    return [...this.statuses.values()];
  }

  /** Sends the current statuses and the ring buffer, then streams new events. */
  addClient(client: SseSink): () => void {
    client.write('retry: 1000\n\n');
    for (const status of this.statuses.values()) client.write(sseFrame('status', status));
    for (const record of this.ring) client.write(sseFrame('log', record));
    client.write(sseFrame('ready', { count: this.ring.length }));
    this.clients.add(client);
    return () => {
      this.clients.delete(client);
    };
  }

  clientCount(): number {
    return this.clients.size;
  }

  /** Comment frame that keeps proxies and idle connections open. */
  ping(): void {
    this.broadcast(': ping\n\n');
  }

  private broadcast(frame: string): void {
    for (const client of this.clients) {
      // A stalled socket (paused tab, suspended curl) would otherwise buffer without bound.
      if (client.write(frame) !== false) continue;
      if ((client.writableLength ?? 0) <= MAX_CLIENT_BACKLOG_BYTES) continue;
      this.clients.delete(client);
      client.destroy?.();
    }
  }
}
