/**
 * Fleet Cost Guard soft runtime — session $ cap for the fleet tools.
 *
 * Emits non-blocking tips when SUPERLIORA_FLEET_BUDGET_USD is set.
 *
 * S3-R6 interim home (moved from swarm-cost-guard.ts). The AgentSwarm tool
 * consumer retired with S3-R5 (f04ac07c3); remaining consumers are the liora
 * TUI glances. Inventory verdict: REBUILD — folds into Job pool back-pressure
 * / cost visibility; body deletion is tracked by the R7 final sweep.
 */

import type { TokenUsage } from '@superliora/kosong';
import type { UsageStatus } from '#/rpc/events';
import type { Agent } from '../agent';

/** W4 soft: session $ cap env (AgentSwarm/UltraSwarm — opt-in). */
export const FLEET_BUDGET_USD_ENV = 'SUPERLIORA_FLEET_BUDGET_USD';

/** Runtime soft tip prefix — appended to swarm tool results (no kill). */
export const SWARM_COST_GUARD_SOFT_TIP =
  'Cost Guard (soft): SUPERLIORA_FLEET_BUDGET_USD caps session spend — soft-stop + summary before kill (not swarm-budget rounds).';

export interface FleetBudgetGlance {
  readonly budgetUsd: number | null;
  readonly envValue: string | undefined;
}

export interface FleetCostGuardSoftCheck {
  readonly active: boolean;
  readonly budgetUsd: number | null;
  readonly spentUsd: number | null;
  readonly remainingUsd: number | null;
  readonly overBudget: boolean;
  readonly nearBudget: boolean;
}

export interface SessionCostPricing {
  readonly input?: number;
  readonly output?: number;
  readonly cache_read?: number;
  readonly cache_write?: number;
}

const PER_MILLION = 1_000_000;

function parseFleetBudgetUsd(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export function loadFleetBudgetGlance(env: NodeJS.ProcessEnv = process.env): FleetBudgetGlance {
  const envValue = env[FLEET_BUDGET_USD_ENV]?.trim();
  return {
    budgetUsd: parseFleetBudgetUsd(envValue),
    envValue: envValue !== undefined && envValue.length > 0 ? envValue : undefined,
  };
}

export function estimateSessionCostUsd(
  total: TokenUsage | undefined,
  pricing: SessionCostPricing | undefined,
): number | undefined {
  if (total === undefined || pricing === undefined) return undefined;
  const input = pricing.input ?? 0;
  const output = pricing.output ?? 0;
  const cacheRead = pricing.cache_read ?? 0;
  const cacheWrite = pricing.cache_write ?? 0;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return undefined;
  }
  const usd =
    ((total.inputOther ?? 0) * input +
      (total.output ?? 0) * output +
      (total.inputCacheRead ?? 0) * cacheRead +
      (total.inputCacheCreation ?? 0) * cacheWrite) /
    PER_MILLION;
  return usd > 0 ? usd : undefined;
}

export function evaluateFleetCostGuardSoft(
  glance: FleetBudgetGlance,
  spentUsd: number | undefined,
): FleetCostGuardSoftCheck {
  const budgetUsd = glance.budgetUsd;
  const active = budgetUsd !== null;
  const spent =
    typeof spentUsd === 'number' && Number.isFinite(spentUsd) && spentUsd >= 0 ? spentUsd : null;
  if (!active || budgetUsd === null) {
    return {
      active: false,
      budgetUsd: null,
      spentUsd: spent,
      remainingUsd: null,
      overBudget: false,
      nearBudget: false,
    };
  }
  const remainingUsd = spent !== null ? budgetUsd - spent : budgetUsd;
  const overBudget = spent !== null && spent >= budgetUsd;
  const nearBudget = spent !== null && !overBudget && spent >= budgetUsd * 0.8;
  return {
    active: true,
    budgetUsd,
    spentUsd: spent,
    remainingUsd,
    overBudget,
    nearBudget,
  };
}

function formatFleetBudgetUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatFleetCostGuardSoftTip(input: {
  readonly check: FleetCostGuardSoftCheck;
  readonly workerCount: number;
  readonly spentTrackingAvailable: boolean;
}): string | undefined {
  const { check, workerCount, spentTrackingAvailable } = input;
  if (!check.active || check.budgetUsd === null || workerCount < 1) return undefined;

  if (spentTrackingAvailable && check.spentUsd !== null && check.overBudget) {
    const spent = formatFleetBudgetUsd(check.spentUsd);
    const cap = formatFleetBudgetUsd(check.budgetUsd);
    const over = formatFleetBudgetUsd(check.spentUsd - check.budgetUsd);
    return `${SWARM_COST_GUARD_SOFT_TIP} Spent ${spent} / ${cap} cap — over ${over} · pause + summary (no kill).`;
  }

  if (!spentTrackingAvailable) {
    const cap = formatFleetBudgetUsd(check.budgetUsd);
    const workers = workerCount === 1 ? '1 worker' : `${String(workerCount)} workers`;
    return `${SWARM_COST_GUARD_SOFT_TIP} Cap ${cap} · ${workers} spawned — session spend tracking unavailable; watch Usage/footer $ glance.`;
  }

  return undefined;
}

export function fleetCostGuardSoftTipFromUsage(input: {
  readonly env?: NodeJS.ProcessEnv;
  readonly usage?: UsageStatus;
  readonly pricing?: SessionCostPricing;
  readonly workerCount: number;
}): string | undefined {
  const glance = loadFleetBudgetGlance(input.env);
  const spentUsd = estimateSessionCostUsd(input.usage?.total, input.pricing);
  const check = evaluateFleetCostGuardSoft(glance, spentUsd);
  return formatFleetCostGuardSoftTip({
    check,
    workerCount: input.workerCount,
    spentTrackingAvailable: spentUsd !== undefined,
  });
}

export function fleetCostGuardSoftTipFromAgent(
  agent: Agent,
  workerCount: number,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const alias = agent.config.modelAlias;
  const pricing = alias !== undefined ? agent.kimiConfig?.models?.[alias]?.cost : undefined;
  return fleetCostGuardSoftTipFromUsage({
    env,
    usage: agent.usage.data(),
    pricing,
    workerCount,
  });
}

/** Best-effort parse of a Cost Guard tip block from swarm tool output. */
export function fleetCostGuardSoftTipFromSwarmOutput(output: string): string | undefined {
  if (!output.includes(SWARM_COST_GUARD_SOFT_TIP)) return undefined;
  const blocks = output.split('\n\n');
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]?.trim();
    if (block !== undefined && block.includes(SWARM_COST_GUARD_SOFT_TIP)) {
      return block;
    }
  }
  return undefined;
}
