import { describe, expect, it } from 'vitest';

import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import {
  evaluateMergeTrust,
  mergeTrustInputFromLedger,
} from '../../src/tools/builtin/job/job-merge-trust';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

type TrustJob = Pick<JobRecord, 'ownershipPaths' | 'resultContract' | 'resultSummary'>;

function uiJob(visual: 'passed' | 'failed' | 'not_run'): TrustJob {
  return {
    resultSummary: 'landing polish',
    resultContract: buildSubagentResultContract({
      agentId: 'agent_ui',
      profile: 'coder',
      summary: 'landing polish',
      filesChanged: ['apps/site/src/app/page.tsx'],
      verification: {
        tests: 'passed',
        typecheck: 'passed',
        lint: 'passed',
        visual,
      },
    }),
  };
}

const approval = { approve: true, diffLines: 12, summary: 'reviewed' } as const;

describe('MergeJob visual hard reject', () => {
  it('rejects UI-path merges without visual=passed', () => {
    for (const visual of ['not_run', 'failed'] as const) {
      const verdict = evaluateMergeTrust(
        mergeTrustInputFromLedger({ job: uiJob(visual), claim: approval }),
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.mode).toBe('reject');
        expect(verdict.reason).toMatch(/VerifySurface/);
      }
    }
  });

  it('does not let force_user_confirm bypass missing visual proof', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: uiJob('not_run'),
        claim: { ...approval, forceUserConfirm: true },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.mode).toBe('reject');
  });

  it('allows UI-path merges when visual=passed', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({ job: uiJob('passed'), claim: approval }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('does not require visual for non-UI paths', () => {
    const job: TrustJob = {
      resultSummary: 'cli fix',
      resultContract: buildSubagentResultContract({
        agentId: 'agent_cli',
        profile: 'coder',
        summary: 'cli fix',
        filesChanged: ['packages/agent-core/src/loop/tool-call.ts'],
        verification: {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_applicable',
        },
      }),
    };
    const verdict = evaluateMergeTrust(mergeTrustInputFromLedger({ job, claim: approval }));
    expect(verdict.ok).toBe(true);
  });

  it('does not invent a visual gate from UI-shaped ownership alone', () => {
    const job: TrustJob = {
      ownershipPaths: ['apps/site/src/components/Hero.tsx'],
      resultSummary: 'cli fix',
      resultContract: buildSubagentResultContract({
        agentId: 'agent_cli',
        profile: 'coder',
        summary: 'cli fix',
        filesChanged: ['packages/agent-core/src/loop/tool-call.ts'],
        verification: {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_run',
        },
      }),
    };
    const input = mergeTrustInputFromLedger({ job, claim: approval });
    expect(input.visualProofMissing).toBe(false);
    expect(evaluateMergeTrust(input).ok).toBe(true);
  });

  it('reject reason names VerifySurface only as visual proof', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({ job: uiJob('not_run'), claim: approval }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toMatch(/VerifySurface/);
      expect(verdict.reason).toMatch(/BrowserScreenshot alone does not/);
    }
  });
});
