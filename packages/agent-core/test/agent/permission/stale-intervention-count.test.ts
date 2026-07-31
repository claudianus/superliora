import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../../../src/agent';
import {
  PERMISSION_AUTO_EXPIRE_ENV,
  PermissionManager,
  STALE_INTERVENTION_AGE_MS,
} from '../../../src/agent/permission';

function makeManager(): PermissionManager {
  const agent = {
    records: { logRecord: vi.fn() },
    replayBuilder: { push: vi.fn() },
    telemetry: { track: vi.fn() },
    emitStatusUpdated: vi.fn(),
  } as unknown as Agent;
  return new PermissionManager(agent);
}

describe('PermissionManager.staleInterventionCount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T01:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env[PERMISSION_AUTO_EXPIRE_ENV];
  });

  it('counts queue entries at or beyond maxAgeMs', () => {
    const manager = makeManager();
    const fresh = manager.interventionQueue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    vi.advanceTimersByTime(60_000);
    manager.interventionQueue.enqueue({
      toolName: 'Write',
      rule: 'write(*)',
      risk: 'low',
    });

    vi.advanceTimersByTime(61_000);
    expect(manager.staleInterventionCount(120_000)).toBe(1);
    expect(manager.staleInterventionCount(120_000, fresh.enqueuedAtMs + 120_000)).toBe(1);
  });

  it('surfaces staleInterventions in data() using the SSOT threshold', () => {
    const manager = makeManager();
    manager.interventionQueue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });

    vi.advanceTimersByTime(STALE_INTERVENTION_AGE_MS);
    expect(manager.data()).toEqual({
      mode: 'manual',
      rules: [],
      pendingInterventions: 1,
      staleInterventions: 1,
      oldestInterventionAgeMs: STALE_INTERVENTION_AGE_MS,
    });
  });

  it('omits staleInterventions when the queue is fresh', () => {
    const manager = makeManager();
    manager.interventionQueue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    expect(manager.data()).toEqual({
      mode: 'manual',
      rules: [],
      pendingInterventions: 1,
      oldestInterventionAgeMs: 0,
    });
  });

  it('auto-expires orphaned entries when SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS is set', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '60000';
    const manager = makeManager();
    manager.interventionQueue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });

    vi.advanceTimersByTime(60_000);
    expect(manager.data()).toEqual({
      mode: 'manual',
      rules: [],
    });
    expect(manager.interventionQueue.pendingCount()).toBe(0);
  });

  it('does not auto-expire in-flight RPC queue entries', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '60000';
    const manager = makeManager();
    const queued = manager.interventionQueue.enqueue({
      toolName: 'Bash',
      rule: 'bash(*)',
      risk: 'high',
    });
    (manager as unknown as { inFlightInterventionIds: Set<string> }).inFlightInterventionIds.add(
      queued.id,
    );

    vi.advanceTimersByTime(60_000);
    expect(manager.data()).toEqual({
      mode: 'manual',
      rules: [],
      pendingInterventions: 1,
      oldestInterventionAgeMs: 60_000,
    });
    expect(manager.interventionQueue.pendingCount()).toBe(1);
  });

  it('ignores invalid SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS values', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '0';
    const manager = makeManager();
    manager.interventionQueue.enqueue({
      toolName: 'Read',
      rule: 'read(*)',
      risk: 'low',
    });

    vi.advanceTimersByTime(STALE_INTERVENTION_AGE_MS);
    expect(manager.data()).toEqual({
      mode: 'manual',
      rules: [],
      pendingInterventions: 1,
      staleInterventions: 1,
      oldestInterventionAgeMs: STALE_INTERVENTION_AGE_MS,
    });
  });
});
