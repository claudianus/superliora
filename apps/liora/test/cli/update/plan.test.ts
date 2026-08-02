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

  it('maps github update + dirty to auto-install with dirty flag for warning', async () => {
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
    // Explicit upgrade may force-reset; dirty is a warning, not a hard block.
    expect(plan.canAutoInstall).toBe(true);
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

  it('github-checkout: rebuilds when HEAD matches upstream but lastFailure is for that HEAD', async () => {
    const head = '4c1868027988f19775f6974038b684281e2306f6';
    const version = `origin/main@${head.slice(0, 12)}`;
    const plan = await resolveUpgradePlan('0.20.1', {
      detectInstallSource: async () => 'github-checkout',
      refreshUpdateCache: vi.fn(),
      refreshGitCheckoutUpdateTarget: async () => ({
        status: 'up-to-date',
        dirty: false,
        head,
        upstream: 'origin/main',
      }),
      readUpdateInstallState: async () => ({
        active: null,
        lastFailure: {
          version,
          failedAt: '2026-08-02T13:22:08.341Z',
          attempts: 2,
          notifiedAt: '2026-08-02T13:36:21.406Z',
        },
        lastSuccess: null,
      }),
      platform: 'darwin',
    });
    expect(plan.reason).toBe('update-available');
    expect(plan.target).toEqual({ version, upstream: 'origin/main' });
    expect(plan.canAutoInstall).toBe(true);
  });

  it('github-checkout: stays up-to-date when lastFailure is for a different version', async () => {
    const plan = await resolveUpgradePlan('0.20.1', {
      detectInstallSource: async () => 'github-checkout',
      refreshUpdateCache: vi.fn(),
      refreshGitCheckoutUpdateTarget: async () => ({
        status: 'up-to-date',
        dirty: false,
        head: '4c1868027988f19775f6974038b684281e2306f6',
        upstream: 'origin/main',
      }),
      readUpdateInstallState: async () => ({
        active: null,
        lastFailure: {
          version: 'origin/main@deadbeefcafe',
          failedAt: '2026-08-02T13:22:08.341Z',
          attempts: 2,
        },
        lastSuccess: null,
      }),
      platform: 'darwin',
    });
    expect(plan.reason).toBe('up-to-date');
    expect(plan.target).toBeNull();
  });
});
