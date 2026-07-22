/**
 * ContextBudgetViz — comprehensive token usage visualization and prediction.
 *
 * Provides detailed insights into context window usage:
 * - Breakdown by category (system, messages, tools, files, etc.)
 * - Historical trend chart (sparkline)
 * - Compaction prediction (when will context fill up?)
 * - Budget allocation recommendations
 * - Pressure indicators with color-coded urgency
 * - Cost projection based on usage trajectory
 *
 * Visualizations:
 * - Stacked bar chart for category breakdown
 * - Sparkline for historical trend
 * - Gauge for overall pressure
 * - Timeline for compaction events
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContextCategory =
  | 'system'
  | 'messages'
  | 'tools'
  | 'files'
  | 'images'
  | 'memory'
  | 'other';

export interface ContextBreakdown {
  readonly category: ContextCategory;
  readonly tokens: number;
  readonly percentage: number;
}

export interface ContextSnapshot {
  readonly timestamp: number;
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly usageRatio: number;
  readonly breakdown: readonly ContextBreakdown[];
  readonly compactionCount: number;
}

export interface ContextPrediction {
  /** Estimated time until context is full (ms). */
  readonly timeToFullMs: number | null;
  /** Estimated turns until context is full. */
  readonly turnsToFull: number | null;
  /** Recommended action. */
  readonly recommendation: 'none' | 'monitor' | 'compact-soon' | 'compact-now';
  /** Confidence in the prediction (0-1). */
  readonly confidence: number;
}

export interface ContextVizOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORY_GLYPH: Record<ContextCategory, string> = {
  system: '⚙',
  messages: '💬',
  tools: '🔧',
  files: '📁',
  images: '🖼',
  memory: '🧠',
  other: '📦',
};

const CATEGORY_COLOR: Record<ContextCategory, string> = {
  system: 'textMuted',
  messages: 'primary',
  tools: 'warning',
  files: 'accent',
  images: 'error',
  memory: 'success',
  other: 'textDim',
};

const CATEGORY_LABEL: Record<ContextCategory, string> = {
  system: 'System',
  messages: 'Messages',
  tools: 'Tools',
  files: 'Files',
  images: 'Images',
  memory: 'Memory',
  other: 'Other',
};

/** Pressure thresholds. */
const PRESSURE_LOW = 0.5;
const PRESSURE_MEDIUM = 0.75;
const PRESSURE_HIGH = 0.9;

// ---------------------------------------------------------------------------
// ContextBudgetTracker
// ---------------------------------------------------------------------------

export class ContextBudgetTracker {
  private history: ContextSnapshot[] = [];
  private readonly maxHistory: number;
  private currentBreakdown: Map<ContextCategory, number> = new Map();
  private maxTokens: number;
  private compactionCount = 0;

  constructor(maxTokens: number = 200000, maxHistory: number = 100) {
    this.maxTokens = maxTokens;
    this.maxHistory = maxHistory;
  }

  // ─── Recording ────────────────────────────────────────────────────

  /** Update the current token count for a category. */
  updateCategory(category: ContextCategory, tokens: number): void {
    this.currentBreakdown.set(category, tokens);
  }

  /** Record a snapshot of the current state. */
  recordSnapshot(now: number = Date.now()): void {
    const totalTokens = this.getTotalTokens();
    const breakdown = this.getBreakdown();

    this.history.push({
      timestamp: now,
      totalTokens,
      maxTokens: this.maxTokens,
      usageRatio: totalTokens / this.maxTokens,
      breakdown,
      compactionCount: this.compactionCount,
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /** Record a compaction event. */
  recordCompaction(): void {
    this.compactionCount++;
  }

  /** Update the max token limit (e.g. model change). */
  setMaxTokens(maxTokens: number): void {
    this.maxTokens = maxTokens;
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /** Get total tokens across all categories. */
  getTotalTokens(): number {
    let total = 0;
    for (const tokens of this.currentBreakdown.values()) {
      total += tokens;
    }
    return total;
  }

  /** Get the current usage ratio (0-1). */
  getUsageRatio(): number {
    return this.getTotalTokens() / this.maxTokens;
  }

  /** Get the breakdown by category. */
  getBreakdown(): ContextBreakdown[] {
    const total = this.getTotalTokens();
    const result: ContextBreakdown[] = [];

    for (const [category, tokens] of this.currentBreakdown) {
      result.push({
        category,
        tokens,
        percentage: total > 0 ? (tokens / total) * 100 : 0,
      });
    }

    return result.sort((a, b) => b.tokens - a.tokens);
  }

  /** Get the pressure level. */
  getPressureLevel(): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = this.getUsageRatio();
    if (ratio >= PRESSURE_HIGH) return 'critical';
    if (ratio >= PRESSURE_MEDIUM) return 'high';
    if (ratio >= PRESSURE_LOW) return 'medium';
    return 'low';
  }

  /** Get the history of snapshots. */
  getHistory(): readonly ContextSnapshot[] {
    return this.history;
  }

  get compactions(): number {
    return this.compactionCount;
  }

  // ─── Prediction ───────────────────────────────────────────────────

  /** Predict when context will be full based on recent trend. */
  predict(): ContextPrediction {
    if (this.history.length < 3) {
      return {
        timeToFullMs: null,
        turnsToFull: null,
        recommendation: 'none',
        confidence: 0,
      };
    }

    // Calculate growth rate from recent history
    const recent = this.history.slice(-10);
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const timeSpanMs = last.timestamp - first.timestamp;
    const tokenGrowth = last.totalTokens - first.totalTokens;

    if (timeSpanMs <= 0 || tokenGrowth <= 0) {
      return {
        timeToFullMs: null,
        turnsToFull: null,
        recommendation: this.getUsageRatio() > PRESSURE_HIGH ? 'compact-now' : 'none',
        confidence: 0.5,
      };
    }

    const tokensPerMs = tokenGrowth / timeSpanMs;
    const remainingTokens = this.maxTokens - last.totalTokens;
    const timeToFullMs = remainingTokens / tokensPerMs;

    // Estimate turns (assume ~2 seconds per turn)
    const turnsToFull = Math.ceil(timeToFullMs / 2000);

    // Determine recommendation
    let recommendation: ContextPrediction['recommendation'] = 'none';
    const ratio = this.getUsageRatio();
    if (ratio >= PRESSURE_HIGH || timeToFullMs < 60000) {
      recommendation = 'compact-now';
    } else if (ratio >= PRESSURE_MEDIUM || timeToFullMs < 300000) {
      recommendation = 'compact-soon';
    } else if (ratio >= PRESSURE_LOW || timeToFullMs < 600000) {
      recommendation = 'monitor';
    }

    // Confidence based on data points and consistency
    const confidence = Math.min(0.9, 0.3 + recent.length * 0.06);

    return {
      timeToFullMs,
      turnsToFull,
      recommendation,
      confidence,
    };
  }

  // ─── Reset ────────────────────────────────────────────────────────

  /** Clear all history (e.g. new session). */
  reset(): void {
    this.history = [];
    this.currentBreakdown.clear();
    this.compactionCount = 0;
  }
}

// ---------------------------------------------------------------------------
// Visualization Renderers
// ---------------------------------------------------------------------------

/**
 * Render a stacked bar chart showing category breakdown.
 */
export function renderStackedBar(
  breakdown: readonly ContextBreakdown[],
  width: number,
  fg: (t: string, s: string) => string,
): string {
  const chars = new Array<string>(width).fill(' ');
  let pos = 0;

  for (const item of breakdown) {
    const barWidth = Math.max(1, Math.round((item.percentage / 100) * width));
    const color = CATEGORY_COLOR[item.category];
    const char = '█';

    for (let i = 0; i < barWidth && pos < width; i++) {
      chars[pos] = fg(color, char);
      pos++;
    }
  }

  return chars.join('');
}

/**
 * Render a sparkline showing historical trend.
 */
export function renderSparkline(
  history: readonly ContextSnapshot[],
  width: number,
  fg: (t: string, s: string) => string,
): string {
  if (history.length === 0) return '';

  const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const values = history.slice(-width).map((s) => s.usageRatio);
  const maxVal = Math.max(...values, 0.01);

  const chars: string[] = [];
  for (const val of values) {
    const idx = Math.min(SPARK_CHARS.length - 1, Math.floor((val / maxVal) * SPARK_CHARS.length));
    const color = val > PRESSURE_HIGH ? 'error' : val > PRESSURE_MEDIUM ? 'warning' : 'success';
    chars.push(fg(color, SPARK_CHARS[idx]!));
  }

  return chars.join('');
}

/**
 * Render a pressure gauge.
 */
export function renderPressureGauge(
  ratio: number,
  width: number,
  fg: (t: string, s: string) => string,
  dimFg: (t: string, s: string) => string,
): string {
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const color = ratio > PRESSURE_HIGH ? 'error' : ratio > PRESSURE_MEDIUM ? 'warning' : 'success';

  const bar = fg(color, '█'.repeat(filled)) + dimFg('textMuted', '░'.repeat(empty));
  const pct = `${String(Math.round(ratio * 100))}%`;

  return `${bar} ${fg(color, pct)}`;
}

/**
 * Render the full context budget visualization panel.
 */
export function renderContextBudgetPanel(
  tracker: ContextBudgetTracker,
  options: ContextVizOptions,
): string[] {
  const { width, height, fg, boldFg, dimFg, bg } = options;
  const lines: string[] = [];

  const totalTokens = tracker.getTotalTokens();
  const ratio = tracker.getUsageRatio();
  const pressure = tracker.getPressureLevel();
  const breakdown = tracker.getBreakdown();
  const prediction = tracker.predict();

  // Header
  const pressureColor = pressure === 'critical' ? 'error' : pressure === 'high' ? 'warning' : 'success';
  lines.push(boldFg('text', ` Context Budget ${fg(pressureColor, `● ${pressure.toUpperCase()}`)}`));
  lines.push(fg('textMuted', '─'.repeat(Math.min(width, 50))));

  // Overall gauge
  lines.push('');
  lines.push(` ${renderPressureGauge(ratio, Math.min(30, width - 15), fg, dimFg)}`);
  lines.push(dimFg('textMuted', ` ${formatTokens(totalTokens)} / ${formatTokens(tracker['maxTokens'])} tokens`));

  // Category breakdown
  lines.push('');
  lines.push(dimFg('textMuted', ' Breakdown:'));
  lines.push(` ${renderStackedBar(breakdown, Math.min(40, width - 5), fg)}`);

  for (const item of breakdown.slice(0, 5)) {
    const glyph = CATEGORY_GLYPH[item.category];
    const label = CATEGORY_LABEL[item.category];
    const pct = `${item.percentage.toFixed(1)}%`;
    const tokens = formatTokens(item.tokens);
    lines.push(`  ${glyph} ${label.padEnd(10)} ${fg(CATEGORY_COLOR[item.category], pct.padStart(6))} ${dimFg('textMuted', tokens)}`);
  }

  // Trend sparkline
  const history = tracker.getHistory();
  if (history.length > 2) {
    lines.push('');
    lines.push(dimFg('textMuted', ' Trend:'));
    lines.push(` ${renderSparkline(history, Math.min(50, width - 5), fg)}`);
  }

  // Prediction
  lines.push('');
  if (prediction.recommendation !== 'none') {
    const recColor = prediction.recommendation === 'compact-now' ? 'error'
      : prediction.recommendation === 'compact-soon' ? 'warning'
      : 'textMuted';
    const recText = prediction.recommendation === 'compact-now' ? 'Compact now!'
      : prediction.recommendation === 'compact-soon' ? 'Compact soon'
      : 'Monitor';

    lines.push(fg(recColor, ` ⚠ ${recText}`));

    if (prediction.turnsToFull !== null) {
      lines.push(dimFg('textMuted', `   ~${String(prediction.turnsToFull)} turns until full`));
    }
  } else {
    lines.push(fg('success', ' ✓ Context healthy'));
  }

  // Compaction count
  if (tracker.compactions > 0) {
    lines.push(dimFg('textMuted', ` Compactions: ${String(tracker.compactions)}`));
  }

  return lines.slice(0, height);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
