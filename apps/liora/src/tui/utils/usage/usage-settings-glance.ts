/**
 * Usage settings glance — live token/$ from getStatus (SSOT §9.2).
 */

import type { SessionStatus } from '@superliora/sdk';

import { formatContextUsageLine } from '#/tui/utils/compaction/compaction-glance';
import { loadFleetBudgetGlance } from '#/tui/utils/fleet/fleet-glance';
import { formatOpsTokenGlance } from '#/tui/utils/usage/ops-token-glance';

export interface UsageSettingsGlance {
  readonly tokenLine: string;
  readonly contextLine?: string;
  readonly hasLiveSession: boolean;
  readonly sessionError?: string;
}

export function loadUsageSettingsGlance(input: {
  readonly status?: Pick<
    SessionStatus,
    'usage' | 'cacheHitRate' | 'contextUsage' | 'contextTokens' | 'maxContextTokens'
  >;
  readonly sessionCostUsd?: number;
  readonly contextUsage?: number;
  readonly contextTokens?: number;
  readonly maxContextTokens?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly sessionError?: string;
}): UsageSettingsGlance {
  const budget = loadFleetBudgetGlance(input.env);
  const budgetUsd =
    budget.budgetUsd !== null && budget.budgetUsd > 0 ? budget.budgetUsd : undefined;

  const usage = input.status?.usage;
  const cacheHitRate = input.status?.cacheHitRate;
  const tokenLine = formatOpsTokenGlance({
    usage,
    cacheHitRate,
    costUsd: input.sessionCostUsd,
    budgetUsd,
  });

  const contextUsage = input.status?.contextUsage ?? input.contextUsage;
  const contextTokens = input.status?.contextTokens ?? input.contextTokens;
  const maxContextTokens = input.status?.maxContextTokens ?? input.maxContextTokens;
  const contextLine = formatContextUsageLine({
    contextUsage,
    contextTokens,
    maxContextTokens,
  });

  return {
    tokenLine,
    contextLine,
    hasLiveSession: input.status !== undefined,
    sessionError: input.sessionError,
  };
}

export function buildUsageSettingsLines(glance: UsageSettingsGlance): readonly string[] {
  const sessionLines =
    glance.sessionError !== undefined
      ? [`Session: (unavailable — ${glance.sessionError})`, glance.tokenLine]
      : glance.hasLiveSession
        ? [`Session: live getStatus`, glance.tokenLine]
        : [`Session: (no active session)`, glance.tokenLine];

  return [
    '── Usage (read-only) ────────────────────────',
    'Token spend and context window — Sovereign Reform §9.2.',
    '',
    '── Session (live) ───────────────────────────',
    ...sessionLines,
    ...(glance.contextLine !== undefined ? [glance.contextLine] : []),
    '',
    '── Full report ──────────────────────────────',
    '  /usage                        bars, plan quotas, composition',
    '  /status                       model + route + context snapshot',
    '  Settings → Fleet              SUPERLIORA_FLEET_BUDGET_USD cap',
    '',
    '── Tips ─────────────────────────────────────',
    '· Token totals refresh from session.getStatus().usage',
    '· Session $ is best-effort when provider pricing is wired',
    '· Managed providers show plan quota bars in /usage',
    '· Footer badge mirrors contextUsage between refreshes',
    '',
    'No quota editor here — provider accounts via Settings → Accounts.',
  ];
}
