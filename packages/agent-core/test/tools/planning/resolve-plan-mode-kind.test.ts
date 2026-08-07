import { describe, expect, it } from 'vitest';

import {
  resolvePlanModeKind,
  shouldSkipUltraResearchPhase,
} from '../../../src/tools/builtin/planning/resolve-plan-mode-kind';
import { isAllowedUltraPlanAdvance } from '../../../src/tools/builtin/planning/next-phase';

describe('resolvePlanModeKind', () => {
  it('honors explicit ultra flags', () => {
    expect(resolvePlanModeKind({ ultra: true }).kind).toBe('ultra');
    expect(resolvePlanModeKind({ ultra: false, initialContext: 'build me a game' }).kind).toBe(
      'regular',
    );
  });

  it('routes greenfield / vague asks to ultra', () => {
    expect(
      resolvePlanModeKind({ initialContext: 'Build me a Galaga clone from scratch' }).kind,
    ).toBe('ultra');
    expect(
      resolvePlanModeKind({
        initialContext: 'Not sure which approach — architecture for multi-file auth redesign',
      }).kind,
    ).toBe('ultra');
  });

  it('routes path-scoped fixes to regular', () => {
    expect(
      resolvePlanModeKind({
        initialContext: 'Fix the typo in apps/liora/src/tui/plan.ts only',
      }).kind,
    ).toBe('regular');
    expect(
      resolvePlanModeKind({
        initialContext: 'Add a unit test for resolvePlanModeKind in packages/agent-core',
      }).kind,
    ).toBe('regular');
  });

  it('defaults to regular when no initial context is given', () => {
    expect(resolvePlanModeKind({}).kind).toBe('regular');
    expect(resolvePlanModeKind({ initialContext: '   ' }).kind).toBe('regular');
  });
});

describe('shouldSkipUltraResearchPhase', () => {
  it('skips research for greenfield and rich context', () => {
    expect(shouldSkipUltraResearchPhase('build me a game from scratch')).toBe(true);
    expect(shouldSkipUltraResearchPhase('x'.repeat(400))).toBe(true);
    expect(shouldSkipUltraResearchPhase('fix one line')).toBe(false);
  });
});

describe('isAllowedUltraPlanAdvance', () => {
  it('allows interview→write and design→write fast paths', () => {
    expect(isAllowedUltraPlanAdvance('interview', 'write')).toBe(true);
    expect(isAllowedUltraPlanAdvance('design', 'write')).toBe(true);
    expect(isAllowedUltraPlanAdvance('interview', 'design')).toBe(true);
    expect(isAllowedUltraPlanAdvance('research', 'write')).toBe(false);
    expect(isAllowedUltraPlanAdvance('write', 'interview')).toBe(false);
  });
});
