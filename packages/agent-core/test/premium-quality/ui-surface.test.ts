import { describe, expect, it } from 'vitest';

import {
  classifyObjectiveProfile,
  jobLooksLikeUiSurface,
  uiSpawnQualityFlags,
} from '../../src/premium-quality/ui-surface';

describe('premium-quality/ui-surface', () => {
  it('uses declared surface_kind and empty-objective injection default', () => {
    expect(classifyObjectiveProfile(undefined, { surfaceKind: 'web' }).premiumDensity).toBe(
      'visual',
    );
    expect(classifyObjectiveProfile(undefined, { surfaceKind: 'none' }).visualSurface).toBe(false);
    // Empty → visual for PQ injection; MergeJob still requires Job.surfaceKind.
    expect(classifyObjectiveProfile('').premiumDensity).toBe('visual');
  });

  it('fails closed to code when the objective has no declared surface', () => {
    expect(classifyObjectiveProfile('Polish the landing page hero').premiumDensity).toBe('code');
    expect(classifyObjectiveProfile('Fix the CLI parser and add unit tests').premiumDensity).toBe(
      'code',
    );
    expect(classifyObjectiveProfile('design-a-hero').visualSurface).toBe(false);
  });

  it('does not invent a UI surface from title or path wording', () => {
    expect(
      jobLooksLikeUiSurface({
        surfaceKind: undefined,
      }),
    ).toBe(false);
    expect(
      jobLooksLikeUiSurface({
        surfaceKind: 'none',
      }),
    ).toBe(false);
    expect(
      jobLooksLikeUiSurface({
        surfaceKind: 'web',
      }),
    ).toBe(true);
  });

  it('returns PQ + vision spawn flags only for a declared or judged visual surface', () => {
    expect(uiSpawnQualityFlags({ surfaceKind: 'web' })).toEqual({
      forcePremiumQuality: true,
      preferVisionModel: true,
    });
    expect(
      uiSpawnQualityFlags({
        profile: { premiumDensity: 'visual', visualSurface: true },
      }),
    ).toEqual({ forcePremiumQuality: true, preferVisionModel: true });
    expect(uiSpawnQualityFlags({ surfaceKind: 'none' })).toBeUndefined();
    expect(uiSpawnQualityFlags({})).toBeUndefined();
  });
});
