import type { ModelAlias, ProviderRouteSelection } from '@superliora/sdk';

import { ttui } from '#/tui/utils/tui-i18n';

function displayAliasName(
  alias: string,
  models: Record<string, ModelAlias>,
): string {
  if (alias.trim().toLowerCase() === 'auto') return 'Smart Auto';
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
      return ttui('tui.statusPanel.failover');
    case 'switch':
      return ttui('tui.statusPanel.switch');
    case 'selection':
      return ttui('tui.statusPanel.selection');
  }
}

function formatRouteReason(reason: string): string {
  if (reason === 'completion:inline') return 'ghost complete';
  if (reason === 'completion:suggest') return 'suggest';
  if (reason === 'smart-auto' || reason === 'smart-auto pin') return 'smart auto';
  if (reason.startsWith('completion:')) return `completion · ${reason.slice('completion:'.length)}`;
  if (reason.startsWith('compaction')) return reason.replace(/^compaction[:]?/, 'compact').trim() || 'compact';
  // Prefer the trailing `role/intensity` token from smart-router reasons.
  const intensity = reason.match(/\b(compaction|completion|exploration|coding|planning|debugging)\/(value|balanced|max)\b/);
  if (intensity !== null) return intensity[0];
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
