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

/**
 * Gen 12 / Gen 35: map a quest state to its theme color token so the 6
 * lifecycle states are scannable at a glance. Shared by the dashboard cells
 * and the expand-view header.
 */
export function questStateColorToken(
  state: QuestState,
): 'textMuted' | 'accent' | 'warning' | 'success' | 'error' {
  switch (state) {
    case 'idle':
      return 'textMuted';
    case 'running':
      return 'accent';
    case 'blocked':
    case 'waiting-approval':
      return 'warning';
    case 'done':
      return 'success';
    case 'failed':
      return 'error';
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Gen 30: Dashboard Sort Modes
// ---------------------------------------------------------------------------

/**
 * Gen 30: sort criteria for the dashboard grid. `attention` keeps the Gen 17
 * priority order; the others let operators re-rank quests by cost, age, or
 * name. Attention states always win within `attention` mode only.
 */
export type QuestSortMode = 'attention' | 'cost' | 'age' | 'name' | 'health' | 'ctx';

/** Ordered cycle of sort modes for the `s` key. */
export const QUEST_SORT_MODES: readonly QuestSortMode[] = [
  'attention',
  'cost',
  'age',
  'name',
  'health',
  'ctx',
];

/** Gen 30: next sort mode in the cycle. */
export function nextSortMode(mode: QuestSortMode): QuestSortMode {
  const idx = QUEST_SORT_MODES.indexOf(mode);
  return QUEST_SORT_MODES[(idx + 1) % QUEST_SORT_MODES.length]!;
}

/** Gen 30: short label shown in the dashboard summary bar. */
export function sortModeLabel(mode: QuestSortMode): string {
  switch (mode) {
    case 'attention':
      return 'attention';
    case 'cost':
      return 'cost';
    case 'age':
      return 'age';
    case 'name':
      return 'name';
    case 'health':
      return 'health';
    case 'ctx':
      return 'ctx';
    default: {
      const _exhaustive: never = mode;
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
  /** Gen 33: timestamp (ms epoch) when the quest entered its current attention state. */
  readonly attentionEnteredAt?: number | undefined;
}

// ---------------------------------------------------------------------------
// Gen 47: Quest Health Score
// ---------------------------------------------------------------------------

/**
 * Gen 47: compute a 0–100 health score for a quest. Higher is healthier.
 *
 * The score blends three signals:
 *  - State: attention states (waiting-approval, failed) anchor the score low;
 *    running/idle are healthy; done is neutral-good.
 *  - Idle duration: a long silence on a non-terminal quest erodes health.
 *  - Context pressure: high context-window usage erodes health.
 *
 * Pure and deterministic (given `now`) so it is trivially unit-testable and
 * reusable for future sorting / highlight heuristics.
 */
export function questHealthScore(quest: Quest, now: number): number {
  // Base score from lifecycle state.
  let score: number;
  switch (quest.state) {
    case 'waiting-approval':
      score = 25;
      break;
    case 'failed':
      score = 10;
      break;
    case 'blocked':
      score = 45;
      break;
    case 'running':
      score = 90;
      break;
    case 'idle':
      score = 70;
      break;
    case 'done':
      score = 80;
      break;
    default: {
      const _exhaustive: never = quest.state;
      score = _exhaustive;
    }
  }

  // Idle penalty: only for live (non-terminal) quests. Lose up to 30 points
  // over 15 minutes of silence.
  const terminal = quest.state === 'done' || quest.state === 'failed';
  if (!terminal) {
    const idleMs = Math.max(0, now - quest.lastActivityAt);
    const idlePenalty = Math.min(30, (idleMs / (15 * 60_000)) * 30);
    score -= idlePenalty;
  }

  // Context penalty: lose up to 20 points as usage approaches 100%.
  if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
    const usage = Math.max(0, Math.min(1, quest.contextUsage));
    score -= usage * 20;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
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

/**
 * Gen 29 / Gen 36: render a compact context-usage bar, e.g. `ctx ▓▓▓░░ 62%`.
 * The bar fills proportionally so context pressure is scannable at a glance.
 * Shared by the dashboard cells and the expand-view header.
 */
export function renderContextBar(usage: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(usage * 100)));
  const cells = 5;
  const filled = Math.round((pct / 100) * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  return `ctx ${bar} ${String(pct)}%`;
}

/**
 * Gen 72: severity token for context-window usage so callers can color the
 * bar by pressure — warning at 80%, error at 95%. Stays theme-free here; the
 * caller applies the color (matching the quest-types helper convention).
 */
export function contextSeverityToken(usage: number): 'error' | 'warning' | 'success' {
  const pct = usage * 100;
  if (pct >= 95) return 'error';
  if (pct >= 80) return 'warning';
  return 'success';
}

/**
 * Gen 31 / Gen 36: render a compact todo-progress bar, e.g. `☑ ▓▓▓░░ 3/5`.
 * Mirrors the context bar so parallel quest progress is scannable at a glance.
 * Shared by the dashboard cells and the expand-view header.
 */
export function renderTodoBar(done: number, total: number): string {
  const safeTotal = Math.max(1, total);
  const ratio = Math.max(0, Math.min(1, done / safeTotal));
  const cells = 5;
  const filled = Math.round(ratio * cells);
  const bar = '▓'.repeat(filled) + '░'.repeat(cells - filled);
  return `☑ ${bar} ${String(done)}/${String(total)}`;
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
