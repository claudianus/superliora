/**
 * ProgressVisualizer — rich progress indicators for long-running operations.
 *
 * Provides multiple visualization styles for progress feedback:
 * - Determinate progress bars (with percentage, ETA, elapsed)
 * - Indeterminate spinners (multiple animation styles)
 * - Multi-step progress (wizard-style step indicators)
 * - Nested progress (parent task with sub-tasks)
 * - Speed/throughput indicators
 * - Animated transitions between states
 *
 * Animation styles:
 * - Braille spinner (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏)
 * - Line spinner (|/-\)
 * - Dots (⣾⣽⣻⢿⡿⣟⣯⣷)
 * - Arrow (←↖↑↗→↘↓↙)
 * - Bounce (⠁⠂⠄⡀⢀⠠⠐⠈)
 * - Pulse (█▓▒░▒▓)
 *
 * All animations are clock-driven (Date.now based) for frame independence.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpinnerStyle = 'braille' | 'line' | 'dots' | 'arrow' | 'bounce' | 'pulse' | 'moon' | 'earth';

export type ProgressState = 'idle' | 'active' | 'paused' | 'complete' | 'error';

export interface ProgressInfo {
  readonly id: string;
  readonly label: string;
  readonly state: ProgressState;
  /** Current value (0-total). Null for indeterminate. */
  readonly current: number | null;
  readonly total: number | null;
  /** Sub-steps for multi-step progress. */
  readonly steps?: readonly ProgressStep[];
  readonly currentStep?: number;
  /** Throughput (items/sec) for speed display. */
  readonly throughput?: number;
  /** Start timestamp. */
  readonly startTime: number;
  /** Estimated completion timestamp. */
  readonly etaMs?: number;
  /** Additional detail text. */
  readonly detail?: string;
}

export interface ProgressStep {
  readonly label: string;
  readonly state: 'pending' | 'active' | 'complete' | 'error' | 'skipped';
}

export interface ProgressRenderOptions {
  readonly width: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
  /** Current timestamp for animation (default: Date.now()). */
  readonly now?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SPINNER_FRAMES: Record<SpinnerStyle, readonly string[]> = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['|', '/', '─', '\\'],
  dots: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  pulse: ['█', '▓', '▒', '░', '▒', '▓'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
  earth: ['🌍', '🌎', '🌏'],
};

const SPINNER_INTERVAL_MS: Record<SpinnerStyle, number> = {
  braille: 80,
  line: 120,
  dots: 80,
  arrow: 100,
  bounce: 100,
  pulse: 150,
  moon: 200,
  earth: 300,
};

const STEP_GLYPH: Record<ProgressStep['state'], string> = {
  pending: '○',
  active: '◉',
  complete: '●',
  error: '✗',
  skipped: '⊘',
};

const STEP_COLOR: Record<ProgressStep['state'], string> = {
  pending: 'textMuted',
  active: 'accent',
  complete: 'success',
  error: 'error',
  skipped: 'textDim',
};

const STATE_GLYPH: Record<ProgressState, string> = {
  idle: '○',
  active: '●',
  paused: '⏸',
  complete: '✓',
  error: '✗',
};

const STATE_COLOR: Record<ProgressState, string> = {
  idle: 'textMuted',
  active: 'primary',
  paused: 'warning',
  complete: 'success',
  error: 'error',
};

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

/**
 * Get the current spinner frame for a given style.
 */
export function getSpinnerFrame(
  style: SpinnerStyle = 'braille',
  now: number = Date.now(),
): string {
  const frames = SPINNER_FRAMES[style];
  const interval = SPINNER_INTERVAL_MS[style];
  const idx = Math.floor(now / interval) % frames.length;
  return frames[idx] ?? frames[0] ?? '';
}

/**
 * Render a spinner with label.
 */
export function renderSpinner(
  label: string,
  style: SpinnerStyle = 'braille',
  options: ProgressRenderOptions,
): string {
  const { fg, dimFg, now = Date.now() } = options;
  const frame = getSpinnerFrame(style, now);
  return `${fg('accent', frame)} ${fg('text', label)}`;
}

// ---------------------------------------------------------------------------
// Progress Bar
// ---------------------------------------------------------------------------

/**
 * Render a determinate progress bar.
 *
 * Example: ████████░░░░░░░░ 52% (12.3s elapsed, ~11.2s remaining)
 */
export function renderProgressBar(
  current: number,
  total: number,
  options: ProgressRenderOptions,
  barWidth?: number,
): string {
  const { width, fg, boldFg, dimFg, now = Date.now() } = options;
  const ratio = total > 0 ? Math.min(1, current / total) : 0;
  const effectiveBarWidth = barWidth ?? Math.min(30, Math.floor(width * 0.4));

  const filled = Math.round(ratio * effectiveBarWidth);
  const empty = effectiveBarWidth - filled;

  // Animated fill: last filled char pulses
  const fillChar = '█';
  const emptyChar = '░';
  const pulseChar = getSpinnerFrame('pulse', now);

  const color = ratio >= 1 ? 'success' : ratio > 0.75 ? 'warning' : 'primary';
  let bar: string;
  if (filled > 0 && ratio < 1) {
    bar = fg(color, fillChar.repeat(filled - 1)) + fg('accent', pulseChar) + dimFg('textMuted', emptyChar.repeat(empty));
  } else {
    bar = fg(color, fillChar.repeat(filled)) + dimFg('textMuted', emptyChar.repeat(empty));
  }

  const pct = `${String(Math.round(ratio * 100))}%`;
  return `${bar} ${boldFg(color, pct)}`;
}

/**
 * Render an indeterminate progress bar (bouncing block).
 */
export function renderIndeterminateBar(
  options: ProgressRenderOptions,
  barWidth?: number,
): string {
  const { fg, dimFg, now = Date.now() } = options;
  const effectiveBarWidth = barWidth ?? 20;
  const blockWidth = Math.max(3, Math.floor(effectiveBarWidth * 0.25));

  // Bounce position (ping-pong)
  const cycle = (now / 50) % (effectiveBarWidth * 2);
  const pos = cycle < effectiveBarWidth
    ? Math.floor(cycle)
    : Math.floor(effectiveBarWidth * 2 - cycle);
  const clampedPos = Math.min(pos, effectiveBarWidth - blockWidth);

  const chars: string[] = [];
  for (let i = 0; i < effectiveBarWidth; i++) {
    if (i >= clampedPos && i < clampedPos + blockWidth) {
      chars.push(fg('accent', '█'));
    } else {
      chars.push(dimFg('textMuted', '░'));
    }
  }

  return chars.join('');
}

// ---------------------------------------------------------------------------
// Multi-Step Progress
// ---------------------------------------------------------------------------

/**
 * Render a multi-step progress indicator.
 *
 * Example: ● Setup ─ ● Install ─ ◉ Build ─ ○ Test ─ ○ Deploy
 */
export function renderStepProgress(
  steps: readonly ProgressStep[],
  currentStep: number,
  options: ProgressRenderOptions,
): string[] {
  const { width, fg, boldFg, dimFg } = options;
  const lines: string[] = [];

  // Compact single-line for narrow widths
  if (width < 50) {
    const glyphs = steps.map((s, i) => {
      const glyph = STEP_GLYPH[s.state];
      const color = STEP_COLOR[s.state];
      return i === currentStep ? boldFg(color, glyph) : fg(color, glyph);
    });
    lines.push(glyphs.join(fg('textMuted', '─')));
    const activeStep = steps[currentStep];
    if (activeStep) {
      lines.push(`${fg('accent', '▸')} ${fg('text', activeStep.label)}`);
    }
    return lines;
  }

  // Full layout for wider terminals
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const glyph = STEP_GLYPH[step.state];
    const color = STEP_COLOR[step.state];
    const isActive = i === currentStep;

    const connector = i < steps.length - 1
      ? (step.state === 'complete' ? fg('success', '───') : dimFg('textMuted', '───'))
      : '';

    const label = isActive
      ? boldFg('text', step.label)
      : step.state === 'complete'
        ? fg('success', step.label)
        : dimFg('textMuted', step.label);

    lines.push(` ${fg(color, glyph)} ${label} ${connector}`);
  }

  return lines;
}

// ---------------------------------------------------------------------------
// ETA / Elapsed Formatting
// ---------------------------------------------------------------------------

/**
 * Format elapsed time compactly.
 */
export function formatElapsed(startTime: number, now: number = Date.now()): string {
  const ms = now - startTime;
  if (ms < 1000) return '<1s';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${String(sec)}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${String(min)}m${String(remSec)}s`;
  const hour = Math.floor(min / 60);
  const remMin = min % 60;
  return `${String(hour)}h${String(remMin)}m`;
}

/**
 * Estimate time remaining based on progress.
 */
export function estimateEta(
  current: number,
  total: number,
  startTime: number,
  now: number = Date.now(),
): string | null {
  if (current <= 0 || total <= 0) return null;
  const elapsed = now - startTime;
  const rate = current / elapsed; // items per ms
  const remaining = (total - current) / rate;

  if (remaining < 1000) return '<1s';
  if (remaining > 3600000) return '>1h';
  return `~${formatElapsed(now - remaining, now)}`;
}

// ---------------------------------------------------------------------------
// Composite Progress Renderer
// ---------------------------------------------------------------------------

/**
 * Render a complete progress visualization for a ProgressInfo.
 */
export function renderProgress(info: ProgressInfo, options: ProgressRenderOptions): string[] {
  const { width, fg, boldFg, dimFg, now = Date.now() } = options;
  const lines: string[] = [];

  // State indicator + label
  const stateGlyph = fg(STATE_COLOR[info.state], STATE_GLYPH[info.state]);
  const elapsed = formatElapsed(info.startTime, now);
  lines.push(`${stateGlyph} ${boldFg('text', info.label)} ${dimFg('textMuted', `(${elapsed})`)}`);

  // Progress bar or spinner
  switch (info.state) {
    case 'active':
      if (info.current !== null && info.total !== null && info.total > 0) {
        lines.push(`  ${renderProgressBar(info.current, info.total, options)}`);
        // ETA
        const eta = estimateEta(info.current, info.total, info.startTime, now);
        if (eta) {
          lines.push(dimFg('textMuted', `  ETA: ${eta}`));
        }
      } else {
        lines.push(`  ${renderIndeterminateBar(options)}`);
      }
      break;
    case 'paused':
      lines.push(dimFg('warning', '  ⏸ Paused'));
      break;
    case 'complete':
      lines.push(fg('success', '  ✓ Complete'));
      break;
    case 'error':
      lines.push(fg('error', '  ✗ Failed'));
      break;
    default:
      break;
  }

  // Throughput
  if (info.throughput !== undefined && info.throughput > 0) {
    lines.push(dimFg('textMuted', `  ${formatThroughput(info.throughput)}`));
  }

  // Detail
  if (info.detail) {
    lines.push(dimFg('textMuted', `  ${info.detail}`));
  }

  // Steps
  if (info.steps && info.steps.length > 0) {
    const stepLines = renderStepProgress(info.steps, info.currentStep ?? 0, options);
    lines.push(...stepLines.map((l) => `  ${l}`));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function formatThroughput(itemsPerSec: number): string {
  if (itemsPerSec >= 1000000) return `${(itemsPerSec / 1000000).toFixed(1)}M/s`;
  if (itemsPerSec >= 1000) return `${(itemsPerSec / 1000).toFixed(1)}k/s`;
  return `${itemsPerSec.toFixed(1)}/s`;
}
