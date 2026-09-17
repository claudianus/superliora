/**
 * P1-4 — MergeJob trusts the ledger, not the conductor's self-report.
 *
 * `checks_green` / `has_conflict` / `paths` used to be plain tool arguments
 * the LLM filled in, and the trust rules believed them. Ground truth for the
 * same facts already lives on the job record (`resultContract`), so the claim
 * may now only make the verdict stricter.
 */

import { describe, expect, it } from 'vitest';

import {
  buildSubagentResultContract,
  type SubagentVerificationStatus,
} from '../../src/session/subagent/subagent-result-contract';
import {
  evaluateMergeTrust as evaluateMergeTrustMechanical,
  mergeTrustInputFromLedger,
} from '../../src/tools/builtin/job/job-merge-trust';

/**
 * H6-2: risk is an LLM judgment now. These fixtures pin the *mechanical*
 * verdict, so they hand in an explicit reviewed-small-change judgment instead
 * of letting a missing judgment hold (which is what production does).
 */
const REVIEWED_SMALL = {
  risky: false,
  sensitivePaths: [],
  wideChange: false,
  confidence: 0.9,
  rationale: 'fixture: reviewed small change',
} as const;

function evaluateMergeTrust(input: Parameters<typeof evaluateMergeTrustMechanical>[0]) {
  return evaluateMergeTrustMechanical({ riskAssessment: REVIEWED_SMALL, ...input });
}
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

type TrustJob = Pick<JobRecord, 'ownershipPaths' | 'resultContract' | 'resultSummary'>;

function jobWith(
  verification: SubagentVerificationStatus | undefined,
  filesChanged: readonly string[] = ['src/example.ts'],
): TrustJob {
  return {
    resultSummary: 'worker summary',
    ...(verification === undefined
      ? {}
      : {
          resultContract: buildSubagentResultContract({
            agentId: 'agent_1',
            profile: 'coder',
            summary: 'worker summary',
            filesChanged,
            verification,
          }),
        }),
  };
}

const ALL_PASSED: SubagentVerificationStatus = {
  tests: 'passed',
  typecheck: 'passed',
  lint: 'passed',
};

const smallApproval = { approve: true, diffLines: 10, summary: 'reviewed' } as const;

describe('mergeTrustInputFromLedger', () => {
  it('auto-approves only when the ledger recorded a full green', () => {
    const input = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED),
      claim: smallApproval,
    });
    expect(input.checksGreen).toBe(true);
    expect(evaluateMergeTrust(input).mode).toBe('auto');
  });

  it('refuses a green the ledger never recorded', () => {
    for (const job of [
      jobWith(undefined),
      jobWith({ tests: 'passed', typecheck: 'not_run', lint: 'passed' }),
      jobWith({ tests: 'failed', typecheck: 'passed', lint: 'passed' }),
    ]) {
      const verdict = evaluateMergeTrust(
        mergeTrustInputFromLedger({ job, claim: { ...smallApproval, checksGreen: true } }),
      );
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toMatch(/Checks not green/);
    }
  });

  it('lets the claim withdraw a green but not grant one', () => {
    const withdrawn = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED),
      claim: { ...smallApproval, checksGreen: false },
    });
    expect(withdrawn.checksGreen).toBe(false);
    expect(evaluateMergeTrust(withdrawn).ok).toBe(false);
  });

  it('lets the claim raise a conflict but not clear one', () => {
    const raised = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED),
      claim: { ...smallApproval, hasConflict: true },
    });
    expect(evaluateMergeTrust(raised).ok).toBe(false);
    const cleared = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED),
      claim: { ...smallApproval, hasConflict: false },
    });
    expect(cleared.hasConflict).toBe(false);
  });

  it('weighs the files the worker actually touched, not just the claimed paths', () => {
    const input = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED, ['src/safe.ts', '.env']),
      claim: { ...smallApproval, paths: ['src/safe.ts'] },
    });
    // The ledger path is what the judge is shown; a claim cannot hide it.
    expect(input.paths).toContain('.env');
    const verdict = evaluateMergeTrust({
      ...input,
      riskAssessment: {
        risky: true,
        sensitivePaths: ['.env'],
        wideChange: false,
        confidence: 0.9,
        rationale: 'writes credentials from the environment',
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Dangerous paths/);
  });

  it('holds a wide change however few lines the claim reports', () => {
    const many = Array.from({ length: 25 }, (_, i) => `src/file-${String(i)}.ts`);
    const input = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED, many),
      claim: { ...smallApproval, diffLines: 3 },
    });
    const verdict = evaluateMergeTrust({
      ...input,
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: true,
        confidence: 0.9,
        rationale: 'rewrites 25 files across unrelated modules',
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/too wide/);
  });

  it('still honors an explicit user confirmation', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: jobWith(undefined),
        claim: { ...smallApproval, forceUserConfirm: true },
      }),
    );
    expect(verdict.mode).toBe('user_approved');
  });

  it('never lets a missing risk judgment pass as auto', () => {
    const input = mergeTrustInputFromLedger({
      job: jobWith(ALL_PASSED),
      claim: smallApproval,
    });
    const bare = evaluateMergeTrustMechanical(input);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.reason).toMatch(/판정 불가/);
  });

  it('waives size/danger confirm holds under auto permission without bypassing green', () => {
    const dangerous = evaluateMergeTrust({
      ...mergeTrustInputFromLedger({
        job: jobWith(ALL_PASSED, ['src/safe.ts', '.env']),
        claim: { ...smallApproval, paths: ['src/safe.ts'] },
      }),
      riskAssessment: {
        risky: true,
        sensitivePaths: ['.env'],
        wideChange: false,
        confidence: 0.9,
        rationale: 'writes credentials from the environment',
      },
      waiveUserConfirmHolds: true,
    });
    expect(dangerous).toMatchObject({ ok: true, mode: 'auto' });
    expect(dangerous.reason).toMatch(/waived user-confirm/);

    const ungreen = evaluateMergeTrust({
      ...mergeTrustInputFromLedger({
        job: jobWith(undefined),
        claim: smallApproval,
      }),
      waiveUserConfirmHolds: true,
    });
    expect(ungreen.ok).toBe(false);
    expect(ungreen.reason).toMatch(/Checks not green/);
  });

  it('treats checks green when Maker≠Checker verify passed and nothing failed', () => {
    const now = new Date().toISOString();
    const unverified: SubagentVerificationStatus = {
      tests: 'not_run',
      typecheck: 'not_run',
      lint: 'not_run',
      visual: 'passed',
    };
    const implement: JobRecord = {
      id: 'job_impl',
      title: 'Delete-pass',
      kind: 'implement',
      status: 'done',
      priority: 0,
      createdAt: now,
      updatedAt: now,
      expertId: 'maker-1',
      surfaceKind: 'web',
      resultSummary: 'shipped',
      resultContract: buildSubagentResultContract({
        agentId: 'a1',
        profile: 'coder',
        summary: 'shipped',
        filesChanged: ['src/main.ts'],
        verification: unverified,
      }),
    };
    const verify: JobRecord = {
      id: 'job_ver',
      title: 'Verify',
      kind: 'verify',
      status: 'done',
      priority: 1,
      createdAt: now,
      updatedAt: now,
      parentJobId: implement.id,
      expertId: 'checker-1',
      verifyVerdict: 'passed',
      resultSummary: '{"verdict":"pass"}',
      resultContract: buildSubagentResultContract({
        agentId: 'a2',
        profile: 'coder',
        summary: 'ok',
        filesChanged: ['src/main.ts'],
        verification: unverified,
      }),
    };
    const input = mergeTrustInputFromLedger({
      job: implement,
      claim: smallApproval,
      jobs: [implement, verify],
    });
    expect(input.checksGreen).toBe(true);
    expect(input.reviewChainBlocked).toBe(false);
    expect(evaluateMergeTrust(input).ok).toBe(true);
  });
});
