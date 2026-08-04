import type {
  CacheDiagnostics,
  CacheMissReason,
  CacheMissReasonHistogram,
  UsageStatus,
} from '#/rpc';
import { getLocalResearchCacheTelemetry } from '#/tools/providers/local-research-cache-telemetry';
import { getSearchNeverEmptyTelemetry } from '#/tools/providers/search-never-empty-telemetry';
import {
  addUsage,
  cacheHitRate as computeCacheHitRate,
  inputTotal,
  type TokenUsage,
} from '@superliora/kosong';

import type { Agent } from '..';

export type UsageRecordScope = 'session' | 'turn';

/** Minimum turn input tokens before warm-streak evaluation applies. */
const WARM_STREAK_MIN_INPUT = 100;

/** Turn-level cache hit rate at or above this counts as a warm turn. */
const WARM_STREAK_HIT_TARGET = 0.99;

function copyUsage(usage: TokenUsage): TokenUsage {
  return { ...usage };
}

/**
 * Fast deterministic hash for the serialized tool block. Uses a simple
 * FNV-1a-style hash over the concatenated tool names + description lengths
 * (full JSON serialization is too expensive per-step; name+length catches
 * additions, removals, and description rewrites with negligible collision).
 */
function hashToolBlock(tools: readonly { name: string; description: string }[]): string {
  let h = 0x811c9dc5;
  for (const tool of tools) {
    const key = `${tool.name}:${String(tool.description.length)}`;
    for (let i = 0; i < key.length; i++) {
      const cp = key.codePointAt(i);
      if (cp === undefined) continue;
      h ^= cp;
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class UsageRecorder {
  private readonly byModel: Record<string, TokenUsage> = {};
  private currentTurn: TokenUsage | undefined;
  private warmHitStreak = 0;
  /** Avoid incrementing warm streak more than once per agent turn. */
  private turnWarmStreakCounted = false;
  private lastToolBlockHash: string | undefined;
  private lastStepModel: string | undefined;
  private lastCacheDiagnostics: CacheDiagnostics | undefined;
  private readonly missReasonCounts: CacheMissReasonHistogram = {};
  /**
   * One-shot observation armed by a compaction: the next recorded usage is
   * the first request that re-sends the retained tail, so its cache-read vs
   * cache-creation split measures how much of the tail the provider cache
   * actually gave back (tuning signal for retained-tail size).
   */
  private pendingCacheRecovery:
    | {
        readonly kind: 'full' | 'micro';
        readonly retainedTokens?: number;
        readonly recordedAt: number;
      }
    | null = null;

  constructor(protected readonly agent?: Agent) {}

  beginTurn(): void {
    this.currentTurn = undefined;
    this.turnWarmStreakCounted = false;
  }

  endTurn(): void {
    this.currentTurn = undefined;
    this.turnWarmStreakCounted = false;
  }

  /** Arm a one-shot cache-recovery observation for the next recorded usage. */
  noteCompactionApplied(kind: 'full' | 'micro', retainedTokens?: number): void {
    this.pendingCacheRecovery = {
      kind,
      ...(retainedTokens !== undefined ? { retainedTokens } : {}),
      recordedAt: Date.now(),
    };
  }

  record(model: string, usage: TokenUsage, scope: UsageRecordScope = 'session'): void {
    this.agent?.records.logRecord({
      type: 'usage.record',
      model,
      usage,
      usageScope: scope,
    });
    const current = this.byModel[model];
    this.byModel[model] = current === undefined ? copyUsage(usage) : addUsage(current, usage);

    if (scope === 'turn') {
      this.currentTurn =
        this.currentTurn === undefined ? copyUsage(usage) : addUsage(this.currentTurn, usage);
      this.updateWarmHitStreakFromTurn(this.currentTurn);
    }
    const recovery = this.pendingCacheRecovery;
    if (recovery !== null) {
      this.pendingCacheRecovery = null;
      const input = inputTotal(usage);
      this.agent?.telemetry.track('compaction_cache_recovery', {
        kind: recovery.kind,
        scope,
        model,
        input_tokens: input,
        cache_read_tokens: usage.inputCacheRead,
        cache_creation_tokens: usage.inputCacheCreation,
        input_other_tokens: usage.inputOther,
        cache_read_ratio: input > 0 ? usage.inputCacheRead / input : 0,
        ...(recovery.retainedTokens !== undefined
          ? { retained_tokens: recovery.retainedTokens }
          : {}),
        ms_since_compaction: Date.now() - recovery.recordedAt,
      });
    }
    this.agent?.emitStatusUpdated();
  }

  /** Update cache-prefix stability diagnostics (called per step). */
  recordCacheDiagnostics(
    tools: readonly { name: string; description: string }[],
    injectionCount: number,
    messageCount: number,
    stepUsage?: TokenUsage,
    model?: string,
  ): void {
    const toolBlockHash = hashToolBlock(tools);
    const toolBlockChanged = this.lastToolBlockHash !== undefined && this.lastToolBlockHash !== toolBlockHash;
    this.lastToolBlockHash = toolBlockHash;
    if (stepUsage !== undefined && model !== undefined) {
      this.recordCacheMissReasonIfNeeded(stepUsage, model, toolBlockChanged);
      this.lastStepModel = model;
    }
    const missReasons = this.missReasonsSnapshot();
    this.lastCacheDiagnostics = {
      toolBlockHash,
      toolBlockChanged,
      injectionCount,
      messageCount,
      ...(missReasons !== undefined ? { missReasons } : {}),
    };
  }

  data(): UsageStatus {
    const byModel = this.byModelSnapshot();
    const hasByModel = Object.keys(byModel).length > 0;
    const currentTurn = this.currentTurn;
    return {
      byModel: hasByModel ? byModel : undefined,
      total: hasByModel ? totalUsage(byModel) : undefined,
      currentTurn: currentTurn === undefined ? undefined : copyUsage(currentTurn),
    };
  }

  status(): UsageStatus | undefined {
    const status = this.data();
    const neverEmpty = getSearchNeverEmptyTelemetry();
    const localResearchCache = getLocalResearchCacheTelemetry();
    const hasUsage =
      status.byModel !== undefined ||
      status.total !== undefined ||
      status.currentTurn !== undefined;
    const hasNeverEmpty =
      neverEmpty.hardFailCount > 0 || neverEmpty.softDegradeCount > 0;
    const hasLocalResearchCache =
      localResearchCache.hits > 0 || localResearchCache.misses > 0;
    if (!hasUsage && !hasNeverEmpty && !hasLocalResearchCache) {
      return undefined;
    }
    return {
      ...status,
      ...(hasUsage
        ? {
            cacheHitRate:
              status.total === undefined ? undefined : computeCacheHitRate(status.total),
            cacheWarmStreak: this.warmHitStreak > 0 ? this.warmHitStreak : undefined,
            cacheDiagnostics: this.lastCacheDiagnostics,
          }
        : {}),
      searchNeverEmpty: neverEmpty,
      ...(hasLocalResearchCache ? { localResearchCache } : {}),
    };
  }

  private recordCacheMissReasonIfNeeded(
    usage: TokenUsage,
    model: string,
    toolBlockChanged: boolean,
  ): void {
    if (inputTotal(usage) < WARM_STREAK_MIN_INPUT) return;
    const rate = computeCacheHitRate(usage);
    if (rate >= WARM_STREAK_HIT_TARGET) return;

    let reason: CacheMissReason;
    if (this.lastStepModel !== undefined && this.lastStepModel !== model) {
      reason = 'model_switch';
    } else if (toolBlockChanged) {
      reason = 'prefix_drift';
    } else {
      reason = 'schema_change';
    }
    this.missReasonCounts[reason] = (this.missReasonCounts[reason] ?? 0) + 1;
  }

  private missReasonsSnapshot(): CacheMissReasonHistogram | undefined {
    const entries = Object.entries(this.missReasonCounts).filter(
      (entry): entry is [CacheMissReason, number] =>
        typeof entry[1] === 'number' && entry[1] > 0,
    );
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }

  private updateWarmHitStreakFromTurn(turn: TokenUsage): void {
    if (inputTotal(turn) < WARM_STREAK_MIN_INPUT) return;
    const rate = computeCacheHitRate(turn);
    if (rate >= WARM_STREAK_HIT_TARGET) {
      if (!this.turnWarmStreakCounted) {
        this.warmHitStreak += 1;
        this.turnWarmStreakCounted = true;
      }
      return;
    }
    this.warmHitStreak = 0;
    this.turnWarmStreakCounted = false;
  }

  private byModelSnapshot(): Record<string, TokenUsage> {
    return Object.fromEntries(
      Object.entries(this.byModel).map(([model, usage]) => [model, copyUsage(usage)]),
    );
  }
}

function totalUsage(byModel: Record<string, TokenUsage>): TokenUsage | undefined {
  let total: TokenUsage | undefined;
  for (const usage of Object.values(byModel)) {
    total = total === undefined ? copyUsage(usage) : addUsage(total, usage);
  }
  return total;
}
