import { describe, expect, it } from 'vitest';

import {
  classifyObjectiveProfile,
  jobLooksLikeUiSurface,
  pathsLookLikeUi,
  uiSpawnQualityFlags,
} from '../../src/premium-quality/ui-surface';

describe('premium-quality/ui-surface', () => {
  it('classifies UI keywords and empty objectives as visual', () => {
    expect(classifyObjectiveProfile('design-a-hero').premiumDensity).toBe('visual');
    expect(classifyObjectiveProfile('Polish the landing page hero').visualSurface).toBe(true);
    expect(classifyObjectiveProfile('').premiumDensity).toBe('visual');
  });

  it('classifies backend objectives as code', () => {
    expect(classifyObjectiveProfile('Fix the CLI parser and add unit tests').premiumDensity).toBe(
      'code',
    );
  });

  it('treats UI path globs as visual surfaces', () => {
    expect(pathsLookLikeUi(['apps/site/src/app/page.tsx'])).toBe(true);
    expect(pathsLookLikeUi(['packages/agent-core/src/loop/tool-call.ts'])).toBe(false);
    expect(pathsLookLikeUi(['src/styles/globals.css'])).toBe(true);
  });

  it('detects UI Conductor jobs from brief or paths', () => {
    expect(
      jobLooksLikeUiSurface({
        title: 'Landing refresh',
        prompt: 'Rebuild the hero with premium craft',
      }),
    ).toBe(true);
    expect(
      jobLooksLikeUiSurface({
        title: 'CLI fix',
        prompt: 'Fix argv parsing',
        ownershipPaths: ['packages/agent-core/src/cli.ts'],
      }),
    ).toBe(false);
    expect(
      jobLooksLikeUiSurface({
        title: 'Styles',
        ownershipPaths: ['apps/site/src/components/Hero.tsx'],
      }),
    ).toBe(true);
  });

  it('returns PQ + vision spawn flags only for UI-shaped prompts', () => {
    expect(
      uiSpawnQualityFlags({
        title: 'Landing',
        prompt: 'Rebuild the hero',
      }),
    ).toEqual({ forcePremiumQuality: true, preferVisionModel: true });
    expect(
      uiSpawnQualityFlags({
        title: 'CLI fix',
        prompt: 'Fix argv parsing',
        ownershipPaths: ['packages/agent-core/src/cli.ts'],
      }),
    ).toBeUndefined();
  });
});
