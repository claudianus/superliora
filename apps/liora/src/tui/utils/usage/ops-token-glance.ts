/**
 * Compact token / cache / cost one-liner for the Usage settings glance.
 */

import { formatTokenCount } from '#/utils/usage/usage-format';

export interface OpsTokenUsageLike {
  readonly inputOther?: number;
  readonly output?: number;
  readonly inputCacheRead?: number;
  readonly inputCacheCreation?: number;
}

export interface OpsSessionUsageLike {
  readonly total?: OpsTokenUsageLike;
  readonly byModel?: Readonly<Record<string, OpsTokenUsageLike>>;
}

export interface OpsTokenGlanceInput {
  readonly usage?: OpsSessionUsageLike;
  readonly cacheHitRate?: number;
  /** Best-effort session cost when already tracked on app state. */
  readonly costUsd?: number;
  /** Runtime Fleet Cost Guard cap from SUPERLIORA_FLEET_BUDGET_USD (soft). */
  readonly budgetUsd?: number;
}

function usageInputTotal(row: OpsTokenUsageLike): number {
  return (
    (row.inputOther ?? 0) + (row.inputCacheRead ?? 0) + (row.inputCacheCreation ?? 0)
  );
}

function aggregateUsage(
  usage: OpsSessionUsageLike | undefined,
): { readonly input: number; readonly output: number } | null {
  if (usage?.total !== undefined) {
    return {
      input: usageInputTotal(usage.total),
      output: usage.total.output ?? 0,
    };
  }
  const rows = usage?.byModel;
  if (rows === undefined || Object.keys(rows).length === 0) return null;
  let input = 0;
  let output = 0;
  for (const row of Object.values(rows)) {
    input += usageInputTotal(row);
    output += row.output ?? 0;
  }
  return { input, output };
}

function formatOpsCostUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Compact one-liner for Ops Runtime Health pane. */
export function formatOpsTokenGlance(input: OpsTokenGlanceInput): string {
  const totals = aggregateUsage(input.usage);
  if (totals == null) {
    return 'Tokens: (no data yet)';
  }

  const parts = [
    `in ${formatTokenCount(totals.input)}`,
    `out ${formatTokenCount(totals.output)}`,
  ];

  if (input.cacheHitRate !== undefined && Number.isFinite(input.cacheHitRate)) {
    parts.push(`cache ${String(Math.round(input.cacheHitRate * 100))}%`);
  }

  let line = `Tokens: ${parts.join(' · ')}`;

  const budgetUsd =
    typeof input.budgetUsd === 'number' && Number.isFinite(input.budgetUsd) && input.budgetUsd > 0
      ? input.budgetUsd
      : null;

  if (typeof input.costUsd === 'number' && Number.isFinite(input.costUsd) && input.costUsd > 0) {
    line += ` · ${formatOpsCostUsd(input.costUsd)}`;
    if (budgetUsd !== null) {
      const remaining = budgetUsd - input.costUsd;
      if (remaining <= 0) {
        line += ` · budget ${formatOpsCostUsd(budgetUsd)} · over ${formatOpsCostUsd(-remaining)}`;
      } else {
        line += ` · budget ${formatOpsCostUsd(budgetUsd)} · ${formatOpsCostUsd(remaining)} left`;
      }
    }
  } else if (budgetUsd !== null) {
    line += ` · budget ${formatOpsCostUsd(budgetUsd)}`;
  }

  return line;
}
