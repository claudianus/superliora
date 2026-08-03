import { describe, expect, it } from 'vitest';

import {
  evaluateFleetCostGuardSoft,
  estimateSessionCostUsd,
  FLEET_BUDGET_USD_ENV,
  fleetCostGuardSoftTipFromSwarmOutput,
  fleetCostGuardSoftTipFromUsage,
  formatFleetCostGuardSoftTip,
  loadFleetBudgetGlance,
  SWARM_COST_GUARD_SOFT_TIP,
} from '#/fleet';

describe('swarm-cost-guard.ts — env cap', () => {
  it('parses SUPERLIORA_FLEET_BUDGET_USD', () => {
    expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' }).budgetUsd).toBe(5);
    expect(loadFleetBudgetGlance({}).budgetUsd).toBeNull();
  });

  it('evaluates over-budget soft check', () => {
    const glance = loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' });
    const check = evaluateFleetCostGuardSoft(glance, 6);
    expect(check.overBudget).toBe(true);
    expect(check.nearBudget).toBe(false);
  });
});

describe('swarm-cost-guard.ts — spent estimate', () => {
  it('computes session cost from usage + pricing', () => {
    const spent = estimateSessionCostUsd(
      { inputOther: 1_000_000, output: 500_000, inputCacheRead: 0, inputCacheCreation: 0 },
      { input: 3, output: 15 },
    );
    expect(spent).toBeCloseTo(10.5, 5);
  });

  it('returns undefined when pricing is missing', () => {
    expect(
      estimateSessionCostUsd(
        { inputOther: 1000, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
        undefined,
      ),
    ).toBeUndefined();
  });
});

describe('swarm-cost-guard.ts — runtime soft tips', () => {
  it('appends over-cap tip when spent exceeds budget', () => {
    const tip = fleetCostGuardSoftTipFromUsage({
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
      usage: {
        total: { inputOther: 2_000_000, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      },
      pricing: { input: 3, output: 15 },
      workerCount: 4,
    });
    expect(tip).toContain(SWARM_COST_GUARD_SOFT_TIP);
    expect(tip).toContain('over $1.00');
    expect(tip).toMatch(/no kill/i);
  });

  it('does not tip when under cap with spend tracking', () => {
    const tip = fleetCostGuardSoftTipFromUsage({
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
      usage: {
        total: { inputOther: 100_000, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
      },
      pricing: { input: 3, output: 15 },
      workerCount: 2,
    });
    expect(tip).toBeUndefined();
  });

  it('appends budget-awareness tip when env is set, workers spawned, and spend unavailable', () => {
    const tip = fleetCostGuardSoftTipFromUsage({
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
      usage: undefined,
      pricing: undefined,
      workerCount: 3,
    });
    expect(tip).toContain(SWARM_COST_GUARD_SOFT_TIP);
    expect(tip).toContain('3 workers spawned');
    expect(tip).toContain('tracking unavailable');
  });

  it('skips when env cap is off or no workers spawned', () => {
    expect(
      fleetCostGuardSoftTipFromUsage({
        env: {},
        usage: undefined,
        workerCount: 2,
      }),
    ).toBeUndefined();
    expect(
      fleetCostGuardSoftTipFromUsage({
        env: { [FLEET_BUDGET_USD_ENV]: '5' },
        usage: undefined,
        workerCount: 0,
      }),
    ).toBeUndefined();
  });

  it('parses Cost Guard tip back out of swarm output', () => {
    const tip = formatFleetCostGuardSoftTip({
      check: evaluateFleetCostGuardSoft(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '5' }), 6),
      workerCount: 2,
      spentTrackingAvailable: true,
    });
    expect(tip).toBeDefined();
    const output = `<agent_swarm_result>\n<summary>done</summary>\n</agent_swarm_result>\n\n${tip}`;
    expect(fleetCostGuardSoftTipFromSwarmOutput(output)).toBe(tip);
  });
});

describe('swarm-cost-guard.ts — retro guard (S3-R7)', () => {
  it('rejects malformed or non-positive budget env values', () => {
    for (const bad of ['abc', '-3', '0', '', '   ']) {
      expect(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: bad }).budgetUsd).toBeNull();
    }
  });

  it('flags near-budget at the 80% threshold', () => {
    const glance = loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '10' });
    expect(evaluateFleetCostGuardSoft(glance, 8).nearBudget).toBe(true);
    expect(evaluateFleetCostGuardSoft(glance, 8).overBudget).toBe(false);
    expect(evaluateFleetCostGuardSoft(glance, 7.9).nearBudget).toBe(false);
  });

  it('stays silent under cap when spend tracking is available', () => {
    const tip = formatFleetCostGuardSoftTip({
      check: evaluateFleetCostGuardSoft(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '10' }), 2),
      workerCount: 2,
      spentTrackingAvailable: true,
    });
    expect(tip).toBeUndefined();
  });

  it('formats a singular worker count in the unavailable-tracking tip', () => {
    const tip = formatFleetCostGuardSoftTip({
      check: evaluateFleetCostGuardSoft(loadFleetBudgetGlance({ [FLEET_BUDGET_USD_ENV]: '10' }), undefined),
      workerCount: 1,
      spentTrackingAvailable: false,
    });
    expect(tip).toContain('1 worker spawned');
  });

  it('returns undefined cost for zero-token usage', () => {
    expect(
      estimateSessionCostUsd(
        { inputOther: 0, output: 0, inputCacheRead: 0, inputCacheCreation: 0 },
        { input: 3, output: 15 },
      ),
    ).toBeUndefined();
  });
});
