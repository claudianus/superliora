import { describe, expect, it } from 'vitest';

import type { Agent } from '../../src/agent';
import { createFakeKaos } from '../tools/fixtures/fake-kaos';
import {
  runCompletionVerification,
  verificationFromCheckEvidence,
} from '../../src/session/subagent/subagent-verification-gate';
import {
  createVerificationSensorLedger,
  recordCheckKindVerdict,
} from '../../src/sensors/verification-sensor-ledger';
import { VERIFICATION_NOT_RUN } from '../../src/session/subagent/subagent-result-contract';

const signal = new AbortController().signal;

function childWithVerdicts(verdicts: Parameters<typeof verificationFromCheckEvidence>[0]): Agent {
  const ledger = createVerificationSensorLedger();
  if (verdicts !== undefined) {
    for (const [slot, verdict] of Object.entries(verdicts)) {
      if (verdict === undefined) continue;
      recordCheckKindVerdict(
        ledger,
        slot as 'tests' | 'typecheck' | 'lint',
        verdict as 'passed' | 'failed',
      );
    }
  }
  return {
    kaos: createFakeKaos(),
    config: { cwd: '/workspace' },
    verificationSensorLedger: ledger,
  } as unknown as Agent;
}

describe('verificationFromCheckEvidence', () => {
  it('returns undefined when the worker ran no check-like commands', () => {
    expect(verificationFromCheckEvidence(undefined, 'scoped')).toBeUndefined();
    expect(verificationFromCheckEvidence({}, 'ambiguous')).toBeUndefined();
  });

  it('scoped scriptless change set: missing kinds become not_applicable', () => {
    const status = verificationFromCheckEvidence({ tests: 'passed' }, 'scoped');
    expect(status).toEqual({
      tests: 'passed',
      typecheck: 'not_applicable',
      lint: 'not_applicable',
      visual: 'not_run',
    });
  });

  it('scoped red evidence hard-fails the tests slot', () => {
    const status = verificationFromCheckEvidence({ tests: 'failed' }, 'scoped');
    expect(status?.tests).toBe('failed');
  });

  it('ambiguous scope keeps unobserved slots not_run (partial evidence stays honest)', () => {
    expect(verificationFromCheckEvidence({ tests: 'passed' }, 'ambiguous')).toEqual({
      tests: 'passed',
      typecheck: 'not_run',
      lint: 'not_run',
      visual: 'not_run',
    });
    expect(verificationFromCheckEvidence({ tests: 'failed' }, 'ambiguous')?.tests).toBe('failed');
  });
});

describe('runCompletionVerification evidence backfill', () => {
  // Root-level files only → packageDir '.' → scriptless project path.
  const scriptlessFiles = ['src/kebab-case.mjs', 'test/kebab.test.mjs'];

  it('stamps passed from a worker green node --test run', async () => {
    const status = await runCompletionVerification(
      childWithVerdicts({ tests: 'passed' }),
      'coder',
      scriptlessFiles,
      signal,
    );
    expect(status.tests).toBe('passed');
    expect(status.typecheck).toBe('not_applicable');
    expect(status.lint).toBe('not_applicable');
  });

  it('stamps failed when the worker ends with a red test run', async () => {
    const status = await runCompletionVerification(
      childWithVerdicts({ tests: 'failed' }),
      'coder',
      scriptlessFiles,
      signal,
    );
    expect(status.tests).toBe('failed');
    expect(status.typecheck).toBe('not_applicable');
    expect(status.lint).toBe('not_applicable');
  });

  it('stays VERIFICATION_NOT_RUN when no check evidence exists', async () => {
    const status = await runCompletionVerification(
      childWithVerdicts(undefined),
      'coder',
      scriptlessFiles,
      signal,
    );
    expect(status).toEqual(VERIFICATION_NOT_RUN);
  });

  it('tolerates agents without a verification sensor ledger (host/mock shapes)', async () => {
    const bare = { kaos: createFakeKaos(), config: { cwd: '/workspace' } } as unknown as Agent;
    const status = await runCompletionVerification(bare, 'coder', scriptlessFiles, signal);
    expect(status).toEqual(VERIFICATION_NOT_RUN);
  });

  it('verify profile is exempt: a red repro run is the deliverable, not a failure', async () => {
    const status = await runCompletionVerification(
      childWithVerdicts({ tests: 'failed' }),
      'verify',
      scriptlessFiles,
      signal,
    );
    expect(status).toEqual(VERIFICATION_NOT_RUN);
  });

  it('plan profile is exempt: analysis workers do not ship changes', async () => {
    const status = await runCompletionVerification(
      childWithVerdicts({ tests: 'failed' }),
      'plan',
      scriptlessFiles,
      signal,
    );
    expect(status).toEqual(VERIFICATION_NOT_RUN);
  });
});
