import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogHub } from '../src/log-hub';
import { createMonitorServer, isLoopbackOrigin } from '../src/server';

let hub: LogHub;
let base: string;
let calls: string[];
let close: () => Promise<void>;

beforeEach(async () => {
  hub = new LogHub();
  calls = [];
  const server = createMonitorServer({
    hub,
    assets: () => ({ html: '<!doctype html>', js: 'js', css: 'css' }),
    actions: {
      openElectron: () => void calls.push('open'),
      restartElectron: () => void calls.push('restart'),
    },
    info: () => ({ siteUrl: 'http://localhost:3000' }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(() => resolve()));
  };
});

afterEach(() => close());

const otlp = JSON.stringify({
  resourceLogs: [
    {
      resource: { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
      scopeLogs: [{ logRecords: [{ severityNumber: 9, body: { stringValue: 'hi' } }] }],
    },
  ],
});

describe('monitor server', () => {
  it('accepts OTLP/JSON and answers with CORS for loopback origins', async () => {
    const response = await fetch(`${base}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: otlp,
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{}');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(hub.records().map((r) => r.body)).toEqual(['hi']);
  });

  it('rejects foreign origins, unknown content types and bad bodies', async () => {
    const post = (headers: Record<string, string>, body = otlp) =>
      fetch(`${base}/v1/logs`, { method: 'POST', headers, body }).then((r) => r.status);
    expect(await post({ 'content-type': 'application/json', origin: 'https://evil.test' })).toBe(
      403,
    );
    expect(await post({ 'content-type': 'text/plain' })).toBe(415);
    expect(await post({ 'content-type': 'application/json' }, '{')).toBe(400);
    expect(hub.records()).toHaveLength(0);
  });

  it('runs actions and serves services, the page and SSE', async () => {
    expect((await fetch(`${base}/api/electron/open`, { method: 'POST' })).status).toBe(202);
    expect((await fetch(`${base}/api/electron/restart`, { method: 'POST' })).status).toBe(202);
    expect(calls).toEqual(['open', 'restart']);
    hub.setStatus({ id: 'site', label: 'Site', state: 'running', sinceMs: 1 });
    const services = (await (await fetch(`${base}/api/services`)).json()) as {
      siteUrl: string;
      services: unknown[];
    };
    expect(services.siteUrl).toBe('http://localhost:3000');
    expect(services.services).toHaveLength(1);
    const page = await fetch(`${base}/`);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    hub.publish({
      service: 's',
      timeMs: 1,
      severityNumber: 9,
      severityText: '',
      body: 'x',
      attributes: {},
    });
    const controller = new AbortController();
    const events = await fetch(`${base}/events`, { signal: controller.signal });
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body!.getReader();
    let text = '';
    while (!text.includes('event: ready'))
      text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: status');
    expect(text).toContain('"body":"x"');
    controller.abort();
    expect((await fetch(`${base}/api/logs/clear`, { method: 'POST' })).status).toBe(202);
    expect(hub.records()).toHaveLength(0);
  });
});

describe('isLoopbackOrigin', () => {
  it('accepts only loopback http(s) origins', () => {
    expect(isLoopbackOrigin('http://localhost:3000')).toBe(true);
    expect(isLoopbackOrigin('http://127.0.0.1:3300')).toBe(true);
    expect(isLoopbackOrigin('http://[::1]:3000')).toBe(true);
    expect(isLoopbackOrigin('http://localhost.evil.test')).toBe(false);
    expect(isLoopbackOrigin('studio://app')).toBe(false);
    expect(isLoopbackOrigin('null')).toBe(false);
  });
});
