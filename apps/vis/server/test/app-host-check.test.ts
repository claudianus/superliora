import { describe, expect, it } from 'vitest';

import { createApp, isAllowedVisHost, parseVisAllowedHosts } from '../src/app';

describe('isAllowedVisHost', () => {
  it('allows loopback names, loopback IPs, and any IP literal', () => {
    expect(isAllowedVisHost('localhost:3001', '127.0.0.1')).toBe(true);
    expect(isAllowedVisHost('127.0.0.1:3001', '127.0.0.1')).toBe(true);
    expect(isAllowedVisHost('[::1]:3001', '127.0.0.1')).toBe(true);
    expect(isAllowedVisHost('192.168.1.10:3001', '127.0.0.1')).toBe(true);
  });

  it('allows the bound host and explicit extras (with dot-suffix matching)', () => {
    expect(isAllowedVisHost('myhost.example:3001', 'myhost.example')).toBe(true);
    expect(isAllowedVisHost('dev.example.com:3001', '127.0.0.1', ['.example.com'])).toBe(true);
  });

  it('rejects rebinding-style hostnames and missing Host', () => {
    expect(isAllowedVisHost('evil.example:3001', '127.0.0.1')).toBe(false);
    expect(isAllowedVisHost(undefined, '127.0.0.1')).toBe(false);
    expect(isAllowedVisHost('', '127.0.0.1')).toBe(false);
  });

  it('parses VIS_ALLOWED_HOSTS', () => {
    expect(parseVisAllowedHosts({ VIS_ALLOWED_HOSTS: ' a.com, .b.com ' })).toEqual([
      'a.com',
      '.b.com',
    ]);
    expect(parseVisAllowedHosts({})).toEqual([]);
  });
});

describe('createApp host check middleware', () => {
  it('rejects a foreign Host with 403 before touching routes', async () => {
    const app = await createApp({ boundHost: '127.0.0.1' });
    const bad = await app.request('/api/sessions', {
      headers: { host: 'evil.example:3001' },
    });
    expect(bad.status).toBe(403);

    const good = await app.request('/api/sessions', {
      headers: { host: '127.0.0.1:3001' },
    });
    expect(good.status).not.toBe(403);
  });
});
