import { describe, expect, it, vi } from 'vitest';
import { resolveUpgradePlan, SUPERLIORA_CHANGELOG_URL } from '#/cli/update/plan';

describe('resolveUpgradePlan', () => {
  it('force-refreshes CDN and returns update-available for npm-global', async () => {
    const refreshUpdateCache = vi.fn().mockResolvedValue({
      source: 'cdn',
      checkedAt: '2026-07-19T00:00:00.000Z',
      latest: '0.5.0',
      manifest: null,
    });
    const plan = await resolveUpgradePlan('0.4.0', {
      detectInstallSource: async () => 'npm-global',
      refreshUpdateCache,
      refreshGitCheckoutUpdateTarget: vi.fn(),
      readUpdateInstallState: async () => ({ active: null, lastFailure: null, lastSuccess: null }),
      platform: 'darwin',
    });
    expect(refreshUpdateCache).toHaveBeenCalledTimes(1);
    expect(plan.reason).toBe('update-available');
    expect(plan.target).toEqual({ version: '0.5.0' });
    expect(plan.canAutoInstall).toBe(true);
    expect(plan.changelogUrl).toBe(SUPERLIORA_CHANGELOG_URL);
  });

  it('maps github update + dirty to blocked auto-install', async () => {
    const plan = await resolveUpgradePlan('0.4.0', {
      detectInstallSource: async () => 'github-checkout',
      refreshUpdateCache: vi.fn(),
      refreshGitCheckoutUpdateTarget: async () => ({
        status: 'update',
        dirty: true,
        target: {
          repoRoot: '/tmp/superliora',
          upstream: 'origin/main',
          version: 'origin/main@abcdef123456',
        },
      }),
      readUpdateInstallState: async () => ({ active: null, lastFailure: null, lastSuccess: null }),
      platform: 'darwin',
    });
    expect(plan.reason).toBe('update-available');
    expect(plan.dirty).toBe(true);
    expect(plan.canAutoInstall).toBe(false);
    expect(plan.target?.version).toBe('origin/main@abcdef123456');
  });

  it('returns already-installing when install-state is active', async () => {
    const plan = await resolveUpgradePlan('0.4.0', {
      detectInstallSource: async () => 'npm-global',
      refreshUpdateCache: async () => ({
        source: 'cdn',
        checkedAt: '2026-07-19T00:00:00.000Z',
        latest: '0.5.0',
        manifest: null,
      }),
      refreshGitCheckoutUpdateTarget: vi.fn(),
      readUpdateInstallState: async () => ({
        active: { version: '0.5.0', source: 'npm-global', startedAt: new Date().toISOString() },
        lastFailure: null,
        lastSuccess: null,
      }),
      platform: 'darwin',
    });
    expect(plan.reason).toBe('already-installing');
  });
});
