import { describe, expect, it } from 'vitest';

import {
  ULTRA_PLAN_DRIFT_THRESHOLD,
  ULTRA_PLAN_DRIFT_THRESHOLD_AUTO,
  combinedDrift,
  isDriftAcceptable,
  type DriftMetrics,
} from '#/agent/plan/ultra-plan-mode';

const m = (over: Partial<DriftMetrics> = {}): DriftMetrics => ({
  goalDrift: 0,
  constraintDrift: 0,
  ontologyDrift: 0,
  ...over,
});

describe('ultra-plan-mode — combinedDrift', () => {
  it('returns 0 for all-zero metrics', () => {
    expect(combinedDrift(m())).toBe(0);
  });

  it('weights goal 0.5 / constraint 0.3 / ontology 0.2', () => {
    expect(combinedDrift(m({ goalDrift: 0.6, constraintDrift: 0.4, ontologyDrift: 0.2 }))).toBeCloseTo(
      0.6 * 0.5 + 0.4 * 0.3 + 0.2 * 0.2,
      6,
    );
  });

  it('passes through fully-aligned metrics (all 0)', () => {
    expect(combinedDrift(m({ goalDrift: 0, constraintDrift: 0, ontologyDrift: 0 }))).toBe(0);
  });

  it('returns 1 for fully-divergent metrics (all 1)', () => {
    expect(combinedDrift(m({ goalDrift: 1, constraintDrift: 1, ontologyDrift: 1 }))).toBe(1);
  });
});

describe('ultra-plan-mode — isDriftAcceptable', () => {
  it('accepts all-zero drift', () => {
    expect(isDriftAcceptable(m())).toBe(true);
  });

  it('accepts drift at or below the strict threshold', () => {
    expect(isDriftAcceptable(m({ goalDrift: ULTRA_PLAN_DRIFT_THRESHOLD }))).toBe(true);
  });

  it('rejects combined drift just over the strict threshold', () => {
    // Goal drift alone weighted at 0.5: 0.81 → 0.405 (just over 0.4).
    expect(isDriftAcceptable(m({ goalDrift: 0.81 }))).toBe(false);
  });

  it('uses the strict (manual) threshold, not the auto threshold', () => {
    expect(ULTRA_PLAN_DRIFT_THRESHOLD_AUTO).toBeGreaterThan(ULTRA_PLAN_DRIFT_THRESHOLD);
    // Combined drift in the band between the two thresholds is rejected
    // because the function uses the strict threshold.
    const between = (ULTRA_PLAN_DRIFT_THRESHOLD + ULTRA_PLAN_DRIFT_THRESHOLD_AUTO) / 2;
    expect(isDriftAcceptable(m({ goalDrift: between / 0.5 }))).toBe(false);
  });
});
