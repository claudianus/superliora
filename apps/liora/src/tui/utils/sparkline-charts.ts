/**
 * SparklineCharts — inline mini charts and metric visualization.
 *
 * Provides compact data visualization for terminal dashboards:
 * - Sparklines (▁▂▃▄▅▆▇█ braille-style mini line charts)
 * - Bar charts (horizontal/vertical with labels)
 * - Heatmaps (grid of colored cells for density)
 * - Gauge/dial (semicircular progress indicator)
 * - Histogram (frequency distribution)
 * - Trend indicators (↑↓→ with percentage)
 * - Multi-series overlay (compare two datasets)
 * - Animated transitions between data states
 * - Min/max/avg markers
 * - Threshold lines (warning/critical zones)
 *
 * Use cases:
 * - FPS history in performance monitor
 * - Token usage over time
 * - Agent activity levels
 * - Memory/CPU trends
 * - Build time history
 * - Error rate visualization
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SparklineOptions {
  readonly width: number;
  readonly height?: number; // For multi-row sparklines
  readonly min?: number;
  readonly max?: number;
  readonly showMinMax?: boolean;
  readonly threshold?: number; // Warning line
  readonly criticalThreshold?: number;
  readonly fg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface BarChartOptions {
  readonly width: number;
  readonly maxBarWidth?: number;
  readonly showValues?: boolean;
  readonly showLabels?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface GaugeOptions {
  readonly width: number;
  readonly label?: string;
  readonly showPercentage?: boolean;
  readonly thresholds?: { warning: number; critical: number };
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface HeatmapOptions {
  readonly cols: number;
  readonly rows: number;
  readonly fg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface DataPoint {
  readonly value: number;
  readonly label?: string;
  readonly color?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPARK_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const BRAILLE_DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];
const BLOCK_CHARS = [' ', '░', '▒', '▓', '█'];
const HEAT_CHARS = ['·', '░', '▒', '▓', '█'];

// ---------------------------------------------------------------------------
// Sparkline Rendering
// ---------------------------------------------------------------------------

/** Render a sparkline (single-row mini chart). */
export function renderSparkline(data: readonly number[], options: SparklineOptions): string {
  const { width, min, max, threshold, criticalThreshold, fg, dimFg } = options;

  if (data.length === 0) return dimFg('textMuted', '─'.repeat(width));

  const dataMin = min ?? Math.min(...data);
  const dataMax = max ?? Math.max(...data);
  const range = dataMax - dataMin || 1;

  // Sample data to fit width
  const sampled = sampleData(data, width);
  let result = '';

  for (const value of sampled) {
    const normalized = (value - dataMin) / range;
    const charIdx = Math.min(SPARK_CHARS.length - 1, Math.max(0, Math.round(normalized * (SPARK_CHARS.length - 1))));
    const char = SPARK_CHARS[charIdx] ?? '▄';

    // Color based on thresholds
    if (criticalThreshold !== undefined && value >= criticalThreshold) {
      result += fg('error', char);
    } else if (threshold !== undefined && value >= threshold) {
      result += fg('warning', char);
    } else if (normalized > 0.7) {
      result += fg('success', char);
    } else {
      result += fg('primary', char);
    }
  }

  return result;
}

/** Render a multi-row sparkline (taller chart). */
export function renderTallSparkline(data: readonly number[], options: SparklineOptions & { height: number }): string[] {
  const { width, height, min, max, fg, dimFg } = options;
  const lines: string[] = [];

  if (data.length === 0) {
    return Array.from({ length: height }, () => dimFg('textMuted', ' '.repeat(width)));
  }

  const dataMin = min ?? Math.min(...data);
  const dataMax = max ?? Math.max(...data);
  const range = dataMax - dataMin || 1;
  const sampled = sampleData(data, width);

  for (let row = 0; row < height; row++) {
    let line = '';
    const rowThreshold = 1 - (row + 1) / height;

    for (const value of sampled) {
      const normalized = (value - dataMin) / range;
      if (normalized > rowThreshold + 0.5 / height) {
        line += fg('primary', '█');
      } else if (normalized > rowThreshold - 0.5 / height) {
        line += fg('primary', '▄');
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }

  return lines;
}

/** Render a braille sparkline (higher resolution). */
export function renderBrailleSparkline(data: readonly number[], width: number, fg: (t: string, s: string) => string): string {
  if (data.length === 0) return '';

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const sampled = sampleData(data, width * 2); // 2 dots per char width

  let result = '';
  for (let i = 0; i < sampled.length; i += 2) {
    const left = ((sampled[i] ?? 0) - min) / range;
    const right = ((sampled[i + 1] ?? 0) - min) / range;

    const leftDot = Math.round(left * 3);
    const rightDot = Math.round(right * 3);

    // Braille: each char has 4 rows x 2 cols
    let code = 0x2800;
    if (leftDot >= 0) code |= BRAILLE_DOTS[3 - Math.min(3, leftDot)]![0]!;
    if (rightDot >= 0) code |= BRAILLE_DOTS[3 - Math.min(3, rightDot)]![1]!;

    result += fg('primary', String.fromCharCode(code));
  }

  return result;
}

// ---------------------------------------------------------------------------
// Bar Charts
// ---------------------------------------------------------------------------

/** Render a horizontal bar chart. */
export function renderBarChart(items: readonly DataPoint[], options: BarChartOptions): string[] {
  const { width, maxBarWidth = 30, showValues = true, showLabels = true, fg, boldFg, dimFg } = options;
  const lines: string[] = [];

  if (items.length === 0) return [dimFg('textMuted', '  (no data)')];

  const maxValue = Math.max(...items.map((d) => d.value), 1);
  const labelWidth = showLabels ? Math.min(12, Math.max(...items.map((d) => (d.label ?? '').length))) : 0;
  const barAreaWidth = Math.min(maxBarWidth, width - labelWidth - (showValues ? 8 : 0) - 4);

  for (const item of items) {
    const ratio = item.value / maxValue;
    const barLen = Math.round(ratio * barAreaWidth);
    const bar = fg(item.color ?? 'primary', '█'.repeat(barLen)) + dimFg('textDim', '░'.repeat(barAreaWidth - barLen));

    let line = '';
    if (showLabels) {
      line += dimFg('textMuted', (item.label ?? '').padEnd(labelWidth + 1));
    }
    line += bar;
    if (showValues) {
      line += dimFg('textMuted', ` ${formatNumber(item.value)}`);
    }
    lines.push(line);
  }

  return lines;
}

/** Render a vertical bar chart (columns). */
export function renderVerticalBars(values: readonly number[], options: SparklineOptions & { barWidth?: number }): string[] {
  const { width, fg, dimFg, barWidth = 3 } = options;
  const height = 6;
  const lines: string[] = [];

  if (values.length === 0) return [dimFg('textMuted', '(no data)')];

  const max = Math.max(...values, 1);
  const totalBars = Math.min(values.length, Math.floor(width / (barWidth + 1)));
  const sampled = sampleData(values, totalBars);

  for (let row = height - 1; row >= 0; row--) {
    let line = '';
    const rowLevel = (row + 0.5) / height;

    for (const value of sampled) {
      const normalized = value / max;
      const char = normalized >= rowLevel ? '█' : ' ';
      const padded = char.repeat(barWidth) + ' ';
      line += normalized >= rowLevel ? fg('primary', padded) : dimFg('textDim', padded);
    }
    lines.push(line);
  }

  // Baseline
  lines.push(dimFg('textDim', '─'.repeat(sampled.length * (barWidth + 1))));

  return lines;
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/** Render a semicircular gauge. */
export function renderGauge(value: number, options: GaugeOptions): string[] {
  const { width, label, showPercentage = true, thresholds, fg, boldFg, dimFg } = options;
  const lines: string[] = [];
  const gaugeWidth = Math.min(width - 4, 40);

  // Determine color
  let color = 'success';
  if (thresholds) {
    if (value >= thresholds.critical) color = 'error';
    else if (value >= thresholds.warning) color = 'warning';
  }

  // Bar gauge
  const filled = Math.round(value * gaugeWidth);
  const bar = fg(color, '█'.repeat(filled)) + dimFg('textDim', '░'.repeat(gaugeWidth - filled));

  if (label) {
    lines.push(dimFg('textMuted', ` ${label}`));
  }
  lines.push(` ${bar}`);

  if (showPercentage) {
    const percent = Math.round(value * 100);
    lines.push(` ${fg(color, `${String(percent)}%`)}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

/** Render a heatmap grid. */
export function renderHeatmap(data: readonly (readonly number[])[], options: HeatmapOptions): string[] {
  const { fg, dimFg } = options;
  const lines: string[] = [];

  if (data.length === 0) return [];

  const allValues = data.flat();
  const min = Math.min(...allValues, 0);
  const max = Math.max(...allValues, 1);
  const range = max - min || 1;

  for (const row of data) {
    let line = ' ';
    for (const cell of row) {
      const normalized = (cell - min) / range;
      const charIdx = Math.min(HEAT_CHARS.length - 1, Math.round(normalized * (HEAT_CHARS.length - 1)));
      const char = HEAT_CHARS[charIdx] ?? '·';

      if (normalized > 0.75) line += fg('error', char);
      else if (normalized > 0.5) line += fg('warning', char);
      else if (normalized > 0.25) line += fg('primary', char);
      else line += dimFg('textDim', char);
    }
    lines.push(line);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Trend Indicators
// ---------------------------------------------------------------------------

/** Render a trend indicator with arrow and percentage. */
export function renderTrend(current: number, previous: number, fg: (t: string, s: string) => string, dimFg: (t: string, s: string) => string): string {
  if (previous === 0) return dimFg('textMuted', '→ n/a');

  const change = ((current - previous) / previous) * 100;
  const absChange = Math.abs(change).toFixed(1);

  if (change > 1) {
    return fg('success', `↑ ${absChange}%`);
  } else if (change < -1) {
    return fg('error', `↓ ${absChange}%`);
  }
  return dimFg('textMuted', `→ ${absChange}%`);
}

/** Render a mini stat with sparkline. */
export function renderMiniStat(
  label: string,
  value: string,
  history: readonly number[],
  options: SparklineOptions,
): string {
  const { fg, dimFg } = options;
  const spark = renderSparkline(history, { ...options, width: 12 });
  return `${dimFg('textMuted', label)} ${fg('text', value)} ${spark}`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sampleData(data: readonly number[], targetLength: number): number[] {
  if (data.length <= targetLength) return [...data];

  const result: number[] = [];
  const step = data.length / targetLength;

  for (let i = 0; i < targetLength; i++) {
    const idx = Math.floor(i * step);
    result.push(data[idx] ?? 0);
  }

  return result;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
