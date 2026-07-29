import type { CacheDiagnostics, UsageStatus } from '#/rpc';
import { addUsage, cacheHitRate as computeCacheHitRate, type TokenUsage } from '@superliora/kosong';

import type { Agent } from '..';

export type UsageRecordScope = 'session' | 'turn';

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
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export class UsageRecorder {
  private readonly byModel: Record<string, TokenUsage> = {};
  private currentTurn: TokenUsage | undefined;
  private lastToolBlockHash: string | undefined;
  private lastCacheDiagnostics: CacheDiagnostics | undefined;

  constructor(protected readonly agent?: Agent) {}

  beginTurn(): void {
    this.currentTurn = undefined;
  }

  endTurn(): void {
    this.currentTurn = undefined;
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
    }
    this.agent?.emitStatusUpdated();
  }

  /** Update cache-prefix stability diagnostics (called per step). */
  recordCacheDiagnostics(
    tools: readonly { name: string; description: string }[],
    injectionCount: number,
    messageCount: number,
  ): void {
    const toolBlockHash = hashToolBlock(tools);
    const toolBlockChanged = this.lastToolBlockHash !== undefined && this.lastToolBlockHash !== toolBlockHash;
    this.lastToolBlockHash = toolBlockHash;
    this.lastCacheDiagnostics = {
      toolBlockHash,
      toolBlockChanged,
      injectionCount,
      messageCount,
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
    if (
      status.byModel === undefined &&
      status.total === undefined &&
      status.currentTurn === undefined
    ) {
      return undefined;
    }
    return {
      ...status,
      // Session prompt-cache hit rate (0..1) derived from cumulative input
      // tokens. A byte-stable cached prefix approaches 1 at steady state; a
      // volatile segment in the prefix keeps this near 0.
      cacheHitRate: status.total === undefined ? undefined : computeCacheHitRate(status.total),
      cacheDiagnostics: this.lastCacheDiagnostics,
    };
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
