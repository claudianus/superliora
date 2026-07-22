/**
 * Command palette intelligence — MRU tracking, context-aware scoring,
 * and adaptive ordering for the unified command palette.
 *
 * The palette learns from usage patterns: frequently used commands float
 * to the top, recently used commands get a recency boost, and the current
 * context (agent state, active tools, time of day) influences ranking.
 *
 * Pure logic module — no rendering, no TUI state dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaletteUsageRecord {
  readonly commandId: string;
  readonly lastUsedAt: number;
  readonly useCount: number;
  /** Exponentially-weighted recency score (decays over time). */
  readonly recencyScore: number;
}

export type PaletteContext =
  | 'idle'
  | 'streaming'
  | 'tool-running'
  | 'waiting-approval'
  | 'ultrawork'
  | 'swarm'
  | 'goal-active'
  | 'error';

export interface PaletteScoreOptions {
  readonly context: PaletteContext;
  readonly now: number;
  /** Whether the agent is currently busy (streaming/tool). */
  readonly agentBusy: boolean;
  /** Number of pending approvals. */
  readonly pendingApprovals: number;
}

export interface ScoredPaletteEntry {
  readonly commandId: string;
  readonly score: number;
  readonly reasons: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Recency half-life in milliseconds (score halves every 30 minutes). */
const RECENCY_HALF_LIFE_MS = 30 * 60 * 1000;

/** Maximum usage records to keep. */
const MAX_RECORDS = 100;

/** Score weights. */
const WEIGHT_FREQUENCY = 0.3;
const WEIGHT_RECENCY = 0.4;
const WEIGHT_CONTEXT = 0.3;

/** Context relevance map: which commands are more relevant in each context. */
const CONTEXT_BOOSTS: Record<PaletteContext, ReadonlySet<string>> = {
  idle: new Set(['model', 'config', 'theme', 'help', 'session', 'memory']),
  streaming: new Set(['stop', 'cancel', 'compact', 'status']),
  'tool-running': new Set(['stop', 'cancel', 'status', 'diff']),
  'waiting-approval': new Set(['approve', 'deny', 'permissions', 'config']),
  ultrawork: new Set(['ultrawork', 'goal', 'status', 'stop', 'evidence']),
  swarm: new Set(['swarm', 'dispatch', 'status', 'stop']),
  'goal-active': new Set(['goal', 'status', 'stop', 'evidence', 'plan']),
  error: new Set(['undo', 'log', 'status', 'help', 'config']),
};

// ---------------------------------------------------------------------------
// MRU Tracker
// ---------------------------------------------------------------------------

export class PaletteMruTracker {
  private records: Map<string, PaletteUsageRecord> = new Map();

  /** Record a command usage. */
  recordUsage(commandId: string, now: number = Date.now()): void {
    const existing = this.records.get(commandId);
    const recencyScore = existing !== undefined
      ? existing.recencyScore * decayFactor(now - existing.lastUsedAt) + 1
      : 1;

    this.records.set(commandId, {
      commandId,
      lastUsedAt: now,
      useCount: (existing?.useCount ?? 0) + 1,
      recencyScore,
    });

    // Evict oldest entries if over capacity
    if (this.records.size > MAX_RECORDS) {
      const sorted = [...this.records.values()]
        .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      const toRemove = sorted.slice(0, sorted.length - MAX_RECORDS);
      for (const record of toRemove) {
        this.records.delete(record.commandId);
      }
    }
  }

  /** Get the usage record for a command. */
  getRecord(commandId: string): PaletteUsageRecord | undefined {
    return this.records.get(commandId);
  }

  /** Get the top N most recently used command IDs. */
  getRecentCommands(limit: number, now: number = Date.now()): string[] {
    return [...this.records.values()]
      .map((r) => ({
        id: r.commandId,
        score: r.recencyScore * decayFactor(now - r.lastUsedAt),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.id);
  }

  /** Get the top N most frequently used command IDs. */
  getFrequentCommands(limit: number): string[] {
    return [...this.records.values()]
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit)
      .map((r) => r.commandId);
  }

  /** Compute a composite score for a command given the current context. */
  scoreCommand(commandId: string, options: PaletteScoreOptions): ScoredPaletteEntry {
    const record = this.records.get(commandId);
    const reasons: string[] = [];

    // Frequency score (log-scaled to prevent dominance)
    const frequencyScore = record !== undefined
      ? Math.log2(1 + record.useCount) / Math.log2(1 + MAX_RECORDS)
      : 0;
    if (frequencyScore > 0.3) reasons.push('frequent');

    // Recency score (exponential decay)
    const recencyScore = record !== undefined
      ? record.recencyScore * decayFactor(options.now - record.lastUsedAt)
      : 0;
    const normalizedRecency = Math.min(1, recencyScore / 5);
    if (normalizedRecency > 0.3) reasons.push('recent');

    // Context relevance score
    const contextBoosts = CONTEXT_BOOSTS[options.context];
    const contextScore = contextBoosts.has(commandId) ? 1 : 0;
    if (contextScore > 0) reasons.push(`ctx:${options.context}`);

    // Special context-aware boosts
    let specialBoost = 0;
    if (options.pendingApprovals > 0 && (commandId === 'approve' || commandId === 'permissions')) {
      specialBoost = 0.5;
      reasons.push('approvals-pending');
    }
    if (options.agentBusy && (commandId === 'stop' || commandId === 'cancel')) {
      specialBoost = Math.max(specialBoost, 0.4);
      reasons.push('agent-busy');
    }

    const score =
      frequencyScore * WEIGHT_FREQUENCY +
      normalizedRecency * WEIGHT_RECENCY +
      contextScore * WEIGHT_CONTEXT +
      specialBoost;

    return { commandId, score, reasons };
  }

  /** Score and rank multiple commands. */
  rankCommands(commandIds: readonly string[], options: PaletteScoreOptions): ScoredPaletteEntry[] {
    return commandIds
      .map((id) => this.scoreCommand(id, options))
      .sort((a, b) => b.score - a.score);
  }

  /** Serialize state for persistence. */
  serialize(): string {
    return JSON.stringify([...this.records.values()]);
  }

  /** Restore state from serialized data. */
  static deserialize(data: string): PaletteMruTracker {
    const tracker = new PaletteMruTracker();
    try {
      const records = JSON.parse(data) as PaletteUsageRecord[];
      for (const record of records) {
        if (record.commandId && typeof record.useCount === 'number') {
          tracker.records.set(record.commandId, record);
        }
      }
    } catch {
      // Ignore corrupt data
    }
    return tracker;
  }

  /** Clear all usage data. */
  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exponential decay factor: score halves every RECENCY_HALF_LIFE_MS. */
function decayFactor(elapsedMs: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.pow(0.5, elapsedMs / RECENCY_HALF_LIFE_MS);
}

// ---------------------------------------------------------------------------
// Context detection helper
// ---------------------------------------------------------------------------

/**
 * Infer the current palette context from application state signals.
 * Callers pass in boolean flags; this returns the most specific context.
 */
export function inferPaletteContext(signals: {
  readonly isStreaming: boolean;
  readonly isToolRunning: boolean;
  readonly isWaitingApproval: boolean;
  readonly isUltrawork: boolean;
  readonly isSwarm: boolean;
  readonly isGoalActive: boolean;
  readonly hasError: boolean;
}): PaletteContext {
  if (signals.isWaitingApproval) return 'waiting-approval';
  if (signals.hasError) return 'error';
  if (signals.isUltrawork) return 'ultrawork';
  if (signals.isSwarm) return 'swarm';
  if (signals.isGoalActive) return 'goal-active';
  if (signals.isToolRunning) return 'tool-running';
  if (signals.isStreaming) return 'streaming';
  return 'idle';
}
