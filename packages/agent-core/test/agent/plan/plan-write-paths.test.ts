import { describe, expect, it } from 'vitest';

import {
  isPlanPhaseAllowedWrite,
  normalizePlanPath,
  pathsEqualForPlanWrite,
  planFileAllowDir,
} from '#/agent/plan/plan-write-paths';

describe('plan-write-paths', () => {
  const workDir = '/workspace/project';
  const planFile = '/home/user/.superliora/plans/hero-plan.md';
  const evidenceRoot = '.superliora/evidence/ultrawork-runs/run-1';

  it('equates relative and absolute plan paths against workDir', () => {
    expect(
      pathsEqualForPlanWrite(
        'docs/plan.md',
        '/workspace/project/docs/plan.md',
        workDir,
      ),
    ).toBe(true);
    expect(pathsEqualForPlanWrite(planFile, planFile, workDir)).toBe(true);
  });

  it('allows plan file and evidence-root workflow/research paths', () => {
    expect(
      isPlanPhaseAllowedWrite([planFile], {
        planFilePath: planFile,
        evidenceRoot,
        workDir,
      }),
    ).toBe(true);

    expect(
      isPlanPhaseAllowedWrite([`${evidenceRoot}/workflow-report.md`], {
        planFilePath: planFile,
        evidenceRoot,
        workDir,
      }),
    ).toBe(true);

    expect(
      isPlanPhaseAllowedWrite(
        [`${workDir}/${evidenceRoot}/research/notes.md`],
        {
          planFilePath: planFile,
          evidenceRoot,
          workDir,
        },
      ),
    ).toBe(true);
  });

  it('denies product-tree paths outside allow-list', () => {
    expect(
      isPlanPhaseAllowedWrite(['/workspace/project/src/main.ts'], {
        planFilePath: planFile,
        evidenceRoot,
        workDir,
      }),
    ).toBe(false);

    expect(
      isPlanPhaseAllowedWrite(
        [planFile, '/workspace/project/src/main.ts'],
        {
          planFilePath: planFile,
          evidenceRoot,
          workDir,
        },
      ),
    ).toBe(false);
  });

  it('returns plan file parent for sandbox allow dir', () => {
    expect(planFileAllowDir(planFile)).toBe('/home/user/.superliora/plans');
    expect(planFileAllowDir(null)).toBeUndefined();
  });

  it('normalizes empty path to empty string', () => {
    expect(normalizePlanPath('  ', workDir)).toBe('');
  });
});
