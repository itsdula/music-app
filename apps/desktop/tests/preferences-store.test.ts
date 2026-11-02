import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPreferencesStore,
  serializePreferences,
  type PreferencesStoreOptions,
} from '../src/main/preferences-store';
import { MAX_PREFERENCE_VALUE_BYTES, MAX_PREFERENCES_TOTAL_BYTES } from '../src/shared/host-api';

let dir: string;
let filePath: string;
let warnings: Array<[string, unknown]>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'studio-preferences-'));
  filePath = join(dir, 'preferences.json');
  warnings = [];
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function open(options: Partial<PreferencesStoreOptions> = {}) {
  return createPreferencesStore({
    filePath,
    onWarning: (message, error) => warnings.push([message, error]),
    ...options,
  });
}

const readFile = () => JSON.parse(readFileSync(filePath, 'utf8')) as unknown;

describe('createPreferencesStore', () => {
  it('starts empty without a file and creates none until something changes', () => {
    const store = open();
    expect(store.entries()).toEqual({});
    store.flush();
    expect(existsSync(filePath)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('writes a versioned, sorted JSON file and reads it back', () => {
    const store = open();
    store.set('ui.b', '2');
    store.set('theme.config', '{"primary":"#7c5cff"}');
    store.set('ui.a', 'Grüße 🎛️');
    store.flush();
    expect(readFileSync(filePath, 'utf8')).toBe(
      [
        '{',
        '  "version": 1,',
        '  "entries": {',
        '    "theme.config": "{\\"primary\\":\\"#7c5cff\\"}",',
        '    "ui.a": "Grüße 🎛️",',
        '    "ui.b": "2"',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(open().entries()).toEqual({
      'theme.config': '{"primary":"#7c5cff"}',
      'ui.a': 'Grüße 🎛️',
      'ui.b': '2',
    });
  });

  it('returns copies of the entries', () => {
    const store = open();
    store.set('a', '1');
    const entries = store.entries();
    entries.a = 'mutated';
    expect(store.entries()).toEqual({ a: '1' });
  });

  it('debounces writes and coalesces bursts into one file write', () => {
    vi.useFakeTimers();
    const store = open({ debounceMs: 100 });
    store.set('layout.width', '1');
    vi.advanceTimersByTime(60);
    store.set('layout.width', '2');
    vi.advanceTimersByTime(60);
    expect(existsSync(filePath)).toBe(false);
    vi.advanceTimersByTime(40);
    expect(readFile()).toEqual({ version: 1, entries: { 'layout.width': '2' } });
  });

  it('flush() writes pending changes at once and cancels the timer', () => {
    vi.useFakeTimers();
    const store = open({ debounceMs: 10_000 });
    store.set('a', '1');
    store.flush();
    expect(readFile()).toEqual({ version: 1, entries: { a: '1' } });
    rmSync(filePath);
    vi.advanceTimersByTime(10_000);
    expect(existsSync(filePath)).toBe(false);
  });

  it('persists deletes and ignores unchanged writes', () => {
    const store = open();
    store.set('a', '1');
    store.set('b', '2');
    store.flush();
    store.delete('a');
    store.delete('missing');
    store.flush();
    expect(readFile()).toEqual({ version: 1, entries: { b: '2' } });
    rmSync(filePath);
    store.set('b', '2');
    store.delete('a');
    store.flush();
    expect(existsSync(filePath)).toBe(false);
  });

  it('leaves no temporary file behind', () => {
    const store = open();
    store.set('a', '1');
    store.flush();
    expect(readdirSync(dir)).toEqual(['preferences.json']);
  });

  it('creates the parent directory when needed', () => {
    filePath = join(dir, 'nested', 'deeper', 'preferences.json');
    const store = open();
    store.set('a', '1');
    store.flush();
    expect(readFile()).toEqual({ version: 1, entries: { a: '1' } });
  });

  it('rejects invalid keys and values without changing anything', () => {
    const store = open();
    store.set('a', '1');
    expect(() => store.set('bad key', '1')).toThrow(/invalid key/);
    expect(() => store.set('', '1')).toThrow(/invalid key/);
    expect(() => store.delete('../x')).toThrow(/invalid key/);
    expect(() => store.set('a', 'x'.repeat(MAX_PREFERENCE_VALUE_BYTES + 1))).toThrow(/64 KiB/);
    expect(() => store.set('a', 42 as unknown as string)).toThrow(/string/);
    expect(store.entries()).toEqual({ a: '1' });
  });

  it('enforces the 1 MiB total, counting replaced values only once', () => {
    const store = open();
    const big = 'x'.repeat(MAX_PREFERENCE_VALUE_BYTES - 16);
    let i = 0;
    for (; ; i++) {
      try {
        store.set(`k${i}`, big);
      } catch (error) {
        expect(String(error)).toMatch(/1 MiB/);
        break;
      }
    }
    const count = Object.keys(store.entries()).length;
    expect(count).toBe(i);
    expect(count * MAX_PREFERENCE_VALUE_BYTES).toBeLessThanOrEqual(MAX_PREFERENCES_TOTAL_BYTES);
    // Replacing an existing value with one of equal size still fits.
    store.set('k0', 'y'.repeat(big.length));
    // Freeing space makes room again.
    store.delete('k1');
    store.set(`k${i}`, big);
    expect(Object.keys(store.entries())).toHaveLength(count);
  });

  it('moves an unparseable file aside and starts empty', () => {
    writeFileSync(filePath, '{ not json');
    const store = open();
    expect(store.entries()).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(readFileSync(`${filePath}.corrupt`, 'utf8')).toBe('{ not json');
    store.set('a', '1');
    store.flush();
    expect(readFile()).toEqual({ version: 1, entries: { a: '1' } });
  });

  it.each([
    ['an array', '[]'],
    ['a newer version', JSON.stringify({ version: 2, entries: {} })],
    ['no entries object', JSON.stringify({ version: 1, entries: [] })],
    ['a bare map', JSON.stringify({ a: '1' })],
  ])('treats %s as unreadable', (_label, contents) => {
    writeFileSync(filePath, contents);
    expect(open().entries()).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(existsSync(`${filePath}.corrupt`)).toBe(true);
  });

  it('skips invalid entries and reports them once', () => {
    const huge = 'x'.repeat(MAX_PREFERENCE_VALUE_BYTES + 1);
    // Written by hand: an object literal cannot carry an own `__proto__` key.
    writeFileSync(
      filePath,
      `{"version":1,"entries":{"good":"ok","bad key":"1","number":42,"__proto__":"x",` +
        `"huge":"${huge}"}}`,
    );
    const entries = open().entries();
    expect(entries).toEqual({ good: 'ok' });
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toMatch(/skipped 4 invalid entries/);
  });

  it('keeps the change in memory and retries when the write fails', () => {
    const store = open();
    mkdirSync(filePath); // a directory where the file should be: the rename fails
    store.set('a', '1');
    store.flush();
    expect(warnings).toHaveLength(1);
    expect(store.entries()).toEqual({ a: '1' });
    expect(readdirSync(dir)).toEqual(['preferences.json']);
    rmSync(filePath, { recursive: true });
    store.flush();
    expect(readFile()).toEqual({ version: 1, entries: { a: '1' } });
  });
});

describe('serializePreferences', () => {
  it('is stable regardless of insertion order', () => {
    const a = serializePreferences(
      new Map([
        ['b', '2'],
        ['a', '1'],
      ]),
    );
    const b = serializePreferences(
      new Map([
        ['a', '1'],
        ['b', '2'],
      ]),
    );
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});
