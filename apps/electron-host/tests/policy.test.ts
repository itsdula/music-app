import { describe, expect, it } from 'vitest';
import {
  assistantConnectSources,
  buildContentSecurityPolicy,
  isAllowedNavigation,
  isAppOrigin,
  isPermissionAllowed,
  originOf,
  securityHeaders,
} from '../src/main/policy';

const APP = 'studio://app';

describe('originOf / isAppOrigin', () => {
  it('computes origins for custom schemes (URL#origin would be "null")', () => {
    expect(originOf('studio://app/index.html?x=1#y')).toBe('studio://app');
    expect(originOf('studio://app')).toBe('studio://app');
    expect(originOf('https://example.com:8443/a')).toBe('https://example.com:8443');
  });

  it('returns null for unparsable or host-less input', () => {
    expect(originOf('not a url')).toBeNull();
    expect(originOf('file:///etc/passwd')).toBeNull();
    expect(originOf('')).toBeNull();
  });

  it('accepts only the app origin', () => {
    expect(isAppOrigin('studio://app/')).toBe(true);
    expect(isAppOrigin('studio://app/assets/x.js')).toBe(true);
    expect(isAppOrigin('studio://evil/')).toBe(false);
    expect(isAppOrigin('studio://app.evil/')).toBe(false);
    expect(isAppOrigin('https://app/')).toBe(false);
    expect(isAppOrigin('file:///index.html')).toBe(false);
    expect(isAppOrigin('null')).toBe(false);
    expect(isAppOrigin(undefined)).toBe(false);
    expect(isAppOrigin(null)).toBe(false);
  });
});

describe('isAllowedNavigation', () => {
  it('allows in-app URLs only', () => {
    expect(isAllowedNavigation('studio://app/index.html')).toBe(true);
    expect(isAllowedNavigation('https://example.com/')).toBe(false);
    expect(isAllowedNavigation('http://localhost:3000/')).toBe(false);
    expect(isAllowedNavigation('file:///tmp/x.html')).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)')).toBe(false);
    expect(isAllowedNavigation('data:text/html,hi')).toBe(false);
  });
});

describe('isPermissionAllowed', () => {
  it.each(['media', 'midi', 'clipboard-sanitized-write'])('allows %s for the app origin', (p) => {
    expect(isPermissionAllowed(p, APP)).toBe(true);
    expect(isPermissionAllowed(p, `${APP}/index.html`)).toBe(true);
  });

  it.each([
    'midiSysex',
    'geolocation',
    'notifications',
    'clipboard-read',
    'display-capture',
    'hid',
    'usb',
    'serial',
    'openExternal',
    'fullscreen',
    'pointerLock',
    'persistent-storage',
    'unknown',
  ])('denies %s even for the app origin', (p) => {
    expect(isPermissionAllowed(p, APP)).toBe(false);
  });

  it('never allows midiSysex', () => {
    expect(isPermissionAllowed('midiSysex', APP)).toBe(false);
    expect(isPermissionAllowed('midiSysex', 'https://example.com')).toBe(false);
  });

  it('denies everything for foreign or missing origins', () => {
    for (const origin of [
      'https://example.com',
      'studio://other',
      'file:///',
      '',
      null,
      undefined,
    ]) {
      expect(isPermissionAllowed('midi', origin)).toBe(false);
      expect(isPermissionAllowed('media', origin)).toBe(false);
    }
  });

  it('allows media for audio only', () => {
    expect(isPermissionAllowed('media', APP, ['audio'])).toBe(true);
    expect(isPermissionAllowed('media', APP, ['unknown'])).toBe(true);
    expect(isPermissionAllowed('media', APP, ['video'])).toBe(false);
    expect(isPermissionAllowed('media', APP, ['audio', 'video'])).toBe(false);
  });
});

describe('buildContentSecurityPolicy', () => {
  const directives = new Map(
    buildContentSecurityPolicy()
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...sources]) => [name, sources] as const),
  );

  it('allows scripts and workers only from self and Blob URLs', () => {
    expect(directives.get('script-src')).toEqual(["'self'", 'blob:']);
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
  });

  it('never allows eval or inline scripts', () => {
    const policy = buildContentSecurityPolicy();
    expect(policy).not.toContain('unsafe-eval');
    expect(directives.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('allows blob: and data: media', () => {
    expect(directives.get('media-src')).toEqual(expect.arrayContaining(['blob:', 'data:']));
  });

  it('locks down defaults, objects, frames, base and forms', () => {
    expect(directives.get('default-src')).toEqual(["'self'"]);
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('frame-src')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('adds extra connect-src sources only when asked', () => {
    expect(directives.get('connect-src')).toEqual(["'self'", 'blob:', 'data:']);
    const dev = buildContentSecurityPolicy({ extraConnectSrc: ['ws://localhost:5173'] });
    expect(dev).toContain("connect-src 'self' blob: data: ws://localhost:5173");
  });

  it('is attached to every app response with nosniff', () => {
    const headers = securityHeaders('text/html');
    expect(headers['Content-Security-Policy']).toBe(buildContentSecurityPolicy());
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Type']).toBe('text/html');
  });
});

describe('assistant endpoint in connect-src', () => {
  it('allows exactly the origin of an https assistant URL', () => {
    expect(assistantConnectSources('https://studio.example.com/api/assistant?x=1')).toEqual([
      'https://studio.example.com',
    ]);
    expect(assistantConnectSources('https://studio.example.com:8443/api/assistant')).toEqual([
      'https://studio.example.com:8443',
    ]);
  });

  it('allows plain http only for loopback development servers', () => {
    expect(assistantConnectSources('http://localhost:3000/api/assistant')).toEqual([
      'http://localhost:3000',
    ]);
    expect(assistantConnectSources('http://127.0.0.1:3000/api/assistant')).toEqual([
      'http://127.0.0.1:3000',
    ]);
    expect(assistantConnectSources('http://studio.example.com/api/assistant')).toEqual([]);
  });

  it('adds nothing when unset, invalid, non-http or carrying credentials', () => {
    for (const url of [
      undefined,
      null,
      '',
      'not a url',
      'ws://localhost:3000',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@studio.example.com/api/assistant',
    ]) {
      expect(assistantConnectSources(url)).toEqual([]);
    }
  });

  it('keeps every other directive locked when an assistant origin is configured', () => {
    const csp = buildContentSecurityPolicy({
      extraConnectSrc: assistantConnectSources('https://studio.example.com/api/assistant'),
    });
    const parsed = new Map(
      csp.split('; ').map((d) => {
        const [name, ...sources] = d.split(' ');
        return [name!, sources] as const;
      }),
    );
    expect(parsed.get('connect-src')).toEqual([
      "'self'",
      'blob:',
      'data:',
      'https://studio.example.com',
    ]);
    expect(csp.replace(' https://studio.example.com', '')).toBe(buildContentSecurityPolicy());
  });

  it('is attached to app responses when passed to securityHeaders', () => {
    const options = { extraConnectSrc: ['https://studio.example.com'] };
    expect(securityHeaders('text/html', options)['Content-Security-Policy']).toBe(
      buildContentSecurityPolicy(options),
    );
    expect(securityHeaders('text/html')['Content-Security-Policy']).not.toContain(
      'studio.example.com',
    );
  });
});
