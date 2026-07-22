/**
 * Quest Dashboard domain types.
 *
 * A "quest" is a single SuperLiora session/process running in parallel.
 * The bento grid dashboard displays 3–12 quests simultaneously, each as
 * a cell with real-time status, elapsed time, change counts, and plan step.
 */

// ---------------------------------------------------------------------------
// Quest State Machine (6 states)
// ---------------------------------------------------------------------------

export type QuestState =
  | 'idle'
  | 'running'
  | 'blocked'
  | 'waiting-approval'
  | 'done'
  | 'failed';

/** States that trigger pulse + bell attention routing. */
export const ATTENTION_STATES: ReadonlySet<QuestState> = new Set([
  'waiting-approval',
  'failed',
]);

/**
 * Gen 17: display priority for quest ordering — lower sorts first. Quests
 * needing human intervention (waiting-approval, failed) surface at the top so
 * they are acted on fastest; finished quests sink to the bottom.
 */
export function questStatePriority(state: QuestState): number {
  switch (state) {
    case 'waiting-approval':
      return 0;
    case 'failed':
      return 1;
    case 'blocked':
      return 2;
    case 'running':
      return 3;
    case 'idle':
      return 4;
    case 'done':
      return 5;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Change Counts
// ---------------------------------------------------------------------------

export interface QuestChangeCount {
  readonly added: number;
  readonly removed: number;
}

// ---------------------------------------------------------------------------
// Quest Entity (ontology: QuestDashboard)
// ---------------------------------------------------------------------------

export interface Quest {
  /** Unique quest identifier. */
  readonly id: string;
  /** Human-readable quest name. */
  readonly name: string;
  /** Bound SuperLiora session/process reference. */
  readonly sessionRef: string;
  /** Current lifecycle state. */
  readonly state: QuestState;
  /** Quest creation timestamp (ms epoch). */
  readonly createdAt: number;
  /** Last activity timestamp (ms epoch). */
  readonly lastActivityAt: number;
  /** File change counts. */
  readonly changeCount: QuestChangeCount;
  /** Current plan step summary. */
  readonly planStep: string;
  /** Git worktree path assigned to this quest. */
  readonly worktreePath: string;
  /** Whether this quest is pinned/expanded. */
  readonly pinned: boolean;
  /** Whether approval is pending (pulse trigger). */
  readonly approvalPending: boolean;
  /** Gen 9: todo progress for the main session ({ done, total }), if any. */
  readonly todoProgress?: { done: number; total: number } | undefined;
  /** Gen 9: context window usage ratio (0–1) for the main session. */
  readonly contextUsage?: number | undefined;
  /** Gen 13: summary of the pending approval (tool + description), if any. */
  readonly pendingApprovalSummary?: string | undefined;
  /** Gen 18: model name for the main session. */
  readonly modelName?: string | undefined;
  /** Gen 18: accumulated session cost in USD for the main session. */
  readonly sessionCostUsd?: number | undefined;
  /** Gen 21: last error message for the main session, shown when failed. */
  readonly lastErrorMessage?: string | undefined;
}

// ---------------------------------------------------------------------------
// Cell Bounds (bento grid position)
// ---------------------------------------------------------------------------

export interface QuestCellBounds {
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
}

// ---------------------------------------------------------------------------
// Dashboard View Mode
// ---------------------------------------------------------------------------

export type DashboardViewMode = 'dashboard' | 'pinned';

// ---------------------------------------------------------------------------
// Attention Event (for timing assertions)
// ---------------------------------------------------------------------------

export interface AttentionEvent {
  readonly questId: string;
  readonly state: QuestState;
  /** Timestamp when the event was received by session-event-handler. */
  readonly receivedAt: number;
  /** Timestamp when the pulse first frame was rendered. */
  readonly pulseRenderedAt: number | null;
}

// ---------------------------------------------------------------------------
// Worktree Info
// ---------------------------------------------------------------------------

export interface WorktreeInfo {
  readonly questId: string;
  readonly path: string;
  readonly branch: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format elapsed time as human-readable string (e.g. "9h", "12m", "30s"). */
export function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/** Format change counts as "+N -M". */
export function formatChangeCount(cc: QuestChangeCount): string {
  return `+${cc.added} -${cc.removed}`;
}

/** State → single-char icon for cell display. */
export function questStateIcon(state: QuestState): string {
  switch (state) {
    case 'idle': return '○';
    case 'running': return '●';
    case 'blocked': return '◐';
    case 'waiting-approval': return '⚡';
    case 'done': return '✓';
    case 'failed': return '✗';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
