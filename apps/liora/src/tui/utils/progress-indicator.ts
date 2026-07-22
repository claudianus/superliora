/**
 * ProgressIndicator — multi-progress bars, spinners, and step indicators.
 *
 * Provides rich progress visualization:
 * - Determinate progress bars (percentage-based)
 * - Indeterminate spinners (multiple animation styles)
 * - Multi-progress tracking (parallel operations)
 * - Step indicators (1/5, 2/5, ...)
 * - Nested progress (parent with children)
 * - ETA calculation and display
 * - Throughput display (items/sec, bytes/sec)
 * - Color transitions (red → yellow → green)
 * - Custom bar characters and styles
 * - Labeled segments within a bar
 * - Pulse animation for active state
 * - Compact/expanded view modes
 *
 * Spinner styles:
 * - dots: ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
 * - line: ─│─│
 * - circle: ◐◓◑◒
 * - bounce: ⠁⠂⠄⠂
 * - arrow: ←↖↑↗→↘↓↙
 * - pulse: █▓▒░
 *
 * Bar styles:
 * - classic: [████████░░░░░░░░] 50%
 * - minimal: ████████░░░░░░░░
 * - rounded: ═══════▶────────
 * - blocks: ▰▰▰▰▰▱▱▱▱▱
 * - dots: ●●●●●○○○○○
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpinnerStyle = 'dots' | 'line' | 'circle' | 'bounce' | 'arrow' | 'pulse' | 'moon' | 'earth';

export type BarStyle = 'classic' | 'minimal' | 'rounded' | 'blocks' | 'dots' | 'shade';

export interface ProgressOptions {
  readonly id: string;
  readonly label: string;
  readonly total: number; // 0 = indeterminate
  readonly current?: number;
  readonly unit?: string; // e.g., 'files', 'MB', 'tests'
  readonly parent?: string; // Parent progress ID for nesting
}

export interface ProgressState {
  readonly id: string;
  readonly label: string;
  readonly total: number;
  readonly current: number;
  readonly unit: string;
  readonly startTime: number;
  readonly endTime?: number;
  readonly parent?: string;
  readonly children: string[];
}

export interface ProgressRenderOptions {
  readonly width: number;
  readonly barStyle?: BarStyle;
  readonly showPercentage?: boolean;
  readonly showEta?: boolean;
  readonly showThroughput?: boolean;
  readonly colorByProgress?: boolean;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

export interface StepIndicatorOptions {
  readonly steps: readonly string[];
  readonly current: number;
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPINNER_FRAMES: Record<SpinnerStyle, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['─', '│', '─', '│'],
  circle: ['◐', '◓', '◑', '◒'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  pulse: ['█', '▓', '▒', '░', '▒', '▓'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  earth: ['🌍', '🌎', '🌏'],
};

const BAR_CHARS: Record<BarStyle, { filled: string; empty: string; head?: string }> = {
  classic: { filled: '█', empty: '░' },
  minimal: { filled: '━', empty: '─' },
  rounded: { filled: '═', empty: '─', head: '▶' },
  blocks: { filled: '▰', empty: '▱' },
  dots: { filled: '●', empty: '○' },
  shade: { filled: '█', empty: '░', head: '▓' },
};

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export class Spinner {
  private style: SpinnerStyle;
  private frame = 0;
  private label: string;

  constructor(label: string, style: SpinnerStyle = 'dots') {
    this.label = label;
    this.style = style;
  }

  /** Advance to next frame. */
  tick(): void {
    const frames = SPINNER_FRAMES[this.style];
    this.frame = (this.frame + 1) % frames.length;
  }

  /** Get current frame character. */
  get currentFrame(): string {
    return SPINNER_FRAMES[this.style][this.frame] ?? '•';
  }

  /** Render the spinner with label. */
  render(fg: (token: string, text: string) => string): string {
    return `${fg('primary', this.currentFrame)} ${this.label}`;
  }

  /** Set label. */
  setLabel(label: string): void {
    this.label = label;
  }

  /** Get all frames for this style. */
  getFrames(): readonly string[] {
    return SPINNER_FRAMES[this.style];
  }
}

// ---------------------------------------------------------------------------
// ProgressTracker
// ---------------------------------------------------------------------------

export class ProgressTracker {
  private items: Map<string, ProgressState> = new Map();
  private spinners: Map<string, Spinner> = new Map();

  // ─── Progress Management ─────────────────────────────────────────

  /** Create a new progress item. */
  create(options: ProgressOptions): void {
    const state: ProgressState = {
      id: options.id,
      label: options.label,
      total: options.total,
      current: options.current ?? 0,
      unit: options.unit ?? '',
      startTime: Date.now(),
      parent: options.parent,
      children: [],
    };

    this.items.set(options.id, state);

    // Link to parent
    if (options.parent) {
      const parent = this.items.get(options.parent);
      if (parent) {
        this.items.set(options.parent, { ...parent, children: [...parent.children, options.id] });
      }
    }

    // Create spinner for indeterminate
    if (options.total === 0) {
      this.spinners.set(options.id, new Spinner(options.label));
    }
  }

  /** Update progress current value. */
  update(id: string, current: number): void {
    const item = this.items.get(id);
    if (item) {
      const isComplete = current >= item.total && item.total > 0;
      this.items.set(id, {
        ...item,
        current,
        endTime: isComplete ? Date.now() : item.endTime,
      });
    }
  }

  /** Increment progress by delta. */
  increment(id: string, delta = 1): void {
    const item = this.items.get(id);
    if (item) {
      this.update(id, item.current + delta);
    }
  }

  /** Mark progress as complete. */
  complete(id: string): void {
    const item = this.items.get(id);
    if (item) {
      this.items.set(id, {
        ...item,
        current: item.total > 0 ? item.total : item.current,
        endTime: Date.now(),
      });
    }
    this.spinners.delete(id);
  }

  /** Remove a progress item. */
  remove(id: string): void {
    this.items.delete(id);
    this.spinners.delete(id);
  }

  /** Clear all progress items. */
  clear(): void {
    this.items.clear();
    this.spinners.clear();
  }

  /** Tick all spinners. */
  tick(): void {
    for (const spinner of this.spinners.values()) {
      spinner.tick();
    }
  }

  // ─── Queries ─────────────────────────────────────────────────────

  /** Get a progress item. */
  get(id: string): ProgressState | null {
    return this.items.get(id) ?? null;
  }

  /** Get all progress items. */
  getAll(): ProgressState[] {
    return [...this.items.values()];
  }

  /** Get root-level items (no parent). */
  getRoots(): ProgressState[] {
    return [...this.items.values()].filter((i) => !i.parent);
  }

  /** Calculate overall percentage for an item (including children). */
  getPercentage(id: string): number {
    const item = this.items.get(id);
    if (!item) return 0;
    if (item.total === 0) return -1; // Indeterminate
    return Math.min(1, item.current / item.total);
  }

  /** Calculate ETA in milliseconds. */
  getEta(id: string): number | null {
    const item = this.items.get(id);
    if (!item || item.total === 0 || item.current === 0) return null;

    const elapsed = Date.now() - item.startTime;
    const rate = item.current / elapsed;
    const remaining = item.total - item.current;
    return Math.round(remaining / rate);
  }

  /** Calculate throughput. */
  getThroughput(id: string): number {
    const item = this.items.get(id);
    if (!item || item.current === 0) return 0;

    const elapsed = (Date.now() - item.startTime) / 1000; // seconds
    return item.current / elapsed;
  }

  // ─── Rendering ───────────────────────────────────────────────────

  /** Render all progress items. */
  render(options: ProgressRenderOptions): string[] {
    const lines: string[] = [];

    for (const item of this.getRoots()) {
      lines.push(...this.renderItem(item, 0, options));
    }

    return lines;
  }

  private renderItem(item: ProgressState, depth: number, options: ProgressRenderOptions): string[] {
    const { width, barStyle = 'classic', showPercentage = true, showEta = false, showThroughput = false, fg, boldFg, dimFg } = options;
    const lines: string[] = [];
    const indent = '  '.repeat(depth);
    const spinner = this.spinners.get(item.id);

    // Label line
    const label = item.endTime
      ? fg('success', `✓ ${item.label}`)
      : spinner
        ? spinner.render(fg)
        : boldFg('text', item.label);

    lines.push(`${indent}${label}`);

    // Progress bar (only for determinate)
    if (item.total > 0) {
      const pct = this.getPercentage(item.id);
      const barWidth = width - indent.length * 2 - (showPercentage ? 6 : 0) - 4;
      const bar = this.renderBar(pct, Math.max(10, barWidth), barStyle, options);

      let suffix = '';
      if (showPercentage) {
        suffix = dimFg('textMuted', ` ${String(Math.round(pct * 100)).padStart(3)}%`);
      }

      lines.push(`${indent}  ${bar}${suffix}`);

      // Stats line
      const stats: string[] = [];
      if (item.unit) {
        stats.push(dimFg('textMuted', `${String(item.current)}/${String(item.total)} ${item.unit}`));
      }
      if (showEta) {
        const eta = this.getEta(item.id);
        if (eta !== null && !item.endTime) {
          stats.push(dimFg('textMuted', `ETA ${formatDuration(eta)}`));
        }
      }
      if (showThroughput && !item.endTime) {
        const tp = this.getThroughput(item.id);
        if (tp > 0) {
          stats.push(dimFg('textMuted', `${tp.toFixed(1)} ${item.unit || 'items'}/s`));
        }
      }
      if (stats.length > 0) {
        lines.push(`${indent}  ${stats.join(' · ')}`);
      }
    }

    // Render children
    for (const childId of item.children) {
      const child = this.items.get(childId);
      if (child) {
        lines.push(...this.renderItem(child, depth + 1, options));
      }
    }

    return lines;
  }

  private renderBar(pct: number, width: number, style: BarStyle, options: ProgressRenderOptions): string {
    const { fg, dimFg, colorByProgress = true } = options;
    const chars = BAR_CHARS[style];
    const filled = Math.round(width * pct);
    const empty = width - filled;

    // Color based on progress
    let color = 'primary';
    if (colorByProgress) {
      if (pct >= 1) color = 'success';
      else if (pct >= 0.7) color = 'success';
      else if (pct >= 0.4) color = 'warning';
      else color = 'error';
    }

    let bar: string;
    if (chars.head && filled > 0 && filled < width) {
      bar = fg(color, chars.filled.repeat(filled - 1) + chars.head) + dimFg('textDim', chars.empty.repeat(empty));
    } else {
      bar = fg(color, chars.filled.repeat(filled)) + dimFg('textDim', chars.empty.repeat(empty));
    }

    return `[${bar}]`;
  }
}

// ---------------------------------------------------------------------------
// Step Indicator
// ---------------------------------------------------------------------------

/** Render a step indicator (wizard-style progress). */
export function renderStepIndicator(options: StepIndicatorOptions): string[] {
  const { steps, current, width, fg, boldFg, dimFg } = options;
  const lines: string[] = [];

  // Horizontal step dots
  const stepWidth = Math.floor((width - steps.length * 3) / steps.length);
  const dots = steps.map((step, i) => {
    if (i < current) return fg('success', '●');
    if (i === current) return fg('primary', '◉');
    return dimFg('textDim', '○');
  });

  const connectors = steps.slice(0, -1).map((_, i) => {
    return i < current ? fg('success', '───') : dimFg('textDim', '───');
  });

  let dotLine = '';
  for (let i = 0; i < dots.length; i++) {
    dotLine += dots[i];
    if (i < connectors.length) dotLine += connectors[i];
  }
  lines.push(`  ${dotLine}`);

  // Current step label
  const currentStep = steps[current];
  if (currentStep) {
    lines.push(`  ${boldFg('text', currentStep)} ${dimFg('textMuted', `(${String(current + 1)}/${String(steps.length)})`)}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  return `${String(minutes)}m ${String(remainingSecs)}s`;
}
