/**
 * Predictive context prefetching for latency reduction.
 *
 * Learns tool usage patterns and predicts likely next tools,
 * allowing context to be prepared in advance.
 */

export interface ToolSequencePattern {
  /** Previous tool sequence (prefix) */
  prefix: string[];
  /** Predicted next tool */
  next: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Number of times this pattern was observed */
  count: number;
}

export interface PrefetchCandidate {
  tool: string;
  confidence: number;
  suggestedContext?: string[];
}

const MAX_PATTERN_LENGTH = 5;
const MIN_PATTERN_COUNT = 2;
const CONFIDENCE_THRESHOLD = 0.3;

/**
 * Learns tool usage patterns and predicts next tools.
 */
export class ToolPatternLearner {
  private patterns: Map<string, ToolSequencePattern[]> = new Map();
  private recentTools: string[] = [];

  /**
   * Record a tool usage.
   */
  record(toolName: string): void {
    this.recentTools.push(toolName);

    // Keep only recent history
    if (this.recentTools.length > MAX_PATTERN_LENGTH * 2) {
      this.recentTools = this.recentTools.slice(-MAX_PATTERN_LENGTH);
    }

    // Update patterns for all prefix lengths
    for (let len = 1; len <= Math.min(MAX_PATTERN_LENGTH, this.recentTools.length - 1); len++) {
      const prefix = this.recentTools.slice(-len - 1, -1);
      this.updatePattern(prefix, toolName);
    }
  }

  /**
   * Update pattern counts for a prefix → next transition.
   */
  private updatePattern(prefix: string[], next: string): void {
    const key = prefix.join('→');
    const existing = this.patterns.get(key) ?? [];

    const pattern = existing.find((p) => p.next === next);
    if (pattern) {
      pattern.count++;
      // Recalculate confidence
      const totalCount = existing.reduce((sum, p) => sum + p.count, 0);
      pattern.confidence = pattern.count / totalCount;
    } else {
      const totalCount = existing.reduce((sum, p) => sum + p.count, 0) + 1;
      existing.push({
        prefix: [...prefix],
        next,
        confidence: 1 / totalCount,
        count: 1,
      });
    }

    // Normalize confidences
    const totalCount = existing.reduce((sum, p) => sum + p.count, 0);
    for (const p of existing) {
      p.confidence = p.count / totalCount;
    }

    this.patterns.set(key, existing);
  }

  /**
   * Predict likely next tools based on current sequence.
   */
  predictNext(currentSequence?: string[]): PrefetchCandidate[] {
    const sequence = currentSequence ?? this.recentTools;
    const candidates: PrefetchCandidate[] = [];

    // Try different prefix lengths
    for (let len = Math.min(MAX_PATTERN_LENGTH, sequence.length); len >= 1; len--) {
      const prefix = sequence.slice(-len);
      const key = prefix.join('→');
      const patterns = this.patterns.get(key);

      if (patterns) {
        for (const pattern of patterns) {
          if (pattern.count >= MIN_PATTERN_COUNT && pattern.confidence >= CONFIDENCE_THRESHOLD) {
            // Boost confidence for longer prefixes
            const lengthBoost = 1 + (len - 1) * 0.1;
            candidates.push({
              tool: pattern.next,
              confidence: Math.min(1, pattern.confidence * lengthBoost),
            });
          }
        }
      }
    }

    // Sort by confidence and deduplicate
    const seen = new Set<string>();
    return candidates
      .sort((a, b) => b.confidence - a.confidence)
      .filter((c) => {
        if (seen.has(c.tool)) return false;
        seen.add(c.tool);
        return true;
      })
      .slice(0, 5);
  }

  /**
   * Get pattern statistics for debugging.
   */
  getStats(): { patternCount: number; totalObservations: number } {
    let totalObservations = 0;
    for (const patterns of this.patterns.values()) {
      for (const p of patterns) {
        totalObservations += p.count;
      }
    }
    return {
      patternCount: this.patterns.size,
      totalObservations,
    };
  }

  /**
   * Reset learned patterns.
   */
  reset(): void {
    this.patterns.clear();
    this.recentTools = [];
  }
}

/**
 * Context prefetch suggestions based on predicted tools.
 */
export function getSuggestedPrefetchContext(predictedTools: PrefetchCandidate[]): string[] {
  const suggestions: string[] = [];

  for (const candidate of predictedTools) {
    switch (candidate.tool) {
      case 'Read':
      case 'LioraRead':
      case 'RepoQuery':
        suggestions.push('recently_mentioned_files');
        break;
      case 'Grep':
      case 'Glob':
        suggestions.push('search_context');
        break;
      case 'Bash':
        suggestions.push('command_history');
        break;
      case 'Edit':
      case 'Write':
        suggestions.push('edit_target_files');
        break;
      case 'WebSearch':
      case 'FetchURL':
        suggestions.push('web_context');
        break;
    }
  }

  return [...new Set(suggestions)];
}

/**
 * Create a tool pattern learner.
 */
export function createToolPatternLearner(): ToolPatternLearner {
  return new ToolPatternLearner();
}
