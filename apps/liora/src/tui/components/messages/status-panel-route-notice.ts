import type { ModelAlias, ProviderRouteSelection } from '@superliora/sdk';

function displayAliasName(
  alias: string,
  models: Record<string, ModelAlias>,
): string {
  const entry = models[alias];
  return entry?.displayName ?? entry?.model ?? alias;
}

export function formatLastRouteSelection(
  selection: ProviderRouteSelection,
  models: Record<string, ModelAlias>,
): string {
  const name = displayAliasName(selection.modelAlias, models);
  const parts = [name];
  if (
    selection.providerModel.length > 0 &&
    selection.providerModel !== selection.modelAlias &&
    selection.providerModel !== name
  ) {
    parts.push(selection.providerModel);
  }
  const cred = selection.credentialLabel ?? selection.providerName;
  if (cred !== undefined && cred.length > 0) {
    parts.push(cred);
  }
  return parts.join(' · ');
}

export function noticeKindLabel(kind: 'failover' | 'switch' | 'selection'): string {
  switch (kind) {
    case 'failover':
      return 'Failover';
    case 'switch':
      return 'Switch';
    case 'selection':
      return 'Selection';
  }
}

function formatRouteReason(reason: string): string {
  if (reason === 'completion:inline') return 'ghost complete';
  if (reason === 'completion:suggest') return 'suggest';
  if (reason.startsWith('completion:')) return `completion · ${reason.slice('completion:'.length)}`;
  if (reason.startsWith('compaction')) return reason.replace(/^compaction[:]?/, 'compact').trim() || 'compact';
  return reason;
}

export function formatLastRouteNotice(
  notice: {
    readonly kind: 'failover' | 'switch' | 'selection';
    readonly fromAlias?: string;
    readonly toAlias: string;
    readonly providerName?: string;
    readonly credentialLabel?: string;
    readonly providerModel?: string;
    readonly reason?: string;
    readonly atMs: number;
  },
  models: Record<string, ModelAlias>,
): string {
  const to = displayAliasName(notice.toAlias, models);
  const parts: string[] = [];
  if (notice.fromAlias !== undefined && notice.fromAlias !== notice.toAlias) {
    parts.push(`${displayAliasName(notice.fromAlias, models)} → ${to}`);
  } else {
    parts.push(to);
  }
  if (notice.reason !== undefined && notice.reason.length > 0) {
    parts.push(formatRouteReason(notice.reason));
  }
  const ageSec = Math.max(0, Math.round((Date.now() - notice.atMs) / 1000));
  parts.push(`${String(ageSec)}s ago`);
  return parts.join(' · ');
}
