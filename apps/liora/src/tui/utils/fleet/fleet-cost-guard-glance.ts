/**
 * Fleet Cost Guard runtime glance — TUI soft warn helpers (SSOT: swarm-cost-guard).
 */

import {
  evaluateFleetCostGuardSoft,
  fleetCostGuardSoftTipFromSwarmOutput,
  fleetCostGuardSoftTipFromUsage,
  formatFleetCostGuardSoftTip,
  loadFleetBudgetGlance,
  SWARM_COST_GUARD_SOFT_TIP,
} from '@superliora/sdk';

import {
  FLEET_BUDGET_USD_ENV,
  FLEET_COST_GUARD_TIP,
  FLEET_COST_GUARD_TIP_KO,
  formatFleetBudgetUsd,
  formatFleetCostGuardOpsLiveLine,
  OPS_FLEET_COST_GUARD_TIP,
} from '#/tui/utils/fleet/fleet-glance';

export {
  FLEET_BUDGET_USD_ENV,
  FLEET_COST_GUARD_TIP,
  FLEET_COST_GUARD_TIP_KO,
  OPS_FLEET_COST_GUARD_TIP,
};

export function resolveFleetCostGuardSoftWarn(input: {
  readonly output?: string;
  readonly sessionCostUsd?: number;
  readonly workerCount?: number;
  readonly env?: NodeJS.ProcessEnv;
}): string | undefined {
  if (input.output !== undefined) {
    const fromOutput = fleetCostGuardSoftTipFromSwarmOutput(input.output);
    if (fromOutput !== undefined) return fromOutput;
  }
  if (input.workerCount === undefined || input.workerCount < 1) return undefined;
  const glance = loadFleetBudgetGlance(input.env);
  if (input.sessionCostUsd !== undefined) {
    const check = evaluateFleetCostGuardSoft(glance, input.sessionCostUsd);
    return formatFleetCostGuardSoftTip({
      check,
      workerCount: input.workerCount,
      spentTrackingAvailable: true,
    });
  }
  return fleetCostGuardSoftTipFromUsage({
    env: input.env,
    workerCount: input.workerCount,
  });
}

export function fleetCostGuardSoftWarnLine(warn: string | undefined): string | undefined {
  if (warn === undefined) return undefined;
  if (warn.includes(SWARM_COST_GUARD_SOFT_TIP)) return warn;
  return `${SWARM_COST_GUARD_SOFT_TIP} ${warn}`;
}

/** Extract Cost Guard block from combined governance warn (AppState result scan). */
export function extractFleetCostGuardFromGovernanceWarn(
  warn: string | null | undefined,
): string | undefined {
  if (warn === undefined || warn === null || warn.trim().length === 0) return undefined;
  for (const line of warn.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.includes(SWARM_COST_GUARD_SOFT_TIP)) {
      return trimmed;
    }
  }
  return undefined;
}

/** Ops Fleet pane — live Cost Guard from governance scan or session spend SSOT. */
export function resolveFleetCostGuardOpsLine(input: {
  readonly governanceWarn?: string | null;
  readonly sessionCostUsd?: number;
  readonly env?: NodeJS.ProcessEnv;
}): string {
  const fromGovernance = extractFleetCostGuardFromGovernanceWarn(input.governanceWarn);
  if (fromGovernance !== undefined) {
    const detail = fromGovernance.replace(SWARM_COST_GUARD_SOFT_TIP, '').trim();
    return formatFleetCostGuardOpsLiveLine(detail.length > 0 ? detail : undefined);
  }

  const glance = loadFleetBudgetGlance(input.env);
  if (glance.budgetUsd !== null) {
    const check = evaluateFleetCostGuardSoft(glance, input.sessionCostUsd);
    if (check.spentUsd !== null) {
      const spent = formatFleetBudgetUsd(check.spentUsd);
      const cap = formatFleetBudgetUsd(check.budgetUsd!);
      if (check.overBudget) {
        const over = formatFleetBudgetUsd(check.spentUsd - check.budgetUsd!);
        return formatFleetCostGuardOpsLiveLine(`Spent ${spent} / ${cap} cap — over ${over}`);
      }
      if (check.nearBudget && check.remainingUsd !== null) {
        return formatFleetCostGuardOpsLiveLine(
          `Spent ${spent} / ${cap} · ${formatFleetBudgetUsd(check.remainingUsd)} left · near cap`,
        );
      }
      if (check.remainingUsd !== null) {
        return formatFleetCostGuardOpsLiveLine(
          `Spent ${spent} / ${cap} · ${formatFleetBudgetUsd(check.remainingUsd)} remaining`,
        );
      }
    }
    return formatFleetCostGuardOpsLiveLine(`Cap ${formatFleetBudgetUsd(check.budgetUsd!)} active`);
  }

  return formatFleetCostGuardOpsLiveLine(undefined);
}
