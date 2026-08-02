import { describe, expect, it } from 'vitest';

import {
  auditPendingMutations,
  auditRecentVerificationFailures,
  auditSensorBoundCompletion,
} from '../../src/agent/goal/goal-completion-guards';
import {
  createMutationVerificationLedger,
  recordFileMutation,
  clearPendingMutations,
} from '../../src/sensors/mutation-verification-sensor';
import {
  createVerificationSensorLedger,
  recordVerificationFailure,
  recordVerificationPass,
} from '../../src/sensors/verification-sensor-ledger';

describe('auditSensorBoundCompletion hard gate', () => {
  it('rejects when recent verification failures are sticky', () => {
    const ledger = createVerificationSensorLedger();
    const now = 1_000_000;
    recordVerificationFailure(ledger, {
      toolName: 'Bash',
      summary: 'pnpm test failed',
      atMs: now - 1_000,
    });
    const rejection = auditRecentVerificationFailures(ledger, now);
    expect(rejection).not.toBeNull();
    expect(rejection?.code).toBe('sensor_verification_failed');
    expect(rejection?.reasons[0]).toMatch(/sticky/i);
  });

  it('allows complete after green check clears failures', () => {
    const ledger = createVerificationSensorLedger();
    const now = 1_000_000;
    recordVerificationFailure(ledger, {
      toolName: 'Bash',
      summary: 'pnpm test failed',
      atMs: now - 1_000,
    });
    recordVerificationPass(ledger, now);
    expect(auditRecentVerificationFailures(ledger, now)).toBeNull();
  });

  it('rejects when mutations are pending without green check', () => {
    const ledger = createMutationVerificationLedger();
    const now = 2_000_000;
    recordFileMutation(ledger, 'Edit', now - 500);
    const rejection = auditPendingMutations(ledger, now);
    expect(rejection).not.toBeNull();
    expect(rejection?.code).toBe('sensor_mutation_unverified');
    expect(rejection?.nextActions[0]).toMatch(/RunProjectChecks/);
  });

  it('allows complete after clearPendingMutations (green check path)', () => {
    const ledger = createMutationVerificationLedger();
    const now = 2_000_000;
    recordFileMutation(ledger, 'Write', now - 500);
    clearPendingMutations(ledger, now);
    expect(auditPendingMutations(ledger, now)).toBeNull();
  });

  it('skips sensor hard gate for runtime/system actors', () => {
    const agent = {
      verificationSensorLedger: createVerificationSensorLedger(),
      mutationVerificationLedger: createMutationVerificationLedger(),
    } as never;
    recordVerificationFailure(agent.verificationSensorLedger, {
      toolName: 'RunProjectChecks',
      summary: 'failed',
      atMs: Date.now(),
    });
    recordFileMutation(agent.mutationVerificationLedger, 'Edit');
    expect(auditSensorBoundCompletion(agent, 'runtime')).toBeNull();
    expect(auditSensorBoundCompletion(agent, 'system')).toBeNull();
    const modelReject = auditSensorBoundCompletion(agent, 'model');
    expect(modelReject?.code).toBe('sensor_verification_failed');
  });
});
