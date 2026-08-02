/**
 * Loop50a — surface `subagent.stalled` as a named TUI notice.
 *
 * Engine emits after 5 minutes of silence; the TUI previously only updated
 * activity chrome and never told the operator why a child looked frozen.
 */

export type SubagentStalledNotice = {
  readonly title: string;
  readonly detail: string;
  readonly status: string;
  readonly coalesceKey: string;
};

function formatSilentDuration(silentMs: number): string {
  if (!Number.isFinite(silentMs) || silentMs < 0) return 'unknown duration';
  const totalSec = Math.floor(silentMs / 1000);
  if (totalSec < 60) return `${String(totalSec)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec > 0 ? `${String(min)}m ${String(sec)}s` : `${String(min)}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin > 0 ? `${String(hr)}h ${String(remMin)}m` : `${String(hr)}h`;
}

export function formatSubagentStalledNotice(input: {
  readonly subagentId: string;
  readonly subagentName?: string;
  readonly silentMs: number;
  readonly toolCount: number;
}): SubagentStalledNotice {
  const name =
    input.subagentName !== undefined && input.subagentName.length > 0
      ? input.subagentName
      : input.subagentId;
  const silent = formatSilentDuration(input.silentMs);
  const tools = Number.isFinite(input.toolCount) ? Math.max(0, Math.floor(input.toolCount)) : 0;
  return {
    title: 'Subagent stalled',
    detail: `Subagent ${name} has been silent for ${silent} (${String(tools)} tools so far). It is still running — wait, cancel the child, or inspect its last tool activity.`,
    status: `Subagent stalled: ${name} (${silent})`,
    coalesceKey: `subagent-stalled-${input.subagentId}`,
  };
}
