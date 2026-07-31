import { describe, expect, it, afterEach } from 'vitest';

import {
  formatInterventionAgeMs,
  formatInterventionAutoExpireCountdown,
  formatInterventionAutoExpireOpsHint,
  formatInterventionQueueOpsLine,
  formatInterventionQueueSettingsLine,
  INTERVENTION_NEVER_HALT_TIP,
  INTERVENTION_PARALLEL_TOOLS_NOTE,
  interventionAutoExpireRemainingMs,
  parsePermissionAutoExpireMs,
  PERMISSION_AUTO_EXPIRE_ENV,
} from '#/tui/utils/never-halt/intervention-glance';

describe('intervention-glance', () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });
  it('exports the Never-Halt queued tip', () => {
    expect(INTERVENTION_NEVER_HALT_TIP).toContain('Goal continues');
  });

  it('documents parallel tool fanout during permission wait', () => {
    expect(INTERVENTION_PARALLEL_TOOLS_NOTE).toContain('parallel');
  });

  it('formats compact intervention ages', () => {
    expect(formatInterventionAgeMs(45_000)).toBe('45s');
    expect(formatInterventionAgeMs(125_000)).toBe('2m 5s');
  });

  it('omits queue line when depth is zero', () => {
    expect(formatInterventionQueueOpsLine(0, 60_000)).toBeNull();
  });

  it('shows queue depth and oldest age', () => {
    const line = formatInterventionQueueOpsLine(3, 125_000);
    expect(line).toContain('Never-Halt queue: 3 pending');
    expect(line).toContain('oldest 2m 5s');
  });

  it('includes stale×N when stale entries exist', () => {
    const line = formatInterventionQueueOpsLine(2, 30_000, 1);
    expect(line).toContain('stale×1');
  });

  it('omits auto-expire hint when the queue is fresh', () => {
    expect(formatInterventionAutoExpireOpsHint(0)).toBeNull();
  });

  it('parses SUPERLIORA_PERMISSION_AUTO_EXPIRE_MS from env', () => {
    delete process.env[PERMISSION_AUTO_EXPIRE_ENV];
    expect(parsePermissionAutoExpireMs()).toBeUndefined();
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
    expect(parsePermissionAutoExpireMs()).toBe(120_000);
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '0';
    expect(parsePermissionAutoExpireMs()).toBeUndefined();
  });

  it('computes remaining auto-expire TTL from oldest queue age', () => {
    expect(interventionAutoExpireRemainingMs(90_000, 120_000)).toBe(30_000);
    expect(interventionAutoExpireRemainingMs(130_000, 120_000)).toBe(-10_000);
    expect(interventionAutoExpireRemainingMs(undefined, 120_000)).toBeUndefined();
  });

  it('formats orphan drop countdown for Never-Halt live', () => {
    expect(formatInterventionAutoExpireCountdown(90_000, 120_000)).toBe('orphan drop in 30s');
    expect(formatInterventionAutoExpireCountdown(130_000, 120_000)).toBe('orphan drop imminent');
    expect(formatInterventionAutoExpireCountdown(30_000, undefined)).toBeNull();
  });

  it('surfaces env fallback when stale entries exist but auto-expire is unset', () => {
    delete process.env[PERMISSION_AUTO_EXPIRE_ENV];
    const hint = formatInterventionAutoExpireOpsHint(2);
    expect(hint).toContain(PERMISSION_AUTO_EXPIRE_ENV);
    expect(hint).toContain('Never-Halt');
  });

  it('surfaces orphan drop countdown in Ops hint when auto-expire is configured', () => {
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
    const hint = formatInterventionAutoExpireOpsHint(2, 90_000);
    expect(hint).toBe('Orphans: orphan drop in 30s');
  });

  it('formats settings live queue line from getStatus fields', () => {
    expect(
      formatInterventionQueueSettingsLine({
        pendingInterventions: 2,
        oldestInterventionAgeMs: 30_000,
        staleInterventions: 1,
      }),
    ).toContain('Never-Halt queue: 2 pending');
    expect(
      formatInterventionQueueSettingsLine({
        pendingInterventions: 2,
        oldestInterventionAgeMs: 90_000,
        staleInterventions: 1,
      }),
    ).toContain('Never-Halt queue: 2 pending');
    process.env[PERMISSION_AUTO_EXPIRE_ENV] = '120000';
    expect(
      formatInterventionQueueSettingsLine({
        pendingInterventions: 2,
        oldestInterventionAgeMs: 90_000,
        staleInterventions: 1,
      }),
    ).toContain('orphan drop in 30s');
    expect(
      formatInterventionQueueSettingsLine({
        pendingInterventions: 0,
      }),
    ).toBe('Live queue: (clear) · Goal/Mission/Fleet continue');
    expect(
      formatInterventionQueueSettingsLine({
        sessionUnavailable: true,
      }),
    ).toBe('Live queue: (session unavailable)');
  });
});
