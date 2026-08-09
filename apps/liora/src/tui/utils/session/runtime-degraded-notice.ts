/**
 * Loop51a — surface `runtime.degraded` as a named TUI notice.
 *
 * Footer badge alone is easy to miss during a long turn. Pair it with a
 * coalesceable notice so operators see which scope degraded and why.
 */

import { ttui } from '#/tui/utils/tui-i18n';

export type RuntimeDegradedNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

const SCOPE_LABEL_KEY: Record<string, string> = {
  search: 'tui.notice.runtimeDegraded.scope.search',
  oauth: 'tui.notice.runtimeDegraded.scope.oauth',
  llm: 'tui.notice.runtimeDegraded.scope.llm',
  mcp: 'tui.notice.runtimeDegraded.scope.mcp',
  permission: 'tui.notice.runtimeDegraded.scope.permission',
  network: 'tui.notice.runtimeDegraded.scope.network',
  other: 'tui.notice.runtimeDegraded.scope.other',
};

function scopeLabel(scopeKey: string): string {
  const key = SCOPE_LABEL_KEY[scopeKey];
  if (key === undefined) return scopeKey;
  return ttui(key);
}

export function formatRuntimeDegradedNotice(input: {
  readonly scope: string;
  readonly reason: string;
  readonly hint?: string;
}): RuntimeDegradedNotice {
  const scopeKey = input.scope.length > 0 ? input.scope : 'other';
  const label = scopeLabel(scopeKey);
  const reason = input.reason.trim().length > 0 ? input.reason.trim() : 'unknown';
  const extra =
    input.hint !== undefined && input.hint.trim().length > 0
      ? `\n${input.hint.trim()}`
      : '';
  return {
    title: ttui('tui.notice.runtimeDegraded.title', { label }),
    detail: ttui('tui.notice.runtimeDegraded.detail', { label, reason, extra }),
    status: ttui('tui.notice.runtimeDegraded.status', { scopeKey, reason }),
    coalesceKey: `runtime-degraded-${scopeKey}`,
  };
}
