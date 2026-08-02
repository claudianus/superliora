/**
 * Loop51a — surface `runtime.degraded` as a named TUI notice.
 *
 * Footer badge alone is easy to miss during a long turn. Pair it with a
 * coalesceable notice so operators see which scope degraded and why.
 */

export type RuntimeDegradedNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

const SCOPE_LABEL: Record<string, string> = {
  search: 'Search',
  oauth: 'OAuth',
  llm: 'LLM',
  mcp: 'MCP',
  permission: 'Permission',
  network: 'Network',
  other: 'Runtime',
};

export function formatRuntimeDegradedNotice(input: {
  readonly scope: string;
  readonly reason: string;
  readonly hint?: string;
}): RuntimeDegradedNotice {
  const scopeKey = input.scope.length > 0 ? input.scope : 'other';
  const label = SCOPE_LABEL[scopeKey] ?? scopeKey;
  const reason = input.reason.trim().length > 0 ? input.reason.trim() : 'unknown';
  const extra =
    input.hint !== undefined && input.hint.trim().length > 0
      ? `\n${input.hint.trim()}`
      : '';
  return {
    title: `${label} degraded`,
    detail: `${label} entered a degraded state (reason=${reason}).${extra}\nOps may continue in a reduced mode — check footer badge, network/auth, and subsystem health.`,
    status: `Runtime degraded · ${scopeKey}: ${reason}`,
    coalesceKey: `runtime-degraded-${scopeKey}`,
  };
}
