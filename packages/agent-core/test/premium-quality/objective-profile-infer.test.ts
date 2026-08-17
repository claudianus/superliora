import { describe, expect, it } from 'vitest';

import {
  OBJECTIVE_PROFILE_CONFIDENCE_FLOOR,
  parseObjectiveSurfaceJudgment,
  profileFromSurfaceJudgment,
} from '../../src/premium-quality/objective-profile-infer';

describe('profileFromSurfaceJudgment', () => {
  it('uses visual when a confident user-visible surface or screenshot proof is present', () => {
    expect(
      profileFromSurfaceJudgment({
        userVisibleSurface: true,
        needsScreenshotProof: false,
        confidence: 0.9,
      }).premiumDensity,
    ).toBe('visual');
    expect(
      profileFromSurfaceJudgment({
        userVisibleSurface: false,
        needsScreenshotProof: true,
        confidence: 0.9,
      }).visualSurface,
    ).toBe(true);
  });

  it('fails closed to code below the confidence floor', () => {
    expect(
      profileFromSurfaceJudgment({
        userVisibleSurface: true,
        needsScreenshotProof: true,
        confidence: OBJECTIVE_PROFILE_CONFIDENCE_FLOOR - 0.01,
      }).premiumDensity,
    ).toBe('code');
  });
});

describe('parseObjectiveSurfaceJudgment', () => {
  it('maps a backend-only payload to code', () => {
    expect(
      parseObjectiveSurfaceJudgment(
        '{"user_visible_surface":false,"needs_screenshot_proof":false,"confidence":0.88,"rationale":"CLI exit code is the proof"}',
      )?.profile.premiumDensity,
    ).toBe('code');
  });

  it('maps a visible-surface payload to visual', () => {
    expect(
      parseObjectiveSurfaceJudgment(
        '{"user_visible_surface":true,"needs_screenshot_proof":true,"confidence":0.8,"rationale":"humans see the page"}',
      )?.profile.visualSurface,
    ).toBe(true);
  });
});
