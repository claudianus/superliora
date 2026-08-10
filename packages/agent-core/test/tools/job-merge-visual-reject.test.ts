import { describe, expect, it } from 'vitest';

import { buildSubagentResultContract } from '../../src/session/subagent/subagent-result-contract';
import {
  evaluateMergeTrust,
  mergeTrustInputFromLedger,
} from '../../src/tools/builtin/job/job-merge-trust';
import type { JobRecord, JobSurfaceKind } from '../../src/tools/builtin/job/job-store-key';

type TrustJob = Pick<
  JobRecord,
  'kind' | 'surfaceKind' | 'ownershipPaths' | 'resultContract' | 'resultSummary'
>;

function surfaceJob(
  surfaceKind: JobSurfaceKind,
  visual: 'passed' | 'failed' | 'not_run' | 'not_applicable',
  filesChanged: readonly string[],
): TrustJob {
  return {
    kind: 'implement',
    surfaceKind,
    resultSummary: 'landing polish',
    resultContract: buildSubagentResultContract({
      agentId: 'agent_ui',
      profile: 'coder',
      summary: 'landing polish',
      filesChanged,
      verification: {
        tests: 'passed',
        typecheck: 'passed',
        lint: 'passed',
        visual,
        ...(surfaceKind === 'web' || surfaceKind === 'mixed'
          ? {
              interaction: visual === 'passed' ? ('passed' as const) : ('not_run' as const),
              craft: visual === 'passed' ? ('passed' as const) : ('not_run' as const),
            }
          : {
              interaction: 'not_applicable' as const,
              craft: 'not_applicable' as const,
            }),
      },
    }),
  };
}

const approval = { approve: true, diffLines: 12, summary: 'reviewed' } as const;

describe('MergeJob visual hard reject (surfaceKind contract)', () => {
  it('rejects web surface merges without visual=passed', () => {
    for (const visual of ['not_run', 'failed', 'not_applicable'] as const) {
      const verdict = evaluateMergeTrust(
        mergeTrustInputFromLedger({
          job: surfaceJob('web', visual, ['apps/site/src/app/page.tsx']),
          claim: approval,
        }),
      );
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.mode).toBe('reject');
        expect(verdict.reason).toMatch(/VerifySurface|Web surface/);
      }
    }
  });

  it('does not let force_user_confirm bypass missing visual proof', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: surfaceJob('web', 'not_run', ['apps/site/src/app/page.tsx']),
        claim: { ...approval, forceUserConfirm: true },
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.mode).toBe('reject');
  });

  it('allows web surface merges when visual=passed', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: surfaceJob('web', 'passed', ['apps/site/src/app/page.tsx']),
        claim: approval,
      }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('allows tui surface with visual=passed even under /components/ paths', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: surfaceJob('tui', 'passed', ['apps/liora/src/tui/components/idle-stage.ts']),
        claim: approval,
      }),
    );
    expect(verdict.ok).toBe(true);
  });

  it('rejects tui surface without smoke visual=passed and names TUI proof', () => {
    const verdict = evaluateMergeTrust(
      mergeTrustInputFromLedger({
        job: surfaceJob('tui', 'not_run', ['apps/liora/src/tui/components/idle-stage.ts']),
        claim: approval,
      }),
    );
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.mode).toBe('reject');
      expect(verdict.reason).toMatch(/TUI|smoke:visual/);
      expect(verdict.reason).not.toMatch(/call VerifySurface on the real surface/);
    }
  });

  it('does not invent a visual gate from TUI /components/ paths without surfaceKind', () => {
    const job: TrustJob = {
      kind: 'implement',
      // surfaceKind missing → hold, not visual reject from path regex
      resultSummary: 'idle polish',
      resultContract: buildSubagentResultContract({
        agentId: 'agent_tui',
        profile: 'coder',
        summary: 'idle polish',
        filesChanged: ['apps/liora/src/tui/components/idle-stage.ts'],
        verification: {
          tests: 'passed',
          typecheck: 'passed',
          lint: 'passed',
          visual: 'not_applicable',
        },
      }),
    };
    const input = mergeTrustInputFromLedger({ job, claim: approval });
    expect(input.visualProofMissing).toBe(false);
    expect(input.surfaceKindMissing).toBe(true);
    const verdict = evaluateMergeTrust(input);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.mode).toBe('hold');
      expect(verdict.reason).toMatch(/surface_kind missing/);
    }
  });

  it('does not require visual for surfaceKind=none', () => {
    const job: TrustJob = {
      kind: 'implement',
      surfaceKind: 'none',
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
      kind: 'implement',
      surfaceKind: 'none',
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
});
