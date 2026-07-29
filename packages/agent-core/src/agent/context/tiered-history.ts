/**
 * Tiered conversation history for context window efficiency.
 *
 * Messages are organized into three tiers:
 * - Hot: Recent messages with full content (last N turns)
 * - Warm: Older messages with compressed content
 * - Cold: Archived messages (summary only, from compaction)
 *
 * The tier thresholds adapt based on context usage ratio.
 */

import type { ContentPart, Message } from '@superliora/kosong';
import { estimateTokens, estimateTokensForMessages } from '../../utils/tokens';

export interface TieredHistoryConfig {
  /** Number of recent messages to keep in hot tier (default: 10) */
  hotWindow?: number;
  /** Number of older messages to keep in warm tier (default: 30) */
  warmWindow?: number;
  /** Context usage ratio threshold for shrinking tiers (default: 0.8) */
  shrinkThreshold?: number;
  /** Context usage ratio threshold for expanding tiers (default: 0.5) */
  expandThreshold?: number;
}

export interface TieredHistory {
  /** Recent messages with full content */
  hot: Message[];
  /** Older messages with compressed content */
  warm: Message[];
  /** Summary of archived messages (from compaction) */
  coldSummary?: string;
}

export interface TierThresholds {
  hotWindow: number;
  warmWindow: number;
}

const DEFAULT_HOT_WINDOW = 10;
const DEFAULT_WARM_WINDOW = 30;
const DEFAULT_SHRINK_THRESHOLD = 0.8;
const DEFAULT_EXPAND_THRESHOLD = 0.5;

/**
 * Manages tiered conversation history with adaptive thresholds.
 */
export class TieredHistoryManager {
  private hotWindow: number;
  private warmWindow: number;
  private readonly shrinkThreshold: number;
  private readonly expandThreshold: number;

  constructor(config: TieredHistoryConfig = {}) {
    this.hotWindow = config.hotWindow ?? DEFAULT_HOT_WINDOW;
    this.warmWindow = config.warmWindow ?? DEFAULT_WARM_WINDOW;
    this.shrinkThreshold = config.shrinkThreshold ?? DEFAULT_SHRINK_THRESHOLD;
    this.expandThreshold = config.expandThreshold ?? DEFAULT_EXPAND_THRESHOLD;
  }

  /**
   * Adjust tier thresholds based on context usage ratio.
   */
  adjustThresholds(usageRatio: number): void {
    if (usageRatio > this.shrinkThreshold) {
      // Context pressure: shrink tiers
      this.hotWindow = Math.max(5, Math.floor(this.hotWindow * 0.7));
      this.warmWindow = Math.max(15, Math.floor(this.warmWindow * 0.7));
    } else if (usageRatio < this.expandThreshold) {
      // Context余裕: expand tiers
      this.hotWindow = Math.min(15, this.hotWindow + 1);
      this.warmWindow = Math.min(40, this.warmWindow + 2);
    }
  }

  /**
   * Get current tier thresholds.
   */
  getThresholds(): TierThresholds {
    return {
      hotWindow: this.hotWindow,
      warmWindow: this.warmWindow,
    };
  }

  /**
   * Organize messages into tiers.
   */
  organize(messages: Message[], coldSummary?: string): TieredHistory {
    const totalMessages = messages.length;

    if (totalMessages <= this.hotWindow) {
      return {
        hot: messages,
        warm: [],
        coldSummary,
      };
    }

    const hotStart = Math.max(0, totalMessages - this.hotWindow);
    const warmStart = Math.max(0, hotStart - this.warmWindow);

    const hot = messages.slice(hotStart);
    const warm = messages.slice(warmStart, hotStart).map((msg) => this.compressWarmMessage(msg));

    return {
      hot,
      warm,
      coldSummary,
    };
  }

  /**
   * Compress a message for the warm tier.
   */
  private compressWarmMessage(message: Message): Message {
    if (message.role === 'tool') {
      return this.compressToolMessage(message);
    }
    if (message.role === 'assistant') {
      return this.compressAssistantMessage(message);
    }
    // User messages are kept as-is (they contain intent)
    return message;
  }

  /**
   * Compress tool result message: extract key metrics only.
   */
  private compressToolMessage(message: Message): Message {
    const compressed = message.content.map((part) => {
      if (part.type === 'text') {
        return {
          ...part,
          text: this.extractKeyMetrics(part.text),
        };
      }
      return part;
    });

    return { ...message, content: compressed };
  }

  /**
   * Compress assistant message: keep decisions and actions only.
   */
  private compressAssistantMessage(message: Message): Message {
    const compressed = message.content.map((part) => {
      if (part.type === 'text') {
        return {
          ...part,
          text: this.extractDecisionsAndActions(part.text),
        };
      }
      // Keep think parts as-is (they contain reasoning)
      return part;
    });

    return { ...message, content: compressed };
  }

  /**
   * Extract key metrics from tool output.
   */
  private extractKeyMetrics(text: string): string {
    const lines = text.split('\n');
    const metrics: string[] = [];

    // Look for lines with numbers
    const metricPattern = /(\w+):\s*([\d.,]+)%?/;
    for (const line of lines) {
      const match = metricPattern.exec(line);
      if (match && metrics.length < 10) {
        metrics.push(line.trim());
      }
    }

    if (metrics.length === 0) {
      // Fallback: first few lines
      return lines.slice(0, 5).join('\n') + '\n... [compressed]';
    }

    return `[Compressed tool output]\n${metrics.join('\n')}`;
  }

  /**
   * Extract decisions and actions from assistant text.
   */
  private extractDecisionsAndActions(text: string): string {
    const lines = text.split('\n');
    const important: string[] = [];

    // Keywords that indicate decisions or actions
    const keywords = [
      'will', 'going to', 'plan', 'decision', 'choose', 'selected',
      'created', 'modified', 'deleted', 'fixed', 'implemented',
      'error', 'warning', 'failed', 'success',
    ];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (keywords.some((kw) => lowerLine.includes(kw))) {
        if (important.length < 10) {
          important.push(line.trim());
        }
      }
    }

    if (important.length === 0) {
      // Fallback: truncate
      const maxChars = 500;
      if (text.length <= maxChars) return text;
      return text.slice(0, maxChars) + '... [compressed]';
    }

    return `[Compressed assistant response]\n${important.join('\n')}`;
  }

  /**
   * Estimate tokens for a tiered history.
   */
  estimateTokens(tiered: TieredHistory): number {
    let total = estimateTokensForMessages(tiered.hot);
    total += estimateTokensForMessages(tiered.warm);
    if (tiered.coldSummary) {
      total += estimateTokens(tiered.coldSummary);
    }
    return total;
  }

  /**
   * Flatten tiered history back to a message array.
   */
  flatten(tiered: TieredHistory): Message[] {
    return [...tiered.warm, ...tiered.hot];
  }
}

/**
 * Create a tiered history manager with default configuration.
 */
export function createTieredHistoryManager(
  config?: TieredHistoryConfig,
): TieredHistoryManager {
  return new TieredHistoryManager(config);
}
