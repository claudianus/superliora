import { describe, expect, it, vi } from 'vitest';

import { TieredBrowserUseRuntime } from '../src/browser/tiered-browser-use';
import type { BrowserUseRuntime } from '../src/types';

function stubRuntime(
  label: string,
  status: Awaited<ReturnType<BrowserUseRuntime['status']>>,
): BrowserUseRuntime & { status: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn().mockResolvedValue(status),
    observe: vi.fn(),
    screenshot: vi.fn(),
    act: vi.fn(),
    console: vi.fn(),
    close: vi.fn(),
  } as unknown as BrowserUseRuntime & { status: ReturnType<typeof vi.fn> };
}

describe('TieredBrowserUseRuntime.status', () => {
  it('skips fallback status/install when primary is already ready', async () => {
    const primary = stubRuntime('primary', {
      platform: 'darwin',
      installed: true,
      ready: true,
      version: 'cloak 1',
      provider: 'cloakbrowser',
    });
    const fallback = stubRuntime('fallback', {
      platform: 'darwin',
      installed: false,
      ready: false,
      error: 'should not install',
      provider: 'camoufox',
    });
    const runtime = new TieredBrowserUseRuntime(primary, fallback, 'cloakbrowser', 'camoufox');

    const status = await runtime.status({ installIfMissing: true });

    expect(primary.status).toHaveBeenCalledTimes(1);
    expect(fallback.status).not.toHaveBeenCalled();
    expect(status).toMatchObject({
      ready: true,
      installed: true,
      provider: 'cloakbrowser',
      fallbackProvider: 'camoufox',
    });
  });

  it('probes fallback only when primary is not ready', async () => {
    const primary = stubRuntime('primary', {
      platform: 'darwin',
      installed: false,
      ready: false,
      error: 'missing',
      provider: 'cloakbrowser',
    });
    const fallback = stubRuntime('fallback', {
      platform: 'darwin',
      installed: true,
      ready: true,
      version: 'camoufox 1',
      provider: 'camoufox',
    });
    const runtime = new TieredBrowserUseRuntime(primary, fallback, 'cloakbrowser', 'camoufox');

    const status = await runtime.status({ installIfMissing: true });

    expect(fallback.status).toHaveBeenCalledWith({ installIfMissing: true }, undefined);
    expect(status.ready).toBe(true);
    expect(status.version).toMatch(/cloakbrowser=/);
    expect(status.version).toMatch(/camoufox=/);
  });
});
