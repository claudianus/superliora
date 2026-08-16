/**
 * Merge trust seams for mission / plan deliveries vs coding land.
 * Public seams: evaluateMergeTrust, mergeTrustInputFromLedger, surfaceRequiresVisualProof.
 */
import { describe, expect, it } from 'vitest';

import {
  evaluateMergeTrust,
  mergeTrustInputFromLedger,
} from '../../src/tools/builtin/job/job-merge-trust';
import { surfaceRequiresVisualProof } from '../../src/tools/builtin/job/job-surface';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

function baseJob(over: Partial<JobRecord> & Pick<JobRecord, 'id' | 'kind' | 'title'>): JobRecord {
  return {
    status: 'done',
    createdAt: 1,
    updatedAt: 1,
    resultSummary: 'plan approved via ExitPlanMode',
    ...over,
  };
}

describe('evaluateMergeTrust — mission never visual/verify', () => {
  it('does not require surfaceKind, visual proof, or verify chain for mission', () => {
    const job = baseJob({
      id: 'job_msvwt2dl41zjxn',
      kind: 'mission',
      title: 'Plan Desk: feature',
      resultContract: {
        schemaVersion: 1,
        status: 'done',
        verification: {
          tests: 'not_run',
          typecheck: 'not_run',
          lint: 'not_run',
          visual: 'failed',
        },
      },
    });
    const input = mergeTrustInputFromLedger({
      job,
      claim: {
        approve: true,
        summary: 'plan ready',
        checksGreen: true,
        hasConflict: false,
        paths: [],
        diffLines: 0,
      },
      jobs: [],
    });
    expect(input.surfaceKindMissing).toBe(false);
    expect(input.visualProofMissing).toBe(false);
    expect(input.reviewChainBlocked).toBe(false);
    const verdict = evaluateMergeTrust(input);
    expect(verdict.ok).toBe(true);
    expect(surfaceRequiresVisualProof(job.surfaceKind)).toBe(false);
  });

  it('coding implement without surfaceKind still holds (surfaceKindMissing)', () => {
    const job = baseJob({
      id: 'job_code',
      kind: 'implement',
      title: 'Ship UI',
      worktreePath: '/tmp/wt',
      resultContract: {
        schemaVersion: 1,
        status: 'done',
        verification: {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_run',
        },
      },
    });
    const input = mergeTrustInputFromLedger({
      job,
      claim: {
        approve: true,
        summary: 'done',
        checksGreen: true,
        hasConflict: false,
        paths: ['apps/site'],
        diffLines: 10,
      },
      jobs: [],
    });
    expect(input.surfaceKindMissing).toBe(true);
    const verdict = evaluateMergeTrust(input);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/surfaceKind|surface_kind/i);
  });
});

describe('surfaceRequiresVisualProof', () => {
  it('false for none and undefined; true for web/tui/mixed', () => {
    expect(surfaceRequiresVisualProof(undefined)).toBe(false);
    expect(surfaceRequiresVisualProof('none')).toBe(false);
    expect(surfaceRequiresVisualProof('web')).toBe(true);
    expect(surfaceRequiresVisualProof('tui')).toBe(true);
    expect(surfaceRequiresVisualProof('mixed')).toBe(true);
  });
});
