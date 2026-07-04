import type { ContentPart } from '@superliora/kosong';

import type { Agent } from '..';
import type { ContextMessage } from '../context';
import {
  estimateTokensForContentParts,
  estimateTokensForMessages,
} from '../../utils/tokens';

export interface MicroCompactionConfig {
  keepRecentMessages: number;
  minContentTokens: number;
  cacheMissedThresholdMs: number;
  truncatedMarker: string;
  minContextUsageRatio: number;
}

export interface MicroCompactionPolicyDecision {
  readonly action: 'clear' | 'preserve';
  readonly reason:
    | 'error_result'
    | 'known_mutating_tool'
    | 'content_below_threshold'
    | 'marker_not_smaller'
    | 'replayable_tool_result';
}

const DEFAULT_CONFIG: MicroCompactionConfig = {
  keepRecentMessages: 20,
  minContentTokens: 100,
  cacheMissedThresholdMs: 60 * 60 * 1000,
  truncatedMarker: '[Old tool result content cleared]',
  minContextUsageRatio: 0.5,
};

export class MicroCompaction {
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
    this.cutoff = cutoff;
  }

  detect(): void {
    if (!this.agent.experimentalFlags.enabled('micro_compaction')) return;

    const config = this.config;
    const { history, lastAssistantAt } = this.agent.context;
    const cacheAgeMs = lastAssistantAt === null ? null : Date.now() - lastAssistantAt;
    const cacheMissed = cacheAgeMs !== null && cacheAgeMs >= config.cacheMissedThresholdMs;
    if (!cacheMissed) return;

    const maxContextTokens = this.agent.config.modelCapabilities.max_context_tokens;
    const contextTokens = this.agent.context.tokenCountWithPending;
    const contextUsageRatio =
      maxContextTokens !== undefined && maxContextTokens > 0
        ? contextTokens / maxContextTokens
        : 1;
    if (contextUsageRatio < config.minContextUsageRatio) return;

    const previousCutoff = this.cutoff;
    const nextCutoff = Math.max(0, history.length - config.keepRecentMessages);
    this.apply(nextCutoff);
    if (previousCutoff !== nextCutoff) {
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
        tokens_before: tokensBefore,
        tokens_after: tokensAfter,
        previous_cutoff: previousCutoff,
        cutoff: nextCutoff,
        message_count: history.length,
        cache_age_ms: cacheAgeMs,
        thinking_level: this.agent.config.thinkingLevel,
      });
    }
  }

  compact(messages: readonly ContextMessage[]): readonly ContextMessage[] {
    if (!this.agent.experimentalFlags.enabled('micro_compaction')) return messages;

    const result: ContextMessage[] = [];
    let i = 0;
    for (const msg of messages) {
      if (
        i < this.cutoff &&
        msg.role === 'tool' &&
        msg.toolCallId !== undefined &&
        this.decideToolResultPolicy(msg, messages).action === 'clear'
      ) {
        result.push({
          ...msg,
          content: [
            {
              type: 'text',
              text: this.markerFor(msg, messages),
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
    for (let i = 0; i < messages.length && i < cutoff; i++) {
      const message = messages[i];
      if (message?.role !== 'tool' || message.toolCallId === undefined) continue;

      const decision = this.decideToolResultPolicy(message, messages);
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
  ): string {
    const tokenCount = estimateTokensForContentParts(message.content);
    const preview = contentPreview(message.content);
    const policyReason = this.decideToolResultPolicy(message, messages).reason;
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
    return [
      this.config.truncatedMarker,
      `toolCallId=${toolCallId}`,
      `toolName=${toolName}`,
      `tokensBeforeClearing=${String(tokenCount)}`,
      `isError=${message.isError === true ? 'true' : 'false'}`,
      `policyReason=${policyReason}`,
      'rawResult=replay',
      `preview=${preview}`,
    ].join('\n');
  }

  private decideToolResultPolicy(
    message: ContextMessage,
    messages: readonly ContextMessage[],
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

    if (this.markerTokenCount(message, messages) >= contentTokens) {
      return { action: 'preserve', reason: 'marker_not_smaller' };
    }

    return { action: 'clear', reason: 'replayable_tool_result' };
  }

  private markerTokenCount(
    message: ContextMessage,
    messages: readonly ContextMessage[],
  ): number {
    return estimateTokensForContentParts([
      {
        type: 'text',
        text: this.renderMarker(message, messages, 'replayable_tool_result'),
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

function contentPreview(parts: readonly ContentPart[]): string {
  return parts.map((part) => truncateForMarker(contentPartPreview(part), 80)).join('\n').trim();
}

function contentPartPreview(part: ContentPart): string {
  if (part.type === 'text') return part.text;
  if (part.type === 'image_url') return mediaPartPreview('image_url', part.imageUrl);
  if (part.type === 'audio_url') return mediaPartPreview('audio_url', part.audioUrl);
  if (part.type === 'video_url') return mediaPartPreview('video_url', part.videoUrl);
  return `[${part.type}]`;
}

function mediaPartPreview(
  type: string,
  media: { readonly id?: string; readonly url?: string },
): string {
  const details = [
    media.id === undefined ? undefined : `id=${media.id}`,
    media.url === undefined ? undefined : `url=${media.url}`,
  ].filter((item): item is string => item !== undefined);
  return `[${type}${details.length > 0 ? ` ${details.join(' ')}` : ''}]`;
}

function truncateForMarker(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

const KNOWN_MUTATING_TOOLS = new Set([
  'Agent',
  'AgentSwarm',
  'Bash',
  'CronCreate',
  'CronDelete',
  'Edit',
  'EnterPlanMode',
  'ExitPlanMode',
  'Memory',
  'NextPhase',
  'SetGoalBudget',
  'Skill',
  'TaskStop',
  'TodoList',
  'UltraSwarm',
  'UpdateGoal',
  'Write',
]);

function isKnownMutatingTool(toolName: string): boolean {
  return KNOWN_MUTATING_TOOLS.has(toolName);
}
