import { describe, expect, it } from 'vitest';

import {
  createMutationVerificationLedger,
  recordFileMutation,
  clearPendingMutations,
} from '../../src/sensors/mutation-verification-sensor';
import {
  evaluateStopSensor,
  STOP_SENSOR_ORIGIN_NAME,
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
});
