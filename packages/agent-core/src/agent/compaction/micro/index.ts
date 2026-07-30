import type { ContentPart } from '@superliora/kosong';

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Agent } from '../..';
import type { ContextMessage } from '../../context';
import {
  estimateTokensForContentParts,
  estimateTokensForMessages,
} from '../../../utils/tokens';
import { buildToolOutputReceipt } from '../../turn/tool-result-budget';
import {
  computeFamilyBudgetOverflowToolCallIds,
  contentPreview,
  findLatestSwarmToolCallId,
  isKnownMutatingTool,
  isStatefulOrMutatingTool,
  maskSwarmToolResultIfStale,
  pruneClearedReceipts,
  toolNameForMessage,
  truncateForMarker,
} from './micro-helpers';
import {
  DEFAULT_MICRO_WORKING_SET_TOKENS,
  microPressureThresholdTokens,
} from '../strategy';

export interface MicroCompactionConfig {
  keepRecentMessages: number;
  minContentTokens: number;
  cacheMissedThresholdMs: number;
  truncatedMarker: string;
  minContextUsageRatio: number;
  /**
   * Soft ceiling (tokens) for micro pressure. When the model window exceeds
   * this, micro clearing arms at min(ratio * window, maxWorkingSetTokens)
   * instead of waiting for 40% of a 1M window. `0` disables the cap.
   */
  maxWorkingSetTokens: number;
}

export interface MicroCompactionPolicyDecision {
  readonly action: 'clear' | 'preserve';
  readonly reason:
    | 'error_result'
    | 'known_mutating_tool'
    | 'content_below_threshold'
    | 'marker_not_smaller'
    | 'replayable_tool_result'
    /** Older than the per-tool-name family keep budget (AC-B2). */
    | 'family_budget_overflow';
}

/**
 * Keep at most this many non-mutating tool results per tool name inside the
 * micro-clearable window; older same-family results clear first (AC-B2).
 */
export const MICRO_TOOL_RESULT_FAMILY_KEEP = 3;
export const MICRO_TOOL_RESULT_FAMILY_KEEP_LOW_PRESSURE = 6;

export function resolveMicroToolResultFamilyKeep(
  compactableTokens: number,
  maxWorkingSetTokens: number,
): number {
  if (!Number.isFinite(compactableTokens) || compactableTokens < 0) {
    return MICRO_TOOL_RESULT_FAMILY_KEEP;
  }
  if (!Number.isFinite(maxWorkingSetTokens) || maxWorkingSetTokens <= 0) {
    return MICRO_TOOL_RESULT_FAMILY_KEEP;
  }
  return compactableTokens < maxWorkingSetTokens * 0.5
    ? MICRO_TOOL_RESULT_FAMILY_KEEP_LOW_PRESSURE
    : MICRO_TOOL_RESULT_FAMILY_KEEP;
}

/** Defaults favor tool-result clearing as the primary context mechanism (cheap, reversible). */
const DEFAULT_CONFIG: MicroCompactionConfig = {
  keepRecentMessages: 2,
  minContentTokens: 4,
  cacheMissedThresholdMs: 60 * 60 * 1000,
  truncatedMarker: '[Old tool result content cleared]',
  // Fire once usage is meaningful; full compaction still waits for triggerRatio.
  // Keep window short so long sessions clear bulky tool output before soft-trigger.
  // On 1M windows the 0.40 ratio alone waits until ~400k; maxWorkingSetTokens
  // pulls micro pressure back near ~140k (reversible clearing before full summarize).
  minContextUsageRatio: 0.40,
  maxWorkingSetTokens: DEFAULT_MICRO_WORKING_SET_TOKENS,
};

export type MicroTriggerKind =
  | 'usage_pressure'
  | 'cache_miss'
  | 'usage_and_cache_miss'
  | 'swarm_pressure';

export interface MicroTriggerDashboard {
  readonly total: number;
  readonly byTrigger: Readonly<Record<string, number>>;
  readonly lastTrigger: MicroTriggerKind | null;
  readonly lastContextUsageRatio: number | null;
}

/** Rolling micro-compaction trigger counters for harness dashboards. */
export class MicroTriggerTracker {
  private readonly counts = new Map<string, number>();
  private lastTrigger: MicroTriggerKind | null = null;
  private lastContextUsageRatio: number | null = null;
  private total = 0;

  record(trigger: MicroTriggerKind, contextUsageRatio: number): void {
    this.total += 1;
    this.counts.set(trigger, (this.counts.get(trigger) ?? 0) + 1);
    this.lastTrigger = trigger;
    this.lastContextUsageRatio = contextUsageRatio;
  }

  snapshot(): MicroTriggerDashboard {
    const byTrigger: Record<string, number> = {};
    for (const [key, value] of this.counts) {
      byTrigger[key] = value;
    }
    return {
      total: this.total,
      byTrigger,
      lastTrigger: this.lastTrigger,
      lastContextUsageRatio: this.lastContextUsageRatio,
    };
  }

  reset(): void {
    this.counts.clear();
    this.lastTrigger = null;
    this.lastContextUsageRatio = null;
    this.total = 0;
  }
}

export class MicroCompaction {
  readonly triggers = new MicroTriggerTracker();
  private cutoff = 0;
  readonly config: MicroCompactionConfig;

  constructor(
    public readonly agent: Agent,
    config?: Partial<MicroCompactionConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  reset(maxCutoff = 0): void {
    this.cutoff = Math.min(this.cutoff, maxCutoff);
  }

  apply(cutoff: number): void {
    this.agent.records.logRecord({
      type: 'micro_compaction.apply',
      cutoff,
    });
    // `cutoff` is the absolute index up to which the clearable window has
    // been removed. It is monotonically increasing within a session: a
    // smaller value would un-mask history items that were already
    // micro-cleared (and therefore no longer recoverable from the model's
    // perspective), letting the LLM see the same content twice. Clamp
    // negatives (defensive — detection logic should not pass a negative
    // value) and never let the new cutoff regress behind the previous one.
    const safe = cutoff < 0 ? 0 : cutoff;
    this.cutoff = safe > this.cutoff ? safe : this.cutoff;
  }

  detect(): void {
    if (!this.agent.experimentalFlags.enabled('micro_compaction')) return;

    // Primary: usage pressure when max_context_tokens is known (tool-result
    // clearing is cheaper than full compaction). Without a known window size,
    // fall back to the cache-miss secondary path only.
    // Large windows also honor maxWorkingSetTokens so micro clears near ~140k
    // instead of waiting for 40% of a 1M advertised window.
    const usagePressure = this.hasUsagePressure();
    const cacheMissed = this.isCacheMissed();
    if (!usagePressure && !cacheMissed) return;

    const trigger =
      usagePressure && cacheMissed
        ? 'usage_and_cache_miss'
        : usagePressure
          ? 'usage_pressure'
          : 'cache_miss';
    this.applyPressureCutoff(this.agent.context.history.length, trigger);
  }

  /**
   * Projection-time trimming under context pressure (e.g. during UltraSwarm).
   * Skips the cache-miss gate so high usage can be relieved without full compaction.
   */
  detectUnderSwarmPressure(minUsageRatio: number): void {
    if (!this.agent.experimentalFlags.enabled('micro_compaction')) return;
    if (!this.hasUsagePressure(minUsageRatio)) return;
    this.applyPressureCutoff(this.agent.context.history.length, 'swarm_pressure');
  }

  private contextUsageRatio(): number {
    const maxContextTokens = this.agent.config.modelCapabilities.max_context_tokens;
    const contextTokens = this.agent.context.tokenCountWithPending;
    if (maxContextTokens === undefined || maxContextTokens <= 0) return 1;
    return contextTokens / maxContextTokens;
  }

  /**
   * True when live context has crossed the micro pressure threshold.
   * Threshold = min(ratio * window, maxWorkingSetTokens) when a cap is set.
   */
  private hasUsagePressure(minUsageRatio = this.config.minContextUsageRatio): boolean {
    const maxContextTokens = this.agent.config.modelCapabilities.max_context_tokens;
    if (maxContextTokens === undefined || maxContextTokens <= 0) return false;
    const contextTokens = this.agent.context.tokenCountWithPending;
    const threshold = microPressureThresholdTokens({
      maxContextTokens,
      minContextUsageRatio: minUsageRatio,
      maxWorkingSetTokens: this.config.maxWorkingSetTokens,
    });
    return threshold > 0 && contextTokens >= threshold;
  }

  private isCacheMissed(): boolean {
    const { lastAssistantAt } = this.agent.context;
    if (lastAssistantAt === null) return false;
    return Date.now() - lastAssistantAt >= this.config.cacheMissedThresholdMs;
  }

  private applyPressureCutoff(
    historyLength: number,
    trigger: 'usage_pressure' | 'cache_miss' | 'usage_and_cache_miss' | 'swarm_pressure' = 'usage_pressure',
  ): void {
    const config = this.config;
    const { history, lastAssistantAt } = this.agent.context;
    const contextUsageRatio = this.contextUsageRatio();
    // Cache-miss secondary path may still clear without ratio pressure, but the
    // usage/swarm paths require the (possibly capped) token threshold.
    if (trigger !== 'cache_miss' && !this.hasUsagePressure()) return;

    const previousCutoff = this.cutoff;
    const nextCutoff = Math.max(0, historyLength - config.keepRecentMessages);
    this.apply(nextCutoff);
    if (previousCutoff !== nextCutoff) {
      const cacheAgeMs = lastAssistantAt === null ? null : Date.now() - lastAssistantAt;
      const effect = this.measureEffect(history, nextCutoff);
      const previousEffect = this.measureEffect(history, previousCutoff);
      const rawContextTokens = estimateTokensForMessages(history);
      // Whole-context length before/after this cutoff change, mirroring the
      // `tokens_before`/`tokens_after` fields on `compaction_finished` so the
      // two compaction paths can be compared on the same axis.
      const tokensBefore =
        rawContextTokens -
        previousEffect.truncatedToolResultTokensBefore +
        previousEffect.truncatedToolResultTokensAfter;
      const tokensAfter =
        rawContextTokens -
        effect.truncatedToolResultTokensBefore +
        effect.truncatedToolResultTokensAfter;
      this.triggers.record(trigger, contextUsageRatio);
      const dashboard = this.triggers.snapshot();
      this.agent.telemetry.track('micro_compaction_finished', {
        keep_recent_messages: config.keepRecentMessages,
        min_content_tokens: config.minContentTokens,
        cache_missed_threshold_ms: config.cacheMissedThresholdMs,
        truncated_marker: config.truncatedMarker,
        min_context_usage_ratio: config.minContextUsageRatio,
        truncated_tool_result_count: effect.truncatedToolResultCount,
        truncated_tool_result_tokens_before: effect.truncatedToolResultTokensBefore,
        truncated_tool_result_tokens_after: effect.truncatedToolResultTokensAfter,
        micro_policy_reason: effect.clearedPolicyReasons.join(','),
        micro_trigger: trigger,
        micro_trigger_total: dashboard.total,
        micro_trigger_counts: Object.entries(dashboard.byTrigger)
          .map(([name, count]) => `${name}:${String(count)}`)
          .join(','),
        context_usage_ratio: contextUsageRatio,
        tokens_before: tokensBefore,
        tokens_after: tokensAfter,
        previous_cutoff: previousCutoff,
        cutoff: nextCutoff,
        message_count: history.length,
        cache_age_ms: cacheAgeMs,
        thinking_level: this.agent.config.thinkingLevel,
      });
      // Live footer/status: surface micro-trigger dashboard after tool-result clearing.
      this.agent.emitStatusUpdated();
    }
  }

  compact(messages: readonly ContextMessage[]): readonly ContextMessage[] {
    if (!this.agent.experimentalFlags.enabled('micro_compaction')) return messages;

    const latestSwarmToolCallId = findLatestSwarmToolCallId(messages);
    const highValueReplayKeep = resolveMicroToolResultFamilyKeep(
      estimateTokensForMessages(messages.slice(0, this.cutoff)),
      this.config.maxWorkingSetTokens,
    );
    const familyOverflowIds = computeFamilyBudgetOverflowToolCallIds(
      messages,
      this.cutoff,
      MICRO_TOOL_RESULT_FAMILY_KEEP,
      highValueReplayKeep,
    );
    const result: ContextMessage[] = [];
    let i = 0;
    for (const msg of messages) {
      if (
        i < this.cutoff &&
        msg.role === 'tool' &&
        msg.toolCallId !== undefined
      ) {
        const swarmMasked = maskSwarmToolResultIfStale(msg, messages, latestSwarmToolCallId);
        if (swarmMasked !== null) {
          result.push(swarmMasked);
          i++;
          continue;
        }
      }
      if (
        i < this.cutoff &&
        msg.role === 'tool' &&
        msg.toolCallId !== undefined &&
        this.decideToolResultPolicy(msg, messages, familyOverflowIds).action === 'clear'
      ) {
        result.push({
          ...msg,
          content: [
            {
              type: 'text',
              text: this.markerFor(msg, messages, familyOverflowIds),
            } satisfies ContentPart,
          ],
        });
      } else {
        result.push(msg);
      }
      i++;
    }
    return result;
  }

  private measureEffect(
    messages: readonly ContextMessage[],
    cutoff: number,
  ) {
    let truncatedToolResultCount = 0;
    let truncatedToolResultTokensBefore = 0;
    let truncatedToolResultTokensAfter = 0;
    const clearedPolicyReasons = new Set<MicroCompactionPolicyDecision['reason']>();
    const highValueReplayKeep = resolveMicroToolResultFamilyKeep(
      estimateTokensForMessages(messages.slice(0, cutoff)),
      this.config.maxWorkingSetTokens,
    );
    const familyOverflowIds = computeFamilyBudgetOverflowToolCallIds(
      messages,
      cutoff,
      MICRO_TOOL_RESULT_FAMILY_KEEP,
      highValueReplayKeep,
    );
    for (let i = 0; i < messages.length && i < cutoff; i++) {
      const message = messages[i];
      if (message?.role !== 'tool' || message.toolCallId === undefined) continue;

      const decision = this.decideToolResultPolicy(message, messages, familyOverflowIds);
      if (decision.action !== 'clear') continue;

      const contentTokens = estimateTokensForContentParts(message.content);
      const markerTokenCount = this.markerTokenCount(message, messages);
      truncatedToolResultCount += 1;
      truncatedToolResultTokensBefore += contentTokens;
      truncatedToolResultTokensAfter += markerTokenCount;
      clearedPolicyReasons.add(decision.reason);
    }
    return {
      truncatedToolResultCount,
      truncatedToolResultTokensBefore,
      truncatedToolResultTokensAfter,
      clearedPolicyReasons: Array.from(clearedPolicyReasons).toSorted(),
    };
  }

  private markerFor(
    message: ContextMessage,
    messages: readonly ContextMessage[],
    familyOverflowIds: ReadonlySet<string> = new Set(),
  ): string {
    const tokenCount = estimateTokensForContentParts(message.content);
    const preview = contentPreview(message.content);
    const policyReason = this.decideToolResultPolicy(message, messages, familyOverflowIds).reason;
    return this.renderMarker(message, messages, policyReason, tokenCount, preview);
  }

  private renderMarker(
    message: ContextMessage,
    messages: readonly ContextMessage[],
    policyReason: MicroCompactionPolicyDecision['reason'],
    tokenCount = estimateTokensForContentParts(message.content),
    preview = contentPreview(message.content),
  ): string {
    const toolCallId = message.toolCallId ?? 'unknown';
    const toolName = this.toolNameFor(toolCallId, messages) ?? 'unknown';
    const lines = [
      this.config.truncatedMarker,
      `toolCallId=${toolCallId}`,
      `toolName=${toolName}`,
      `tokensBeforeClearing=${String(tokenCount)}`,
      `isError=${message.isError === true ? 'true' : 'false'}`,
      `policyReason=${policyReason}`,
      'rawResult=replay',
      `preview=${preview}`,
    ];
    const fullText = message.content
      .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    // Archive ids come from the context-archive marker; keep them recoverable
    // across micro-compaction so LioraExpand still works on cleared results.
    const archiveId = /\[liora-archived id=([a-f0-9]{12})\]/u.exec(fullText)?.[1];
    if (archiveId !== undefined) {
      lines.push(`archiveId=${archiveId}`);
      lines.push('recover=LioraExpand');
    } else if (policyReason === 'family_budget_overflow') {
      // Harness reform T1-4: a family-overflow clear used to destroy the
      // payload outright. Persist it under the Liora home and leave a
      // receipt so the cleared output stays recoverable via line-ranged
      // Read instead of forcing a blind re-run.
      const receipt = this.persistClearedReceipt(fullText, toolCallId, toolName);
      if (receipt !== undefined) lines.push(receipt);
    }
    return lines.join('\n');
  }

  private persistClearedReceipt(
    fullText: string,
    toolCallId: string,
    toolName: string,
  ): string | undefined {
    const homedir = this.agent.homedir;
    if (homedir === undefined || fullText.trim().length === 0) return undefined;
    try {
      const dir = join(homedir, 'tool-results');
      mkdirSync(dir, { recursive: true });
      const receipt = buildToolOutputReceipt({
        tool: toolName,
        path: `tool-call/${toolCallId}`,
        text: fullText,
      });
      const stem = toolName.replace(/[^\w-]+/gu, '_');
      const file = join(dir, `cleared-${stem}-${receipt.sha256.slice(0, 12)}.txt`);
      writeFileSync(file, fullText);
      pruneClearedReceipts(dir);
      return [
        `receipt=${file}`,
        `sha256=${receipt.sha256}`,
        `captured_at=${receipt.captured_at}`,
        `summary1=${receipt.summary1}`,
        'recover=Read the receipt path (line-ranged) to restore the cleared output',
      ].join('\n');
    } catch {
      return undefined;
    }
  }

  private decideToolResultPolicy(
    message: ContextMessage,
    messages: readonly ContextMessage[],
    familyOverflowIds: ReadonlySet<string> = new Set(),
  ): MicroCompactionPolicyDecision {
    if (message.isError === true) {
      return { action: 'preserve', reason: 'error_result' };
    }

    const toolName = this.toolNameFor(message.toolCallId ?? '', messages);
    if (toolName !== undefined && isKnownMutatingTool(toolName)) {
      return { action: 'preserve', reason: 'known_mutating_tool' };
    }

    const contentTokens = estimateTokensForContentParts(message.content);
    if (contentTokens < this.config.minContentTokens) {
      return { action: 'preserve', reason: 'content_below_threshold' };
    }

    if (this.markerTokenCount(message, messages, familyOverflowIds) >= contentTokens) {
      return { action: 'preserve', reason: 'marker_not_smaller' };
    }

    const toolCallId = message.toolCallId;
    if (toolCallId !== undefined && familyOverflowIds.has(toolCallId)) {
      return { action: 'clear', reason: 'family_budget_overflow' };
    }

    return { action: 'clear', reason: 'replayable_tool_result' };
  }

  private markerTokenCount(
    message: ContextMessage,
    messages: readonly ContextMessage[],
    familyOverflowIds: ReadonlySet<string> = new Set(),
  ): number {
    const reason =
      message.toolCallId !== undefined && familyOverflowIds.has(message.toolCallId)
        ? 'family_budget_overflow'
        : 'replayable_tool_result';
    return estimateTokensForContentParts([
      {
        type: 'text',
        text: this.renderMarker(message, messages, reason),
      },
    ]);
  }

  private toolNameFor(
    toolCallId: string,
    messages: readonly ContextMessage[],
  ): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const match = messages[i]?.toolCalls.find((toolCall) => toolCall.id === toolCallId);
      if (match !== undefined) return match.name;
    }
    return undefined;
  }
}

export { computeFamilyBudgetOverflowToolCallIds, isStatefulOrMutatingTool } from './micro-helpers';
