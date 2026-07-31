import { describe, expect, it } from 'vitest';

import {
  extractFleetCostGuardFromGovernanceWarn,
  fleetCostGuardSoftWarnLine,
  resolveFleetCostGuardOpsLine,
  resolveFleetCostGuardSoftWarn,
} from '#/tui/utils/fleet/fleet-cost-guard-glance';
import {
  FLEET_BUDGET_USD_ENV,
  FLEET_COST_GUARD_TIP,
  OPS_FLEET_COST_GUARD_TIP,
} from '#/tui/utils/fleet/fleet-glance';
import { SWARM_COST_GUARD_SOFT_TIP } from '@superliora/sdk';

describe('fleet-cost-guard-glance', () => {
  it('parses Cost Guard tip from swarm output', () => {
    const tip = `${SWARM_COST_GUARD_SOFT_TIP} Cap $5.00 · 2 workers spawned — session spend tracking unavailable; watch Usage/footer $ glance.`;
    const warn = resolveFleetCostGuardSoftWarn({
      output: `<agent_swarm_result>\n</agent_swarm_result>\n\n${tip}`,
    });
    expect(warn).toBe(tip);
  });

  it('extracts Cost Guard from combined governance warn', () => {
    const tip = `${SWARM_COST_GUARD_SOFT_TIP} Spent $6.00 / $5.00 cap — over $1.00 · pause + summary (no kill).`;
    const combined = `Maker≠Checker (soft): same expert\n${tip}`;
    expect(extractFleetCostGuardFromGovernanceWarn(combined)).toBe(tip);
  });

  it('resolveFleetCostGuardOpsLine prefers governance scan over session spend', () => {
    const tip = `${SWARM_COST_GUARD_SOFT_TIP} Spent $6.00 / $5.00 cap — over $1.00 · pause + summary (no kill).`;
    const line = resolveFleetCostGuardOpsLine({
      governanceWarn: tip,
      sessionCostUsd: 1.25,
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
    });
    expect(line).toContain('Cost Guard:');
    expect(line).toContain('over $1.00');
  });

  it('resolveFleetCostGuardOpsLine surfaces session spend when env cap is set', () => {
    const line = resolveFleetCostGuardOpsLine({
      sessionCostUsd: 1.25,
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
    });
    expect(line).toBe('Cost Guard: Spent $1.25 / $5.00 · $3.75 remaining');
  });

  it('resolveFleetCostGuardOpsLine falls back to compact tip when unwired', () => {
    expect(resolveFleetCostGuardOpsLine({})).toBe(OPS_FLEET_COST_GUARD_TIP);
  });

  it('resolves budget-awareness tip when env is set and workers spawned', () => {
    const warn = resolveFleetCostGuardSoftWarn({
      workerCount: 2,
      env: { [FLEET_BUDGET_USD_ENV]: '5' },
    });
    expect(warn).toContain(SWARM_COST_GUARD_SOFT_TIP);
    expect(warn).toContain('2 workers spawned');
  });

  it('prefixes warn lines with the runtime soft tip', () => {
    expect(fleetCostGuardSoftWarnLine('Cap $5.00 active')).toContain(SWARM_COST_GUARD_SOFT_TIP);
    expect(FLEET_COST_GUARD_TIP).toContain('SUPERLIORA_FLEET_BUDGET_USD');
  });
});
