/**
 * Ultra Plan drift thresholds and pure scoring helpers.
 */

import type { DriftMetrics } from './ultra-plan-types';

export type { DriftMetrics };

export const ULTRA_PLAN_DRIFT_THRESHOLD = 0.4;

/** Tolerant drift threshold for auto-generated Seed Specs (extracted from
 *  interview answers). Stricter than full exemption but more lenient than
 *  manually-written Seeds, since interview-derived Seeds have inherent
 *  wording variance. */
export const ULTRA_PLAN_DRIFT_THRESHOLD_AUTO = 0.6;

export function combinedDrift(metrics: DriftMetrics): number {
  return metrics.goalDrift * 0.5 + metrics.constraintDrift * 0.3 + metrics.ontologyDrift * 0.2;
}

export function isDriftAcceptable(metrics: DriftMetrics): boolean {
  return combinedDrift(metrics) <= ULTRA_PLAN_DRIFT_THRESHOLD;
}
