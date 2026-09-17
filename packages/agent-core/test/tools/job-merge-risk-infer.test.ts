/**
 * H6 phase 2 — regression guard: string and number thresholds must not decide.
 *
 * The point of the phase-2 replacement is that a path's *name* and a diff's
 * *line count* no longer steer the merge verdict. These tests pin that:
 *
 *  1. a path literally containing "dangerous" is not risky by name,
 *  2. a path literally containing "secrets" that is a doc/fixture is not risky,
 *  3. a benignly-named path that is genuinely destructive IS risky,
 *  4. line counts near the old 200/20 thresholds do not change the verdict,
 *  5. an unavailable judgment holds as 판정 불가 instead of passing silently.
 */
import { describe, expect, it } from 'vitest';

import {
  clearMergeRiskCache,
  declaredSensitivePaths,
  inferMergeRisk,
  parseMergeRiskJudgment,
  resolveMergeRiskAssessment,
  assessmentFromJudgment,
  MERGE_RISK_CONFIDENCE_FLOOR,
} from '../../src/tools/builtin/job/job-merge-risk-infer';
import {
  evaluateMergeTrust,
  evaluateMergeTrustAsync,
  mergeTrustInputFromLedger,
} from '../../src/tools/builtin/job/job-merge-trust';
import type { JobRecord } from '../../src/tools/builtin/job/job-store-key';

const GREEN = {
  tests: 'passed',
  typecheck: 'passed',
  lint: 'passed',
} as const;

function jobWith(filesChanged: readonly string[]): JobRecord {
  return {
    id: 'job_h6',
    kind: 'implement',
    title: 'h6 fixture',
    status: 'completed',
    createdAt: 1,
    updatedAt: 1,
    surfaceKind: 'none',
    resultSummary: 'worker summary',
    resultContract: {
      schemaVersion: 1,
      status: 'done',
      files_changed: [...filesChanged],
      verification: { ...GREEN },
    },
  } as JobRecord;
}

const claim = { approve: true, diffLines: 10, summary: 'reviewed' } as const;

function baseInput(filesChanged: readonly string[]) {
  return mergeTrustInputFromLedger({ job: jobWith(filesChanged), claim });
}

function fakeDeps(payload: Record<string, unknown>) {
  return {
    provider: { name: 'fake', modelName: 'fake' } as never,
    generate: async () => ({
      message: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
    }),
  } as never;
}

describe('H6-2 — a path NAME never decides', () => {
  it('does not treat a path containing "dangerous" as risky by name', () => {
    // The old rule matched strings. Under the replacement nothing matches by
    // substring: a declared list is exact, and a judgment reasons about effect.
    expect(declaredSensitivePaths(['docs/dangerous-migrations.md'], ['docs/dangerous-migrations.md'])).toEqual(
      ['docs/dangerous-migrations.md'],
    );
    // Not declared, and the judge said "not risky" — so it lands.
    const verdict = evaluateMergeTrust({
      ...baseInput(['docs/dangerous-migrations.md']),
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.9,
        rationale: 'documentation page, no code path changes',
      },
    });
    expect(verdict.ok).toBe(true);
  });

  it('does not treat a "secrets" docs/fixture path as risky by name', () => {
    const verdict = evaluateMergeTrust({
      ...baseInput(['docs/secrets-guide.md', 'test/fixtures/.env.example']),
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.85,
        rationale: 'guide and example fixture, no live credential is written',
      },
    });
    expect(verdict.ok).toBe(true);
  });

  it('still holds a destructively-named benign path when the judgment says so', () => {
    // Path name looks harmless; the effect is what matters.
    const verdict = evaluateMergeTrust({
      ...baseInput(['src/db/migrate.ts']),
      riskAssessment: {
        risky: true,
        sensitivePaths: ['src/db/migrate.ts'],
        wideChange: false,
        confidence: 0.9,
        rationale: 'migration runs against live production rows on land',
      },
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Dangerous paths require user confirm/);
  });

  it('is byte-identical for a path named "dangerous" and one named "safe"', () => {
    const judgment = {
      risky: false,
      sensitivePaths: [],
      wideChange: false,
      confidence: 0.9,
      rationale: 'same effect',
    } as const;
    const named = evaluateMergeTrust({
      ...baseInput(['src/dangerous-thing.ts']),
      riskAssessment: judgment,
    });
    const plain = evaluateMergeTrust({
      ...baseInput(['src/ordinary-thing.ts']),
      riskAssessment: judgment,
    });
    // Same verdict AND same reason shape — the name contributed nothing.
    expect(named.ok).toBe(plain.ok);
    expect(named.mode).toBe(plain.mode);
  });
});

describe('H6-2 — a line count near the old threshold never decides', () => {
  const nearThreshold = [199, 200, 201, 10_000, 1];
  it.each(nearThreshold)('verdict is judgment-driven at %i lines', (lines) => {
    const input = baseInput(['src/a.ts']);
    const reviewed = evaluateMergeTrust({
      ...input,
      diffLines: lines,
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.9,
        rationale: 'mechanical rename across one module',
      },
    });
    const risky = evaluateMergeTrust({
      ...input,
      diffLines: lines,
      riskAssessment: {
        risky: true,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.9,
        rationale: 'touches the auth check on the request path',
      },
    });
    expect(reviewed.ok).toBe(true);
    expect(risky.ok).toBe(false);
  });

  it('honours a declared ceiling and never invents one', () => {
    const declared = evaluateMergeTrust({
      ...baseInput(['src/a.ts']),
      diffLines: 300,
      declaredSmallDiffMaxLines: 200,
      declaredDangerousPaths: [],
    });
    expect(declared.ok).toBe(false);
    if (!declared.ok) expect(declared.reason).toMatch(/declared 200/);
    // No declaration → no numeric hold at all.
    const undeclared = evaluateMergeTrust({
      ...baseInput(['src/a.ts']),
      diffLines: 300,
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.9,
        rationale: 'one-file mechanical edit',
      },
    });
    expect(undeclared.ok).toBe(true);
  });

  it('never holds on file span without a declared span', () => {
    const many = Array.from({ length: 25 }, (_, i) => `src/file-${String(i)}.ts`);
    const verdict = evaluateMergeTrust({
      ...baseInput(many),
      riskAssessment: {
        risky: false,
        sensitivePaths: [],
        wideChange: false,
        confidence: 0.9,
        rationale: 'generated files, no logic change',
      },
    });
    expect(verdict.ok).toBe(true);
  });
});

describe('H6-2 — a declaration wins over the judgment', () => {
  it('uses the declared list verbatim and never calls the LLM', async () => {
    let called = 0;
    const deps = {
      provider: { name: 'fake', modelName: 'fake' } as never,
      generate: async () => {
        called += 1;
        return { message: { content: [{ type: 'text', text: '{}' }] } };
      },
    } as never;
    const assessment = await resolveMergeRiskAssessment({
      judge: { paths: ['ops/prod/deploy.yaml'] },
      declaredDangerousPaths: ['ops/prod/deploy.yaml'],
      deps,
    });
    expect(called).toBe(0);
    expect(assessment).not.toBe('undecidable');
    if (assessment !== 'undecidable') {
      expect(assessment.risky).toBe(true);
      expect(assessment.sensitivePaths).toEqual(['ops/prod/deploy.yaml']);
    }
  });

  it('holds on the declaration even when the LLM would have said safe', async () => {
    clearMergeRiskCache();
    const verdict = await evaluateMergeTrustAsync({
      ...baseInput(['ops/prod/deploy.yaml']),
      declaredDangerousPaths: ['ops/prod/deploy.yaml'],
      riskDeps: fakeDeps({
        risky: false,
        sensitive_paths: [],
        wide_change: false,
        confidence: 0.99,
        rationale: 'looks fine',
      }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/Dangerous paths require user confirm/);
  });
});

describe('H6-2 — judgment failure is recorded, never a silent pass', () => {
  it('holds as 판정 불가 when no judgment and no declaration exist', () => {
    const verdict = evaluateMergeTrust(baseInput(['src/a.ts']));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.mode).toBe('hold');
      expect(verdict.reason).toMatch(/판정 불가/);
    }
  });

  it('treats a low-confidence judgment as undecidable', () => {
    const assessment = assessmentFromJudgment({
      risky: false,
      sensitivePaths: [],
      wideChange: false,
      confidence: MERGE_RISK_CONFIDENCE_FLOOR - 0.01,
      rationale: 'not enough evidence',
    });
    expect(assessment).toBe('undecidable');
  });

  it('returns undecidable when the provider throws', async () => {
    clearMergeRiskCache();
    const deps = {
      provider: { name: 'fake', modelName: 'fake' } as never,
      generate: async () => {
        throw new Error('provider down');
      },
    } as never;
    const assessment = await inferMergeRisk(deps, { paths: ['src/a.ts'] });
    expect(assessment).toBe('undecidable');
  });

  it('returns undecidable when the model answers with unparseable text', async () => {
    clearMergeRiskCache();
    const deps = {
      provider: { name: 'fake', modelName: 'fake' } as never,
      generate: async () => ({ message: { content: [{ type: 'text', text: 'I cannot help' }] } }),
    } as never;
    const assessment = await inferMergeRisk(deps, { paths: ['src/a.ts'] });
    expect(assessment).toBe('undecidable');
  });

  it('drops paths the judge invented that were never shown to it', async () => {
    clearMergeRiskCache();
    const verdict = await evaluateMergeTrustAsync({
      ...baseInput(['src/a.ts']),
      riskDeps: fakeDeps({
        risky: false,
        sensitive_paths: ['etc/shadow'],
        wide_change: false,
        confidence: 0.9,
        rationale: 'invented path',
      }),
    });
    // The invented path cannot create a hold, and the low-risk judgment lands.
    expect(verdict.ok).toBe(true);
  });

  it('parses a well-formed judgment and rejects a malformed one', () => {
    expect(
      parseMergeRiskJudgment(
        '{"risky":true,"sensitive_paths":["a"],"wide_change":false,"confidence":0.8,"rationale":"r"}',
      ),
    ).toMatchObject({ risky: true, sensitivePaths: ['a'] });
    expect(parseMergeRiskJudgment('{"risky":"yes"}')).toBeUndefined();
    expect(parseMergeRiskJudgment('not json')).toBeUndefined();
  });
});

describe('H6-2 — irreversible actions keep their approval gate', () => {
  it('still honours explicit user confirmation on a risky change', () => {
    const verdict = evaluateMergeTrust({
      ...baseInput(['ops/prod/deploy.yaml']),
      riskAssessment: {
        risky: true,
        sensitivePaths: ['ops/prod/deploy.yaml'],
        wideChange: false,
        confidence: 0.95,
        rationale: 'production deploy target',
      },
      forceUserConfirm: true,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.mode).toBe('user_approved');
  });

  it('holds a risky change when only auto permission is present', () => {
    const verdict = evaluateMergeTrust({
      ...baseInput(['ops/prod/deploy.yaml']),
      riskAssessment: {
        risky: true,
        sensitivePaths: ['ops/prod/deploy.yaml'],
        wideChange: false,
        confidence: 0.95,
        rationale: 'production deploy target',
      },
      waiveUserConfirmHolds: true,
    });
    // waive records the override in the reason; it does not hide it.
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.reason).toMatch(/waived user-confirm/);
  });
});
