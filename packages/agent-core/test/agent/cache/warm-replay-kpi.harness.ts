import { cacheHitRate, type TokenUsage } from '@superliora/kosong';

import { buildTurnPrefixMaterial } from '#/agent/cache/cache-freeze-guard';
import { createRpcMethods } from '#/agent/rpc-methods';
import type { CacheMissReasonHistogram } from '#/rpc';

import { testAgent } from '../harness/agent';

/** Sovereign Reform W1 — default replay length (§5.3 / §12.1). */
export const WARM_REPLAY_TURN_COUNT = 50;

/** Matches UsageRecorder warm-streak gate and TUI cache meter target. */
export const WARM_HIT_TARGET = 0.99;

/** Minimum per-turn input tokens before warm-streak / miss-reason evaluation. */
export const WARM_STREAK_MIN_INPUT = 100;

const DEFAULT_REPLAY_TOOLS = ['Read', 'Grep', 'Edit', 'Bash'] as const;

export interface WarmReplayTurnMetrics {
  readonly turn: number;
  readonly hitRate: number;
  readonly meetsTarget: boolean;
  readonly usage: TokenUsage;
}

export interface WarmReplayKpiReport {
  readonly turnCount: number;
  readonly bootstrapTurns: number;
  readonly warmTurnCount: number;
  readonly warmTurnsAtTarget: number;
  readonly warmTurnPassRate: number;
  readonly sessionCacheHitRate: number | undefined;
  readonly cacheWarmStreak: number | undefined;
  readonly missReasons: CacheMissReasonHistogram | undefined;
  readonly prefixStable: boolean;
  /** True when every turn saw getCacheFrozen true after freeze and false after clear. */
  readonly freezeFlipsAcrossTurns: boolean;
  readonly turns: readonly WarmReplayTurnMetrics[];
}

export interface CacheFreezeMidTurnRatchetReport {
  readonly mutateRejected: boolean;
  readonly setActiveToolsRejected: boolean;
  readonly prefixStableAfterMutate: boolean;
  readonly freezeFlip: boolean;
}

export interface WarmReplayKpiOptions {
  readonly turnCount?: number;
  /** Cold-start turns before the warm phase (default 1). */
  readonly bootstrapTurns?: number;
  readonly tools?: readonly string[];
}

/** First turn: cache creation + partial read (sub-target hit rate). */
export function coldBootstrapStepUsage(): TokenUsage {
  return {
    inputOther: 50,
    inputCacheRead: 50,
    inputCacheCreation: 500,
    output: 10,
  };
}

/** Steady-state warm step: ≥99% cache read, no new cache writes. */
export function warmStepUsage(): TokenUsage {
  return {
    inputOther: 1,
    inputCacheRead: 199,
    inputCacheCreation: 0,
    output: 10,
  };
}

/**
 * Deterministic 50-turn coding-session replay against UsageRecorder +
 * CacheFreezeGuard + getUsage RPC — no live LLM.
 */
export function runWarmReplayKpi(options: WarmReplayKpiOptions = {}): WarmReplayKpiReport {
  const turnCount = options.turnCount ?? WARM_REPLAY_TURN_COUNT;
  const bootstrapTurns = options.bootstrapTurns ?? 1;
  const ctx = testAgent();
  ctx.configure({ tools: options.tools ?? [...DEFAULT_REPLAY_TOOLS] });

  const loopTools = ctx.agent.tools.loopTools;
  const prefixMaterial = buildTurnPrefixMaterial(ctx.agent.tools.enabledTools);
  const guard = ctx.agent.cacheFreezeGuard;
  const model = 'mock-model';
  const turns: WarmReplayTurnMetrics[] = [];
  let prefixStable = true;
  let freezeFlipsAcrossTurns = true;
  const rpc = createRpcMethods(ctx.agent);

  for (let turn = 1; turn <= turnCount; turn++) {
    guard.freeze(prefixMaterial);
    if (!rpc.getCacheFrozen({})) freezeFlipsAcrossTurns = false;
    ctx.agent.usage.beginTurn();

    const usage = turn <= bootstrapTurns ? coldBootstrapStepUsage() : warmStepUsage();

    try {
      guard.assertUnchanged(prefixMaterial, 'tool list');
    } catch {
      prefixStable = false;
    }

    ctx.agent.usage.record(model, usage, 'turn');
    ctx.agent.usage.recordCacheDiagnostics(loopTools, 0, turn, usage, model);

    const hitRate = cacheHitRate(usage);
    turns.push({
      turn,
      hitRate,
      meetsTarget: hitRate >= WARM_HIT_TARGET,
      usage,
    });

    guard.clear();
    if (rpc.getCacheFrozen({})) freezeFlipsAcrossTurns = false;
    ctx.agent.usage.endTurn();
  }

  const usageStatus = rpc.getUsage({});
  const warmTurns = turns.slice(bootstrapTurns);
  const warmTurnsAtTarget = warmTurns.filter((entry) => entry.meetsTarget).length;

  return {
    turnCount,
    bootstrapTurns,
    warmTurnCount: warmTurns.length,
    warmTurnsAtTarget,
    warmTurnPassRate: warmTurns.length === 0 ? 0 : warmTurnsAtTarget / warmTurns.length,
    sessionCacheHitRate: usageStatus.cacheHitRate,
    cacheWarmStreak: usageStatus.cacheWarmStreak,
    missReasons: usageStatus.cacheDiagnostics?.missReasons,
    prefixStable,
    freezeFlipsAcrossTurns,
    turns,
  };
}

/**
 * Mid-turn CacheFreeze sensor: mutating the tool prefix or calling setActiveTools
 * while frozen must fail; freeze must clear at the turn boundary.
 */
export function runCacheFreezeMidTurnRatchet(): CacheFreezeMidTurnRatchetReport {
  const ctx = testAgent();
  ctx.configure({ tools: [...DEFAULT_REPLAY_TOOLS] });
  const guard = ctx.agent.cacheFreezeGuard;
  const rpc = createRpcMethods(ctx.agent);
  const prefixMaterial = buildTurnPrefixMaterial(ctx.agent.tools.enabledTools);

  guard.freeze(prefixMaterial);
  const frozenAtStart = rpc.getCacheFrozen({});

  let mutateRejected = false;
  try {
    guard.assertUnchanged(`${prefixMaterial}\nWrite`, 'tool list');
  } catch {
    mutateRejected = true;
  }

  let setActiveToolsRejected = false;
  try {
    ctx.agent.tools.setActiveTools(['Read', 'Grep']);
  } catch {
    setActiveToolsRejected = true;
  }

  let prefixStableAfterMutate = true;
  try {
    guard.assertUnchanged(buildTurnPrefixMaterial(ctx.agent.tools.enabledTools), 'tool list');
  } catch {
    prefixStableAfterMutate = false;
  }

  guard.clear();
  const freezeFlip = frozenAtStart === true && rpc.getCacheFrozen({}) === false;

  return {
    mutateRejected,
    setActiveToolsRejected,
    prefixStableAfterMutate,
    freezeFlip,
  };
}

/** One-line KPI summary for script / CI logs. */
export function formatWarmReplayKpiReport(report: WarmReplayKpiReport): string {
  const warmPct = (report.warmTurnPassRate * 100).toFixed(1);
  const sessionPct =
    report.sessionCacheHitRate === undefined
      ? 'n/a'
      : `${(report.sessionCacheHitRate * 100).toFixed(1)}%`;
  const miss =
    report.missReasons === undefined
      ? '{}'
      : JSON.stringify(report.missReasons);
  return (
    `warm-replay-kpi: turns=${String(report.turnCount)} ` +
    `warm=${String(report.warmTurnsAtTarget)}/${String(report.warmTurnCount)} (${warmPct}% ≥${String(WARM_HIT_TARGET * 100)}%) ` +
    `streak×${String(report.cacheWarmStreak ?? 0)} ` +
    `sessionHit=${sessionPct} ` +
    `prefixStable=${String(report.prefixStable)} ` +
    `freezeFlip=${String(report.freezeFlipsAcrossTurns)} ` +
    `missReasons=${miss}`
  );
}
