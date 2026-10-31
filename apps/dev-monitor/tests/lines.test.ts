import { describe, expect, it } from 'vitest';
import { detectLocalUrl, lineToRecord, stripAnsi } from '../src/lines';

const ctx = { service: 'studio-next', stream: 'stdout' as const, nowMs: 1 };

describe('stripAnsi', () => {
  it('removes colour and cursor sequences', () => {
    expect(stripAnsi('\u001b[32m✓\u001b[39m Ready \u001b[2K\u001b[1Gdone')).toBe('✓ Ready done');
  });
});

describe('lineToRecord', () => {
  it.each([
    [' ⨯ Failed to compile', 'ERROR'],
    [' ⚠ Port 3000 is in use', 'WARN'],
    [' ✓ Ready in 256ms', 'INFO'],
    [' ○ Compiling /studio ...', 'INFO'],
    ['   ▲ Next.js 16.4.3 (Turbopack)', 'INFO'],
    [' » something', 'INFO'],
    [' GET /studio 200 in 173ms', 'INFO'],
    ['Error: boom', 'ERROR'],
    ['TypeError: x is not a function', 'ERROR'],
    ['    at foo (file.js:1:1)', 'ERROR'],
    ['Warning: deprecated', 'WARN'],
  ])('%s -> %s', (line, severity) => {
    expect(lineToRecord(line, ctx)?.severityText).toBe(severity);
  });

  it('uses the stream for unrecognised lines', () => {
    expect(lineToRecord('hello', ctx)?.severityText).toBe('INFO');
    expect(lineToRecord('hello', { ...ctx, stream: 'stderr' })?.severityText).toBe('WARN');
    expect(
      lineToRecord('Done in 12ms', { ...ctx, stream: 'stderr', stderrSeverity: 9 })?.severityText,
    ).toBe('INFO');
  });

  it('builds the record with stream, attributes and stripped body', () => {
    const record = lineToRecord('\u001b[31m⨯\u001b[39m bad\r', {
      ...ctx,
      stream: 'stderr',
      attributes: { 'studio.task': 'css' },
    });
    expect(record).toEqual({
      service: 'studio-next',
      timeMs: 1,
      severityNumber: 17,
      severityText: 'ERROR',
      body: '⨯ bad',
      scope: 'stdio',
      attributes: { 'studio.task': 'css', 'log.iostream': 'stderr' },
    });
  });

  it('tags [browser] lines from logging.browserToTerminal', () => {
    const record = lineToRecord('[browser] [studio] ready (app/page.tsx:3:1)', ctx);
    expect(record?.body).toBe('[studio] ready (app/page.tsx:3:1)');
    expect(record?.attributes['studio.source']).toBe('next-browser');
  });

  it('reads Chromium log levels', () => {
    const line = '[42519:1031/101500.123456:ERROR:gpu_init.cc(1)] GPU failed';
    const record = lineToRecord(line, { ...ctx, stream: 'stderr' });
    expect(record?.severityText).toBe('ERROR');
    expect(record?.attributes['studio.source']).toBe('chromium');
    const verbose = lineToRecord('[1:2:VERBOSE1:x.cc(3)] detail', ctx);
    expect(verbose?.severityText).toBe('DEBUG');
  });

  it('drops blank lines', () => {
    expect(lineToRecord('   ', ctx)).toBeNull();
    expect(lineToRecord('\u001b[0m', ctx)).toBeNull();
  });
});

describe('detectLocalUrl', () => {
  it('finds the next dev URL', () => {
    expect(detectLocalUrl('   - Local:        http://localhost:3002')).toBe(
      'http://localhost:3002',
    );
    expect(detectLocalUrl('\u001b[1m- Local:\u001b[22m http://localhost:3000/')).toBe(
      'http://localhost:3000',
    );
    expect(detectLocalUrl(' ✓ Ready in 2s')).toBeNull();
  });
});
