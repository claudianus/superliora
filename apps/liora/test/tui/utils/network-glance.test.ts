import { describe, expect, it } from 'vitest';

import {
  buildNetworkSettingsLines,
  loadNetworkGlance,
} from '#/tui/utils/network/network-glance';

describe('network-glance', () => {
  it('reads HTTP_PROXY, HTTPS_PROXY, and NO_PROXY from process env', () => {
    const glance = loadNetworkGlance({
      HTTP_PROXY: 'http://proxy.example.test:8080',
      HTTPS_PROXY: 'http://secure.example.test:8443',
      NO_PROXY: 'localhost,127.0.0.1',
    } as NodeJS.ProcessEnv);

    expect(glance.httpProxy).toBe('http://proxy.example.test:8080');
    expect(glance.httpsProxy).toBe('http://secure.example.test:8443');
    expect(glance.noProxy).toBe('localhost,127.0.0.1');
    expect(glance.proxyActive).toBe(true);

    const lines = buildNetworkSettingsLines(glance).join('\n');
    expect(lines).toContain('Process env (live)');
    expect(lines).toContain('HTTP_PROXY=http://proxy.example.test:8080');
    expect(lines).toContain('HTTPS_PROXY=http://secure.example.test:8443');
    expect(lines).toContain('NO_PROXY=localhost,127.0.0.1');
    expect(lines).toContain('ACTIVE');
  });

  it('accepts lowercase env var names', () => {
    const glance = loadNetworkGlance({
      http_proxy: 'http://lower.example.test:3128',
      no_proxy: '*.internal',
    } as NodeJS.ProcessEnv);

    expect(glance.httpProxy).toBe('http://lower.example.test:3128');
    expect(glance.noProxy).toBe('*.internal');
  });

  it('reports direct posture when no proxy env is set', () => {
    const glance = loadNetworkGlance({} as NodeJS.ProcessEnv);
    const lines = buildNetworkSettingsLines(glance).join('\n');

    expect(glance.proxyActive).toBe(false);
    expect(lines).toContain('not configured');
    expect(lines).toContain('HTTP_PROXY: unset');
    expect(lines).toContain('HTTPS_PROXY: unset');
    expect(lines).toContain('NO_PROXY: unset');
  });

  it('detects SOCKS via ALL_PROXY', () => {
    const glance = loadNetworkGlance({
      ALL_PROXY: 'socks5h://127.0.0.1:1080',
    } as NodeJS.ProcessEnv);

    expect(glance.socksConfigured).toBe(true);
    expect(glance.proxyActive).toBe(true);
    expect(buildNetworkSettingsLines(glance).join('\n')).toContain('SOCKS proxy detected');
  });
});
