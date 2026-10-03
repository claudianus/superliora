import type { PromptItem, PromptSubmission } from '@superliora/protocol';

export const MAIN_AGENT_ID = 'main';

export function promptKey(sessionId: string, agentId: string): string {
  return `${sessionId}\u0000${agentId}`;
}

/** Cap per-session dispatch-log entries; ring-buffer drops oldest on overflow. */
export const DISPATCH_LOG_CAP = 100;

/**
 * Per-session prompt state; the last terminal state remains until replacement.
 *
 * `turnId === null` when the prompt has been submitted but the first
 * `turn.started` hasn't arrived yet (the RPC pair queues calls before
 * `ready()` so the gap is small but non-zero in practice).
 *
 * Terminal flags are set only when the turn settles; retained state makes
 * repeated cancellation idempotent until the next prompt replaces it.
 */
export interface PromptState {
  agentId: string;
  promptId: string;
  userMessageId: string;
  body: PromptSubmission;
  createdAt: string;
  turnId: number | null;
  /** Set on `turn.ended` for the top-level turn (reason='completed'|'failed'|'filtered'). */
  completed: boolean;
  /** Set only after the top-level turn settles with reason='cancelled'. */
  aborted: boolean;
  cancelRequested?: boolean;
}

export function toPromptItem(state: PromptState, status: 'running' | 'queued'): PromptItem {
  return {
    prompt_id: state.promptId,
    user_message_id: state.userMessageId,
    status,
    content: state.body.content,
    created_at: state.createdAt,
  };
}
