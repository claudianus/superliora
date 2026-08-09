import type {
  ProviderRouteCandidateStatus,
  ProviderRouteStatus,
} from '@superliora/sdk';

import { ttui } from '#/tui/utils/tui-i18n';

export interface StatusFieldRow {
  readonly label: string;
  readonly value: string;
  readonly severity?: 'error' | 'warning';
}

function compactCatalogValue(value: string): string {
  const maxLength = 28;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, 12)}...${value.slice(value.length - 13)}`;
}

export function formatProviderRouteSummary(route: ProviderRouteStatus): string {
  const now = Date.now();
  const cooling = route.candidates.filter((candidate) => isCoolingDown(candidate, now)).length;
  const ready = Math.max(0, route.candidates.length - cooling);
  const coolingSuffix = cooling > 0 ? `; ${String(cooling)} cooling` : '';
  return `${route.strategy} ${String(ready)}/${String(route.candidates.length)} ready${coolingSuffix}`;
}

export function providerRouteRows(route: ProviderRouteStatus): readonly StatusFieldRow[] {
  const rows: StatusFieldRow[] = [
    { label: ttui('tui.statusPanel.strategy'), value: formatProviderRouteSummary(route) },
  ];
  const visibleCandidates = route.candidates.slice(0, 6);
  for (let index = 0; index < visibleCandidates.length; index += 1) {
    const candidate = visibleCandidates[index]!;
    const cooling = isCoolingDown(candidate, Date.now());
    rows.push({
      label: `#${String(index + 1)}`,
      value: formatProviderRouteCandidate(candidate),
      severity: cooling ? 'error' : undefined,
    });
  }
  const hidden = route.candidates.length - visibleCandidates.length;
  if (hidden > 0) rows.push({ label: ttui('tui.statusPanel.more'), value: `${String(hidden)} more candidates` });
  return rows;
}

function formatProviderRouteCandidate(candidate: ProviderRouteCandidateStatus): string {
  const now = Date.now();
  const target = compactCatalogValue(`${candidate.modelAlias}/${candidate.providerModel}`);
  const provider = compactCatalogValue(routeCandidateProvider(candidate));
  const weight = candidate.weight === undefined ? '' : ` weight ${String(candidate.weight)}`;
  const latency = formatProviderRouteCandidateLatency(candidate);
  const headroom = formatProviderRouteCandidateHeadroom(candidate);
  const limits = formatProviderRouteCandidateRateLimits(candidate, now);
  const stats = formatProviderRouteCandidateStats(candidate);
  if (isCoolingDown(candidate, now)) {
    const reason = candidate.cooldownKind ?? candidate.lastFailureKind ?? 'failure';
    return `cooling ${reason} ${formatCooldownRemaining(candidate.cooldownUntil!, now)} ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
  }
  if (candidate.lastFailureKind !== undefined) {
    return `ready; last ${candidate.lastFailureKind} ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
  }
  return `ready ${provider} -> ${target}${weight}${latency}${headroom}${limits}${stats}`;
}

function formatProviderRouteCandidateLatency(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.avgLatencyMs !== undefined) return ` latency ${String(candidate.avgLatencyMs)}ms`;
  if (candidate.lastLatencyMs !== undefined) {
    return ` last_latency ${String(candidate.lastLatencyMs)}ms`;
  }
  return '';
}

function formatProviderRouteCandidateHeadroom(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.rateLimitHeadroom === undefined) return '';
  const percent = Math.round(Math.max(0, Math.min(1, candidate.rateLimitHeadroom)) * 100);
  return ` headroom ${String(percent)}%`;
}

function formatProviderRouteCandidateRateLimits(
  candidate: ProviderRouteCandidateStatus,
  now: number,
): string {
  if (candidate.rateLimits === undefined || candidate.rateLimits.length === 0) return '';
  return ` [${candidate.rateLimits
    .map((rateLimit) => {
      const quota =
        rateLimit.remaining === undefined && rateLimit.limit === undefined
          ? rateLimit.name
          : `${rateLimit.name}:${String(rateLimit.remaining ?? '?')}/${String(rateLimit.limit ?? '?')}`;
      return rateLimit.resetAt === undefined
        ? quota
        : `${quota}@${formatCooldownRemaining(rateLimit.resetAt, now)}`;
    })
    .join(',')}]`;
}

function formatProviderRouteCandidateStats(candidate: ProviderRouteCandidateStatus): string {
  const parts: string[] = [];
  if (candidate.successCount !== undefined && candidate.successCount > 0) {
    parts.push(`ok ${String(candidate.successCount)}`);
  }
  if (candidate.failureCount !== undefined && candidate.failureCount > 0) {
    parts.push(`fail ${String(candidate.failureCount)}`);
  }
  return parts.length === 0 ? '' : ` (${parts.join(', ')})`;
}

function routeCandidateProvider(candidate: ProviderRouteCandidateStatus): string {
  if (candidate.credentialLabel === undefined || candidate.credentialLabel.length === 0) {
    return candidate.providerName;
  }
  return `${candidate.providerName}:${candidate.credentialLabel}`;
}

function isCoolingDown(candidate: ProviderRouteCandidateStatus, now: number): boolean {
  return candidate.cooldownUntil !== undefined && candidate.cooldownUntil > now;
}

function formatCooldownRemaining(cooldownUntil: number, now: number): string {
  const remainingMs = Math.max(0, cooldownUntil - now);
  if (remainingMs < 60_000) return `${String(Math.ceil(remainingMs / 1000))}s`;
  if (remainingMs < 60 * 60_000) return `${String(Math.ceil(remainingMs / 60_000))}m`;
  return `${String(Math.ceil(remainingMs / (60 * 60_000)))}h`;
}
