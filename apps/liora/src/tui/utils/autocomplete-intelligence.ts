/**
 * AutocompleteIntelligence — context-aware suggestion ranking and prediction.
 *
 * Enhances the base autocomplete system with:
 * - Usage pattern learning (frequency + recency scoring)
 * - Context-aware ranking (agent state, active tools, file context)
 * - Inline ghost text prediction (next likely command/argument)
 * - Semantic grouping (recent files, project structure awareness)
 * - Adaptive trigger thresholds (don't spam suggestions)
 *
 * This module sits between the raw AutocompleteProvider and the UI,
 * re-ranking and augmenting suggestions based on learned patterns.
 *
 * Pure logic module — no rendering, no TUI state dependency.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionContext {
  /** Current working directory. */
  readonly cwd: string;
  /** Recently accessed file paths (most recent first). */
  readonly recentFiles: readonly string[];
  /** Currently open/edited files. */
  readonly openFiles: readonly string[];
  /** Agent state for context-aware boosts. */
  readonly agentState: AgentCompletionState;
  /** Current input line content. */
  readonly inputLine: string;
  /** Cursor position in the input line. */
  readonly cursorCol: number;
  /** Whether we're in a slash command context. */
  readonly isSlashCommand: boolean;
  /** The slash command name if applicable. */
  readonly slashCommandName?: string;
}

export type AgentCompletionState =
  | 'idle'
  | 'streaming'
  | 'tool-running'
  | 'waiting-approval'
  | 'error';

export interface ScoredSuggestion {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly score: number;
  readonly reasons: string[];
}

export interface GhostPrediction {
  readonly text: string;
  readonly confidence: number;
  readonly source: 'history' | 'pattern' | 'context';
}

export interface UsagePattern {
  readonly input: string;
  readonly completion: string;
  readonly timestamp: number;
  readonly count: number;
}

export interface AutocompleteIntelligenceOptions {
  /** Maximum usage patterns to remember. Default: 200. */
  readonly maxPatterns?: number;
  /** Minimum confidence for ghost text (0-1). Default: 0.7. */
  readonly ghostConfidenceThreshold?: number;
  /** Recency half-life in ms. Default: 15 minutes. */
  readonly recencyHalfLifeMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PATTERNS = 200;
const DEFAULT_GHOST_CONFIDENCE = 0.7;
const DEFAULT_RECENCY_HALF_LIFE = 15 * 60 * 1000;

/** Score weights for suggestion ranking. */
const WEIGHT_FREQUENCY = 0.25;
const WEIGHT_RECENCY = 0.35;
const WEIGHT_CONTEXT = 0.25;
const WEIGHT_STRUCTURE = 0.15;

/** Context boosts: which completions are more relevant in each state. */
const STATE_BOOSTS: Record<AgentCompletionState, ReadonlySet<string>> = {
  idle: new Set(['config', 'theme', 'help', 'session', 'memory', 'model']),
  streaming: new Set(['stop', 'cancel', 'compact', 'status']),
  'tool-running': new Set(['stop', 'cancel', 'status', 'diff']),
  'waiting-approval': new Set(['approve', 'deny', 'permissions']),
  error: new Set(['undo', 'log', 'status', 'help']),
};

// ---------------------------------------------------------------------------
// AutocompleteIntelligence
// ---------------------------------------------------------------------------

export class AutocompleteIntelligence {
  private patterns: Map<string, UsagePattern> = new Map();
  private readonly maxPatterns: number;
  private readonly ghostThreshold: number;
  private readonly recencyHalfLife: number;

  constructor(options?: AutocompleteIntelligenceOptions) {
    this.maxPatterns = options?.maxPatterns ?? DEFAULT_MAX_PATTERNS;
    this.ghostThreshold = options?.ghostConfidenceThreshold ?? DEFAULT_GHOST_CONFIDENCE;
    this.recencyHalfLife = options?.recencyHalfLifeMs ?? DEFAULT_RECENCY_HALF_LIFE;
  }

  // ─── Learning ─────────────────────────────────────────────────────

  /** Record a completion usage for learning. */
  recordCompletion(input: string, completion: string, now: number = Date.now()): void {
    const key = `${input}\u0000${completion}`;
    const existing = this.patterns.get(key);

    if (existing) {
      this.patterns.set(key, {
        ...existing,
        timestamp: now,
        count: existing.count + 1,
      });
    } else {
      this.patterns.set(key, { input, completion, timestamp: now, count: 1 });
      this.evictIfNeeded();
    }
  }

  /** Record a file access for context awareness. */
  recordFileAccess(path: string, now: number = Date.now()): void {
    // Store as a pattern with special prefix
    const key = `@file\u0000${path}`;
    const existing = this.patterns.get(key);
    if (existing) {
      this.patterns.set(key, { ...existing, timestamp: now, count: existing.count + 1 });
    } else {
      this.patterns.set(key, { input: '@file', completion: path, timestamp: now, count: 1 });
    }
  }

  // ─── Ranking ──────────────────────────────────────────────────────

  /**
   * Re-rank suggestions based on learned patterns and context.
   * Returns suggestions sorted by composite score.
   */
  rankSuggestions(
    suggestions: ReadonlyArray<{ value: string; label: string; description?: string }>,
    context: CompletionContext,
    now: number = Date.now(),
  ): ScoredSuggestion[] {
    return suggestions
      .map((s) => this.scoreSuggestion(s.value, s.label, s.description, context, now))
      .sort((a, b) => b.score - a.score);
  }

  /** Score a single suggestion. */
  private scoreSuggestion(
    value: string,
    label: string,
    description: string | undefined,
    context: CompletionContext,
    now: number,
  ): ScoredSuggestion {
    const reasons: string[] = [];

    // Frequency score (from usage patterns)
    const frequencyScore = this.computeFrequencyScore(value, context.inputLine);
    if (frequencyScore > 0.3) reasons.push('frequent');

    // Recency score
    const recencyScore = this.computeRecencyScore(value, now);
    if (recencyScore > 0.3) reasons.push('recent');

    // Context score (agent state relevance)
    const contextScore = this.computeContextScore(value, context);
    if (contextScore > 0) reasons.push(`ctx:${context.agentState}`);

    // Structure score (file path relevance)
    const structureScore = this.computeStructureScore(value, context);
    if (structureScore > 0.3) reasons.push('structure');

    const score =
      frequencyScore * WEIGHT_FREQUENCY +
      recencyScore * WEIGHT_RECENCY +
      contextScore * WEIGHT_CONTEXT +
      structureScore * WEIGHT_STRUCTURE;

    return { value, label, description, score, reasons };
  }

  // ─── Ghost Text Prediction ────────────────────────────────────────

  /**
   * Predict the most likely completion for inline ghost text.
   * Returns null if confidence is below threshold.
   */
  predictGhostText(context: CompletionContext, now: number = Date.now()): GhostPrediction | null {
    const input = context.inputLine.slice(0, context.cursorCol);

    // Look for matching patterns
    let bestMatch: { completion: string; confidence: number; source: GhostPrediction['source'] } | null = null;

    for (const pattern of this.patterns.values()) {
      if (pattern.input === '@file') continue; // Skip file patterns

      // Check if input matches pattern prefix
      if (input.startsWith(pattern.input) && pattern.input.length > 0) {
        const remaining = pattern.completion;
        const confidence = this.computePatternConfidence(pattern, now);

        if (confidence > (bestMatch?.confidence ?? 0) && confidence >= this.ghostThreshold) {
          bestMatch = {
            completion: remaining,
            confidence,
            source: pattern.count > 3 ? 'history' : 'pattern',
          };
        }
      }
    }

    // Context-based prediction
    if (!bestMatch && context.isSlashCommand && context.slashCommandName) {
      const contextPrediction = this.predictFromContext(context);
      if (contextPrediction && contextPrediction.confidence >= this.ghostThreshold) {
        bestMatch = { completion: contextPrediction.text, confidence: contextPrediction.confidence, source: contextPrediction.source };
      }
    }

    if (!bestMatch) return null;

    // Return only the suffix (what comes after current input)
    const suffix = bestMatch.completion.startsWith(input)
      ? bestMatch.completion.slice(input.length)
      : bestMatch.completion;

    if (suffix.length === 0) return null;

    return {
      text: suffix,
      confidence: bestMatch.confidence,
      source: bestMatch.source,
    };
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Get recently used completions for a given input prefix. */
  getRecentCompletions(inputPrefix: string, limit: number, now: number = Date.now()): string[] {
    return [...this.patterns.values()]
      .filter((p) => p.input.startsWith(inputPrefix) && p.input !== '@file')
      .map((p) => ({
        completion: p.completion,
        score: p.count * decayFactor(now - p.timestamp, this.recencyHalfLife),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((p) => p.completion);
  }

  /** Get recently accessed files. */
  getRecentFiles(limit: number, now: number = Date.now()): string[] {
    return [...this.patterns.values()]
      .filter((p) => p.input === '@file')
      .map((p) => ({
        path: p.completion,
        score: p.count * decayFactor(now - p.timestamp, this.recencyHalfLife),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((p) => p.path);
  }

  /** Serialize state for persistence. */
  serialize(): string {
    return JSON.stringify([...this.patterns.values()]);
  }

  /** Restore state from serialized data. */
  static deserialize(data: string, options?: AutocompleteIntelligenceOptions): AutocompleteIntelligence {
    const intelligence = new AutocompleteIntelligence(options);
    try {
      const patterns = JSON.parse(data) as UsagePattern[];
      for (const pattern of patterns) {
        if (pattern.input && pattern.completion) {
          intelligence.patterns.set(`${pattern.input}\u0000${pattern.completion}`, pattern);
        }
      }
    } catch {
      // Ignore corrupt data
    }
    return intelligence;
  }

  /** Clear all learned patterns. */
  clear(): void {
    this.patterns.clear();
  }

  get patternCount(): number {
    return this.patterns.size;
  }

  // ─── Internal: Scoring ────────────────────────────────────────────

  private computeFrequencyScore(value: string, inputLine: string): number {
    const key = `${inputLine}\u0000${value}`;
    const pattern = this.patterns.get(key);
    if (!pattern) return 0;
    // Log-scaled to prevent dominance
    return Math.log2(1 + pattern.count) / Math.log2(1 + 50);
  }

  private computeRecencyScore(value: string, now: number): number {
    let bestRecency = 0;
    for (const pattern of this.patterns.values()) {
      if (pattern.completion === value) {
        const recency = decayFactor(now - pattern.timestamp, this.recencyHalfLife);
        bestRecency = Math.max(bestRecency, recency);
      }
    }
    return bestRecency;
  }

  private computeContextScore(value: string, context: CompletionContext): number {
    const boosts = STATE_BOOSTS[context.agentState];
    const lowerValue = value.toLowerCase();

    // Check if value matches any context-boosted command
    for (const boosted of boosts) {
      if (lowerValue.includes(boosted)) return 1;
    }

    // File context: boost files that are currently open
    if (context.openFiles.length > 0) {
      for (const openFile of context.openFiles) {
        if (value.includes(openFile) || openFile.includes(value)) return 0.5;
      }
    }

    return 0;
  }

  private computeStructureScore(value: string, context: CompletionContext): number {
    // Boost files in the same directory as recent files
    if (context.recentFiles.length === 0) return 0;

    const valueDir = value.includes('/') ? value.slice(0, value.lastIndexOf('/')) : '';
    for (const recentFile of context.recentFiles.slice(0, 5)) {
      const recentDir = recentFile.includes('/') ? recentFile.slice(0, recentFile.lastIndexOf('/')) : '';
      if (valueDir && valueDir === recentDir) return 0.8;
      if (valueDir && recentDir.startsWith(valueDir)) return 0.4;
    }

    return 0;
  }

  private computePatternConfidence(pattern: UsagePattern, now: number): number {
    const recency = decayFactor(now - pattern.timestamp, this.recencyHalfLife);
    const frequency = Math.min(1, pattern.count / 10);
    return recency * 0.6 + frequency * 0.4;
  }

  private predictFromContext(context: CompletionContext): GhostPrediction | null {
    // Context-based predictions for common patterns
    const state = context.agentState;

    if (state === 'waiting-approval' && context.inputLine === '/') {
      return { text: 'approve', confidence: 0.8, source: 'context' };
    }

    if (state === 'error' && context.inputLine === '/') {
      return { text: 'undo', confidence: 0.75, source: 'context' };
    }

    if (state === 'streaming' && context.inputLine === '/') {
      return { text: 'stop', confidence: 0.7, source: 'context' };
    }

    return null;
  }

  private evictIfNeeded(): void {
    if (this.patterns.size <= this.maxPatterns) return;

    // Evict oldest patterns
    const sorted = [...this.patterns.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toRemove = sorted.slice(0, sorted.length - this.maxPatterns);
    for (const [key] of toRemove) {
      this.patterns.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decayFactor(elapsedMs: number, halfLifeMs: number): number {
  if (elapsedMs <= 0) return 1;
  return Math.pow(0.5, elapsedMs / halfLifeMs);
}
