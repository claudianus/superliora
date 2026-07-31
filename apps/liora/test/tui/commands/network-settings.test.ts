import { describe, expect, it, vi } from 'vitest';

import { showNetworkSettings } from '#/tui/commands/config/network-settings';

function panelLines(host: { state: { transcriptContainer: { addChild: ReturnType<typeof vi.fn> } } }): string {
  const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
    buildLines: (n: number) => string[];
  };
  return panel.buildLines(1).join('\n');
}

describe('network settings', () => {
  it('reports HTTPS_PROXY when env is set', () => {
    const prior = process.env.HTTPS_PROXY;
    process.env.HTTPS_PROXY = 'http://proxy.example.test:8080';
    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as never;

    showNetworkSettings(host);

    const lines = panelLines(host);
    expect(lines).toContain('Network / Proxy (read-only)');
    expect(lines).toContain('HTTPS_PROXY=http://proxy.example.test:8080');
    expect(lines).toContain('ACTIVE');

    if (prior != null) process.env.HTTPS_PROXY = prior;
    else delete process.env.HTTPS_PROXY;
  });

  it('shows HTTP_PROXY and NO_PROXY on separate env lines', () => {
    const priorHttp = process.env.HTTP_PROXY;
    const priorNo = process.env.NO_PROXY;
    process.env.HTTP_PROXY = 'http://corp.example.test:8080';
    process.env.NO_PROXY = 'localhost,.internal';
    delete process.env.HTTPS_PROXY;

    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as never;

    showNetworkSettings(host);

    const lines = panelLines(host);
    expect(lines).toContain('Process env (live)');
    expect(lines).toContain('HTTP_PROXY=http://corp.example.test:8080');
    expect(lines).toContain('NO_PROXY=localhost,.internal');
    expect(lines).toContain('HTTPS_PROXY: unset');

    if (priorHttp != null) process.env.HTTP_PROXY = priorHttp;
    else delete process.env.HTTP_PROXY;
    if (priorNo != null) process.env.NO_PROXY = priorNo;
    else delete process.env.NO_PROXY;
  });

  it('re-reads process env on each buildLines call', () => {
    const prior = process.env.HTTPS_PROXY;
    delete process.env.HTTPS_PROXY;

    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as never;

    showNetworkSettings(host);
    const panel = host.state.transcriptContainer.addChild.mock.calls[0]?.[0] as {
      buildLines: (n: number) => string[];
    };

    expect(panel.buildLines(1).join('\n')).toContain('not configured');

    process.env.HTTPS_PROXY = 'http://live.example.test:9999';
    expect(panel.buildLines(1).join('\n')).toContain('HTTPS_PROXY=http://live.example.test:9999');

    if (prior != null) process.env.HTTPS_PROXY = prior;
    else delete process.env.HTTPS_PROXY;
  });

  it('reports direct connections when no proxy env is set', () => {
    const priorHttp = process.env.HTTP_PROXY;
    const priorHttps = process.env.HTTPS_PROXY;
    const priorAll = process.env.ALL_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.HTTPS_PROXY;
    delete process.env.ALL_PROXY;

    const host = {
      state: {
        transcriptContainer: { addChild: vi.fn() },
        renderer: { invalidateFrame: vi.fn() },
      },
    } as never;

    showNetworkSettings(host);
    expect(panelLines(host)).toContain('not configured');

    if (priorHttp != null) process.env.HTTP_PROXY = priorHttp;
    if (priorHttps != null) process.env.HTTPS_PROXY = priorHttps;
    if (priorAll != null) process.env.ALL_PROXY = priorAll;
  });
});
