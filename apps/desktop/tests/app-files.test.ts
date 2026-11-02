import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveAppFile } from '../src/main/app-files';

const root = resolve('/opt/studio/dist/renderer');

describe('resolveAppFile', () => {
  it('maps app URLs into the renderer directory', () => {
    expect(resolveAppFile(root, 'studio://app/index.html')).toBe(join(root, 'index.html'));
    expect(resolveAppFile(root, 'studio://app/')).toBe(join(root, 'index.html'));
    expect(resolveAppFile(root, 'studio://app/assets/main-abc.js?v=1#x')).toBe(
      join(root, 'assets', 'main-abc.js'),
    );
    expect(resolveAppFile(root, 'studio://app/assets/my%20file.css')).toBe(
      join(root, 'assets', 'my file.css'),
    );
  });

  it.each([
    'studio://app/..%2fmain%2fmain.js',
    'studio://app/assets/%2e%2e%2f%2e%2e%2fsecret',
    'studio://app/..%5cmain.js',
    'studio://app/a%00.js',
    'studio://app/%E0%A4%A',
    'studio://other/index.html',
    'file:///opt/studio/dist/renderer/index.html',
    'https://app/index.html',
    'not a url',
  ])('refuses %s', (url) => {
    expect(resolveAppFile(root, url)).toBeNull();
  });

  it('normalises dot segments that stay inside the root', () => {
    expect(resolveAppFile(root, 'studio://app/assets/../index.html')).toBe(
      join(root, 'index.html'),
    );
    // The URL parser treats %2e%2e as a dot segment and clamps it at the root.
    expect(resolveAppFile(root, 'studio://app/%2e%2e/main/main.js')).toBe(
      join(root, 'main', 'main.js'),
    );
  });
});

describe('contentTypeFor', () => {
  it('returns explicit types for renderer assets', () => {
    expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('/x/a.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('/x/a.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('/x/a.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/x/a.unknown')).toBe('application/octet-stream');
  });
});
