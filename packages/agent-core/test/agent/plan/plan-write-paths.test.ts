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

  it('allows the active plan file, in relative or absolute form', () => {
    expect(
      isPlanPhaseAllowedWrite([planFile], { planFilePath: planFile, workDir }),
    ).toBe(true);

    expect(
      isPlanPhaseAllowedWrite(['docs/plan.md'], {
        planFilePath: `${workDir}/docs/plan.md`,
        workDir,
      }),
    ).toBe(true);
  });

  it('denies every path that is not the plan file', () => {
    expect(
      isPlanPhaseAllowedWrite(['/workspace/project/src/main.ts'], {
        planFilePath: planFile,
        workDir,
      }),
    ).toBe(false);

    expect(
      isPlanPhaseAllowedWrite(
        [planFile, '/workspace/project/src/main.ts'],
        { planFilePath: planFile, workDir },
      ),
    ).toBe(false);

    expect(
      isPlanPhaseAllowedWrite(
        [`${workDir}/.superliora/evidence/run-1/research/notes.md`],
        { planFilePath: planFile, workDir },
      ),
    ).toBe(false);
  });

  it('denies an empty write set and a missing plan file', () => {
    expect(isPlanPhaseAllowedWrite([], { planFilePath: planFile, workDir })).toBe(false);
    expect(isPlanPhaseAllowedWrite([planFile], { planFilePath: null, workDir })).toBe(false);
  });

  it('returns plan file parent for sandbox allow dir', () => {
    expect(planFileAllowDir(planFile)).toBe('/home/user/.superliora/plans');
    expect(planFileAllowDir(null)).toBeUndefined();
  });

  it('normalizes empty path to empty string', () => {
    expect(normalizePlanPath('  ', workDir)).toBe('');
  });
});
