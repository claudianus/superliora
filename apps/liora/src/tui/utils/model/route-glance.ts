/**
 * Provider route / failover glance for Ops Runtime Health.
 * Reads optional providerRouteStatus and lastModelRouteNotice only.
 */

import type { ModelAlias, ProviderRouteStatus } from '@superliora/sdk';

export interface ModelRouteNoticeLike {
  readonly kind: 'failover' | 'switch' | 'selection';
  readonly fromAlias?: string;
  readonly toAlias: string;
  readonly reason?: string;
  readonly atMs: number;
}

export interface OpsRouteGlanceInput {
  readonly providerRouteStatus?: ProviderRouteStatus | null;
  readonly lastModelRouteNotice?: ModelRouteNoticeLike | null;
  readonly availableModels?: Readonly<Record<string, ModelAlias>>;
}

/** Compact one-liner for Ops Runtime Health pane; null when no route data. */
export function formatOpsRouteLine(input: OpsRouteGlanceInput): string | null {
  const notice = input.lastModelRouteNotice;
  if (notice != null && notice.kind === 'failover') {
    const model = routeModelLabel(notice.toAlias, input.availableModels);
    const reason = formatRouteReason(notice.reason);
    return reason.length > 0 ? `Route: failover→${model} (${reason})` : `Route: failover→${model}`;
  }

  if (input.providerRouteStatus != null) {
    return 'Route: primary';
  }

  return null;
}

function routeModelLabel(
  alias: string,
  models: Readonly<Record<string, ModelAlias>> | undefined,
): string {
  const entry = models?.[alias];
  return entry?.displayName ?? entry?.model ?? alias;
}

function formatRouteReason(reason: string | undefined): string {
  if (reason === undefined || reason.trim().length === 0) return '';
  const normalized = reason.trim();
  if (normalized === 'provider-failover') return 'provider-failover';
  if (normalized === 'provider-credential') return 'provider-credential';
  if (normalized === 'provider-route') return 'provider-route';
  if (normalized === 'completion:inline') return 'ghost complete';
  if (normalized === 'completion:suggest') return 'suggest';
  if (normalized.startsWith('completion:')) {
    return truncate(`completion · ${normalized.slice('completion:'.length)}`, 32);
  }
  if (normalized.startsWith('compaction')) {
    const compact = normalized.replace(/^compaction[:]?/, 'compact').trim() || 'compact';
    return truncate(compact, 32);
  }
  return truncate(normalized, 36);
}

function truncate(text: string, max: number): string {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}
