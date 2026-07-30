import { AgentGroupComponent } from '../components/messages/agent-group';
import { ToolCallComponent } from '../components/messages/tool-call';
import type { TUIState } from '../tui-state';

/**
 * Push the actual terminal status of a background agent task into the
 * matching `Agent` tool call component so its snapshot phase no longer
 * trusts the spawn-success ToolResult (which would otherwise label every
 * terminated bg agent — including `lost` ones — as `✓ Completed`).
 *
 * Resolution policy: an `args.agentId` is treated as authoritative — we
 * either find a card whose `getSubagentAgentId()` returns the same id
 * (in-memory metadata for live foreground, parsed from the spawn-success
 * `agent_id: ...` line for live backgrounded and replayed cards) or we
 * skip. We deliberately do NOT fall back to description match when
 * `agentId` is provided, because:
 *   - On resume, `applyTerminalBackgroundAgentStatuses` iterates every
 *     persisted terminal task, including ones whose tool calls fell
 *     outside the `REPLAY_TURN_LIMIT` window. A description fallback
 *     would let an old `lost` task stamp its status onto an unrelated
 *     recent Agent card that happens to share `args.description`.
 *   - During a live spawn / terminate race, the same card can briefly
 *     appear in both `_pendingToolComponents` and `transcriptContainer`,
 *     so a description match could double-visit the same component and
 *     mark itself ambiguous. agentId match short-circuits on the first
 *     hit and is immune.
 *
 * Description fallback is kept as a best-effort path only when
 * `agentId` is unknown — that is, on resume of pre-PR sessions whose
 * disk records pre-date `agent_id` persistence.
 *
 * Search scope includes both in-flight components and already-mounted
 * cards (some live in `transcriptContainer` standalone, others are
 * borrowed by an `AgentGroupComponent` and reachable only via
 * `getToolComponents()`).
 *
 * Returns true iff a component was found and updated.
 */
export function applyBackgroundTaskTerminalStatus(
  pendingToolComponents: ReadonlyMap<string, ToolCallComponent>,
  transcriptContainer: TUIState['transcriptContainer'],
  args: {
    agentId?: string | undefined;
    description: string;
    status: 'completed' | 'failed' | 'timed_out' | 'killed' | 'lost';
    /**
     * Real failure message to surface on the card. Pass the `subagent.failed`
     * event's `error` for live crashes — it is far more useful than the
     * friendly generic the card falls back to. Omit on the resume / terminate
     * path where no real error is available.
     */
    errorText?: string | undefined;
  },
): boolean {
  const useAgentIdOnly = args.agentId !== undefined;
  let agentIdMatch: ToolCallComponent | undefined;
  let descMatch: ToolCallComponent | undefined;
  let descAmbiguous = false;
  const visit = (tc: ToolCallComponent): void => {
    if (agentIdMatch !== undefined) return;
    if (useAgentIdOnly) {
      if (tc.getSubagentAgentId() === args.agentId) agentIdMatch = tc;
      return;
    }
    if (tc.getAgentToolDescription() !== args.description) return;
    if (descMatch !== undefined) {
      descAmbiguous = true;
      return;
    }
    descMatch = tc;
  };

  for (const tc of pendingToolComponents.values()) {
    visit(tc);
    if (agentIdMatch !== undefined) break;
  }
  if (agentIdMatch === undefined) {
    for (const child of transcriptContainer.children) {
      if (child instanceof ToolCallComponent) {
        visit(child);
      } else if (child instanceof AgentGroupComponent) {
        for (const tc of child.getToolComponents()) {
          visit(tc);
          if (agentIdMatch !== undefined) break;
        }
      }
      if (agentIdMatch !== undefined) break;
    }
  }
  const target = useAgentIdOnly
    ? agentIdMatch
    : descAmbiguous
      ? undefined
      : descMatch;
  if (target === undefined) return false;
  target.setBackgroundTaskTerminalStatus(args.status, { errorText: args.errorText });
  return true;
}

/**
 * Mark a foreground subagent card as detached-to-background (`◐ backgrounded`).
 * Routed from a `background.task.started` event whose `info.kind === 'agent'`,
 * keyed by `agentId`. Returns true iff a matching component was found.
 *
 * Gated to cards that are currently foreground-running: `background.task.started`
 * also fires for `Agent(run_in_background=true)` launches and for background
 * resumes, and those must not mutate older completed rows that happen to share
 * the same `agentId` (a resume's new card has no parsed `agent_id` yet, so the
 * search can otherwise hit the previous completed card).
 */
export function markSubagentBackgrounded(
  pendingToolComponents: ReadonlyMap<string, ToolCallComponent>,
  transcriptContainer: TUIState['transcriptContainer'],
  agentId: string | undefined,
): boolean {
  if (agentId === undefined) return false;
  const visit = (tc: ToolCallComponent): boolean => {
    if (tc.getSubagentAgentId() !== agentId) return false;
    const phase = tc.getSubagentSnapshot().phase;
    if (phase !== 'running' && phase !== 'queued' && phase !== 'spawning') return false;
    tc.markBackgrounded();
    return true;
  };
  for (const tc of pendingToolComponents.values()) {
    if (visit(tc)) return true;
  }
  for (const child of transcriptContainer.children) {
    if (child instanceof ToolCallComponent) {
      if (visit(child)) return true;
    } else if (child instanceof AgentGroupComponent) {
      for (const tc of child.getToolComponents()) {
        if (visit(tc)) return true;
      }
    }
  }
  return false;
}
