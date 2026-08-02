import { describe, expect, it } from 'vitest';

import {
  createMutationVerificationLedger,
  recordFileMutation,
  clearPendingMutations,
} from '../../src/sensors/mutation-verification-sensor';
import {
  evaluateStopSensor,
  formatStopSensorWireTip,
  STOP_SENSOR_ORIGIN_NAME,
  STOP_SENSOR_WARNING_CODE,
} from '../../src/sensors/stop-sensor';
import {
  createVerificationSensorLedger,
  recordVerificationFailure,
  recordVerificationPass,
} from '../../src/sensors/verification-sensor-ledger';

describe('evaluateStopSensor', () => {
  it('exports a stable origin name for transcript tagging', () => {
    expect(STOP_SENSOR_ORIGIN_NAME).toBe('stop_sensor');
  });

  it('returns null when ledgers are clean', () => {
    const body = evaluateStopSensor({
      verificationLedger: createVerificationSensorLedger(),
      mutationLedger: createMutationVerificationLedger(),
    });
    expect(body).toBeNull();
  });

  it('fires on sticky verification failures', () => {
    const verificationLedger = createVerificationSensorLedger();
    const now = 5_000_000;
    recordVerificationFailure(verificationLedger, {
      toolName: 'Bash',
      summary: 'pnpm test failed',
      atMs: now - 100,
    });
    const body = evaluateStopSensor({ verificationLedger, nowMs: now });
    expect(body).toContain('Stop sensor');
    expect(body).toMatch(/pnpm test failed|test\/command failure|RunProjectChecks/i);
  });

  it('fires on pending mutations without green check', () => {
    const mutationLedger = createMutationVerificationLedger();
    const now = 6_000_000;
    recordFileMutation(mutationLedger, 'Edit', now - 50);
    const body = evaluateStopSensor({ mutationLedger, nowMs: now });
    expect(body).toContain('Stop sensor');
    expect(body).toMatch(/mutated|RunProjectChecks/i);
  });

  it('returns null after green clear paths', () => {
    const verificationLedger = createVerificationSensorLedger();
    const mutationLedger = createMutationVerificationLedger();
    const now = 7_000_000;
    recordVerificationFailure(verificationLedger, {
      toolName: 'Bash',
      summary: 'fail',
      atMs: now - 100,
    });
    recordFileMutation(mutationLedger, 'Write', now - 50);
    recordVerificationPass(verificationLedger, now);
    clearPendingMutations(mutationLedger, now);
    expect(
      evaluateStopSensor({ verificationLedger, mutationLedger, nowMs: now }),
    ).toBeNull();
  });

  it('skips when skip=true (active Goal path)', () => {
    const mutationLedger = createMutationVerificationLedger();
    recordFileMutation(mutationLedger, 'Edit');
    expect(evaluateStopSensor({ mutationLedger, skip: true })).toBeNull();
  });

  // Loop20b: green auto-spawn already covered mutations — no double stop nudge.
  it('suppresses mutation-only stop when recentAutoCheckSpawnOk', () => {
    const mutationLedger = createMutationVerificationLedger();
    const now = 8_000_000;
    recordFileMutation(mutationLedger, 'Write', now - 50, 'packages/agent-core');
    expect(
      evaluateStopSensor({
        mutationLedger,
        nowMs: now,
        recentAutoCheckSpawnOk: true,
      }),
    ).toBeNull();
  });

  it('still fires on verification failures even when recentAutoCheckSpawnOk', () => {
    const verificationLedger = createVerificationSensorLedger();
    const now = 9_000_000;
    recordVerificationFailure(verificationLedger, {
      toolName: 'Bash',
      summary: 'typecheck failed',
      atMs: now - 100,
    });
    const body = evaluateStopSensor({
      verificationLedger,
      nowMs: now,
      recentAutoCheckSpawnOk: true,
    });
    expect(body).not.toBeNull();
    expect(body).toContain('Stop sensor');
    expect(body).toMatch(/typecheck failed|test\/command failure/i);
  });

  // Loop34a: wire tip for TUI named notice.
  it('formatStopSensorWireTip prefixes STOP_SENSOR and keeps origin code', () => {
    expect(STOP_SENSOR_WARNING_CODE).toBe('stop-sensor');
    const tip = formatStopSensorWireTip(
      'Stop sensor: turn ended with unverified work still sticky.\nRun checks.',
    );
    expect(tip.startsWith('STOP_SENSOR:')).toBe(true);
    expect(tip).toContain('unverified work');
    expect(formatStopSensorWireTip('STOP_SENSOR: already')).toBe('STOP_SENSOR: already');
  });
});
