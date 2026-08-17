import { describe, expect, it, vi } from 'vitest';

import {
  failureAttemptsFor,
  hasFreshActiveInstall,
  hasLiveActiveInstall,
  logUpdateInfo,
  logUpdateWarn,
  rolloutTelemetryFor,
  trackUpdateEvent,
} from '#/cli/update/install-runtime';
import { emptyUpdateInstallState } from '#/cli/update/install-state';
import type { UpdateManifest } from '#/cli/update/types';

describe('install-runtime helpers', () => {
  it('counts failure attempts only for the matching target version', () => {
    const state = {
      ...emptyUpdateInstallState(),
      lastFailure: { version: '0.5.0', failedAt: '2026-01-01T00:00:00.000Z', attempts: 2 },
    };

    expect(failureAttemptsFor(state, { version: '0.5.0' })).toBe(2);
    expect(failureAttemptsFor(state, { version: '0.4.0' })).toBe(0);
  });

  it('treats active installs within the TTL as fresh when the pid is alive', () => {
    const state = {
      ...emptyUpdateInstallState(),
      active: {
        version: '0.5.0',
        source: 'npm-global' as const,
        startedAt: new Date().toISOString(),
        pid: process.pid,
      },
    };

    expect(hasFreshActiveInstall(state, { version: '0.5.0' })).toBe(true);
    expect(hasFreshActiveInstall(state, { version: '0.4.0' })).toBe(false);
    expect(hasLiveActiveInstall(state)).toBe(true);
  });

  it('ignores leftover active records without a live pid', () => {
    const noPid = {
      ...emptyUpdateInstallState(),
      active: {
        version: 'origin/main',
        source: 'native' as const,
        startedAt: new Date().toISOString(),
      },
    };
    const deadPid = {
      ...emptyUpdateInstallState(),
      active: {
        version: '0.5.0',
        source: 'npm-global' as const,
        startedAt: new Date().toISOString(),
        pid: 2_147_483_646,
      },
    };

    expect(hasFreshActiveInstall(noPid, { version: 'origin/main' })).toBe(false);
    expect(hasLiveActiveInstall(noPid)).toBe(false);
    expect(hasFreshActiveInstall(deadPid, { version: '0.5.0' })).toBe(false);
  });

  it('ignores stale active installs', () => {
    const state = {
      ...emptyUpdateInstallState(),
      active: {
        version: '0.5.0',
        source: 'npm-global' as const,
        startedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
        pid: process.pid,
      },
    };

    expect(hasFreshActiveInstall(state, { version: '0.5.0' })).toBe(false);
  });

  it('builds rollout telemetry from manifest bucket delays', () => {
    const manifest: UpdateManifest = {
      version: '0.5.0',
      publishedAt: '2026-01-01T00:00:00.000Z',
      rollout: [{ percent: 100, delaySeconds: 3600 }],
    };

    const telemetry = rolloutTelemetryFor('device-1', '0.5.0', manifest, false);

    expect(telemetry.rollout_from_manifest).toBe(true);
    expect(telemetry.rollout_bypassed).toBe(false);
    expect(telemetry.rollout_bucket).toBeGreaterThanOrEqual(0);
    expect(telemetry.rollout_bucket).toBeLessThan(100);
    expect(telemetry.rollout_delay_seconds).toBeGreaterThanOrEqual(0);
  });

  it('zeros rollout delay when manifest is missing or rollout is bypassed', () => {
    expect(rolloutTelemetryFor('device-1', '0.5.0', null, false).rollout_delay_seconds).toBe(0);
    expect(rolloutTelemetryFor('device-1', '0.5.0', null, true).rollout_bypassed).toBe(true);
  });

  it('swallows telemetry and logging failures', () => {
    const track = vi.fn(() => { throw new Error('telemetry down'); });
    const logger = {
      info: vi.fn(() => { throw new Error('log down'); }),
      warn: vi.fn(() => { throw new Error('log down'); }),
    };

    expect(() => {
      trackUpdateEvent(track, 'update_prompted', { version: '0.5.0' });
      logUpdateInfo(logger, 'hello', { ok: true });
      logUpdateWarn(logger, 'warn', { ok: false });
    }).not.toThrow();
  });
});
