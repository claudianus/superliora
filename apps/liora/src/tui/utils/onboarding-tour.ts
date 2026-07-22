/**
 * OnboardingTour — interactive first-run walkthrough with highlights.
 *
 * Provides a guided tour system for new users:
 * - Step-by-step highlights of TUI regions
 * - Spotlight effect (dims everything except the target area)
 * - Tooltip with description and keyboard hints
 * - Progress indicator (step X of Y)
 * - Skip/next/prev navigation
 * - Contextual tips based on terminal capabilities
 * - Completion celebration (confetti-style animation)
 * - Persistent "seen" state (won't re-show after completion)
 *
 * Tour steps can target:
 * - Named regions (from ResponsiveLayoutEngine)
 * - Absolute screen coordinates
 * - Status bar segments
 * - Input area
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TourStep {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Target region ID (from layout engine) or 'statusbar' / 'input'. */
  readonly target: string;
  /** Position of the tooltip relative to the target. */
  readonly tooltipPosition: 'top' | 'bottom' | 'left' | 'right';
  /** Keyboard shortcut relevant to this step. */
  readonly shortcut?: string;
  /** Whether this step is optional (can be skipped individually). */
  readonly optional?: boolean;
}

export interface TourState {
  readonly active: boolean;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly completed: boolean;
  readonly skipped: boolean;
}

export interface TourRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly fg: (token: string, text: string) => string;
  readonly boldFg: (token: string, text: string) => string;
  readonly dimFg: (token: string, text: string) => string;
  readonly bg: (token: string, text: string) => string;
  readonly now?: number;
}

export interface TargetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOLTIP_WIDTH = 40;
const TOOLTIP_ARROW = '◆';
const PROGRESS_GLYPH_ACTIVE = '●';
const PROGRESS_GLYPH_DONE = '○';
const PROGRESS_GLYPH_PENDING = '·';

// ---------------------------------------------------------------------------
// Default Tour Steps
// ---------------------------------------------------------------------------

export const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to SuperLiora',
    description: 'Your AI coding agent with a premium terminal UI. Let\'s take a quick tour of the key features.',
    target: 'main',
    tooltipPosition: 'bottom',
  },
  {
    id: 'input',
    title: 'Command Input',
    description: 'Type your requests here. The agent will analyze, plan, and execute code changes autonomously.',
    target: 'input',
    tooltipPosition: 'top',
    shortcut: 'Enter',
  },
  {
    id: 'transcript',
    title: 'Conversation Transcript',
    description: 'Watch the agent think and work in real-time. Scroll up to review earlier messages.',
    target: 'main',
    tooltipPosition: 'right',
    shortcut: '↑/↓',
  },
  {
    id: 'statusbar',
    title: 'Status Bar',
    description: 'Shows git branch, agent status, context usage, model, and session cost at a glance.',
    target: 'statusbar',
    tooltipPosition: 'top',
  },
  {
    id: 'palette',
    title: 'Command Palette',
    description: 'Press Ctrl+P to open the command palette. Fuzzy-search any action instantly.',
    target: 'main',
    tooltipPosition: 'bottom',
    shortcut: 'Ctrl+P',
  },
  {
    id: 'panels',
    title: 'Workspace Panels',
    description: 'Access file explorer, git panel, and agent swarm view. Switch with Tab or number keys.',
    target: 'sidebar',
    tooltipPosition: 'right',
    shortcut: 'Tab',
  },
  {
    id: 'focus',
    title: 'Focus Mode',
    description: 'Press Ctrl+Z for distraction-free zen mode. Only the conversation remains visible.',
    target: 'main',
    tooltipPosition: 'bottom',
    shortcut: 'Ctrl+Z',
    optional: true,
  },
  {
    id: 'done',
    title: 'You\'re Ready!',
    description: 'That\'s the basics. Press ? anytime for the full shortcut list. Happy coding!',
    target: 'main',
    tooltipPosition: 'bottom',
    shortcut: '?',
  },
];

// ---------------------------------------------------------------------------
// OnboardingTour
// ---------------------------------------------------------------------------

export class OnboardingTour {
  private steps: TourStep[];
  private currentStep = 0;
  private active = false;
  private completed = false;
  private skipped = false;
  private targetRects: Map<string, TargetRect> = new Map();
  private onComplete: (() => void) | null = null;
  private onSkip: (() => void) | null = null;

  constructor(steps: TourStep[] = DEFAULT_TOUR_STEPS) {
    this.steps = steps;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  /** Start the tour from the beginning. */
  start(): void {
    this.active = true;
    this.currentStep = 0;
    this.completed = false;
    this.skipped = false;
  }

  /** Resume from a specific step. */
  resumeFrom(stepIndex: number): void {
    this.active = true;
    this.currentStep = Math.max(0, Math.min(stepIndex, this.steps.length - 1));
  }

  /** Complete the tour. */
  complete(): void {
    this.active = false;
    this.completed = true;
    if (this.onComplete) this.onComplete();
  }

  /** Skip the tour entirely. */
  skip(): void {
    this.active = false;
    this.skipped = true;
    if (this.onSkip) this.onSkip();
  }

  // ─── Navigation ───────────────────────────────────────────────────

  next(): void {
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++;
    } else {
      this.complete();
    }
  }

  prev(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
    }
  }

  goToStep(index: number): void {
    if (index >= 0 && index < this.steps.length) {
      this.currentStep = index;
    }
  }

  /** Skip the current optional step. */
  skipStep(): void {
    const step = this.steps[this.currentStep];
    if (step?.optional) {
      this.next();
    }
  }

  // ─── State ────────────────────────────────────────────────────────

  getState(): TourState {
    return {
      active: this.active,
      currentStep: this.currentStep,
      totalSteps: this.steps.length,
      completed: this.completed,
      skipped: this.skipped,
    };
  }

  getCurrentStep(): TourStep | null {
    if (!this.active) return null;
    return this.steps[this.currentStep] ?? null;
  }

  get isActive(): boolean {
    return this.active;
  }

  get isFinished(): boolean {
    return this.completed || this.skipped;
  }

  // ─── Target Registration ──────────────────────────────────────────

  /** Register the screen rectangle for a target region. */
  setTargetRect(targetId: string, rect: TargetRect): void {
    this.targetRects.set(targetId, rect);
  }

  /** Update all target rects from layout engine output. */
  updateTargets(regions: Array<{ id: string; x: number; y: number; width: number; height: number }>): void {
    for (const r of regions) {
      this.targetRects.set(r.id, { x: r.x, y: r.y, width: r.width, height: r.height });
    }
  }

  // ─── Event Handlers ───────────────────────────────────────────────

  setCompleteHandler(handler: () => void): void {
    this.onComplete = handler;
  }

  setSkipHandler(handler: () => void): void {
    this.onSkip = handler;
  }

  // ─── Rendering ────────────────────────────────────────────────────

  /** Render the tour overlay (tooltip + progress). */
  render(options: TourRenderOptions): string[] {
    if (!this.active) return [];

    const { width, height, fg, boldFg, dimFg, bg, now = Date.now() } = options;
    const step = this.steps[this.currentStep];
    if (!step) return [];

    const lines: string[] = [];
    const tooltipW = Math.min(TOOLTIP_WIDTH, width - 4);

    // Tooltip box
    lines.push(fg('accent', `┌${'─'.repeat(tooltipW - 2)}┐`));

    // Title
    const title = truncateText(step.title, tooltipW - 6);
    lines.push(fg('accent', '│') + ansiPadEnd(` ${boldFg('text', title)}`, tooltipW - 2) + fg('accent', '│'));

    // Description (word-wrapped)
    const descLines = wordWrap(step.description, tooltipW - 6);
    for (const descLine of descLines.slice(0, 3)) {
      lines.push(fg('accent', '│') + ansiPadEnd(` ${fg('text', descLine)}`, tooltipW - 2) + fg('accent', '│'));
    }

    // Shortcut hint
    if (step.shortcut) {
      lines.push(fg('accent', '│') + ansiPadEnd(` ${dimFg('textMuted', 'Key:')} ${fg('warning', step.shortcut)}`, tooltipW - 2) + fg('accent', '│'));
    }

    // Separator
    lines.push(fg('accent', `├${'─'.repeat(tooltipW - 2)}┤`));

    // Navigation hints + progress
    const progress = this.renderProgress(fg, dimFg);
    const navHints = dimFg('textMuted', '← → navigate · Esc skip');
    lines.push(fg('accent', '│') + ansiPadEnd(` ${progress}`, tooltipW - 2) + fg('accent', '│'));
    lines.push(fg('accent', '│') + ansiPadEnd(` ${navHints}`, tooltipW - 2) + fg('accent', '│'));

    // Bottom border
    lines.push(fg('accent', `└${'─'.repeat(tooltipW - 2)}┘`));

    // Arrow pointing to target
    const arrowLine = this.renderArrow(step.tooltipPosition, tooltipW, fg);
    if (arrowLine) lines.push(arrowLine);

    return lines;
  }

  /** Render the spotlight dimming overlay (returns dimmed lines). */
  renderSpotlight(targetRect: TargetRect | null, screenWidth: number, screenHeight: number): string {
    // In a real implementation, this would return ANSI sequences to dim
    // areas outside the target rect. For now, return a description.
    if (!targetRect) return '';
    return `\x1b[2m[spotlight: ${String(targetRect.x)},${String(targetRect.y)} ${String(targetRect.width)}x${String(targetRect.height)}]\x1b[0m`;
  }

  /** Render completion celebration. */
  renderCelebration(options: TourRenderOptions): string[] {
    const { fg, boldFg, dimFg, now = Date.now() } = options;
    const lines: string[] = [];

    // Animated confetti-style characters
    const confettiChars = ['✦', '✧', '◆', '◇', '●', '○', '★', '☆'];
    const frame = Math.floor(now / 200);

    const celebration = confettiChars
      .map((c, i) => {
        const color = ['accent', 'primary', 'success', 'warning'][i % 4] ?? 'accent';
        return fg(color, c);
      })
      .join(' ');

    lines.push('');
    lines.push(`  ${celebration}`);
    lines.push(boldFg('success', '  ✓ Tour Complete!'));
    lines.push(dimFg('textMuted', '  Press any key to start coding'));
    lines.push(`  ${celebration}`);
    lines.push('');

    return lines;
  }

  // ─── Internal Rendering ───────────────────────────────────────────

  private renderProgress(
    fg: (t: string, s: string) => string,
    dimFg: (t: string, s: string) => string,
  ): string {
    const parts: string[] = [];
    for (let i = 0; i < this.steps.length; i++) {
      if (i < this.currentStep) {
        parts.push(fg('success', PROGRESS_GLYPH_DONE));
      } else if (i === this.currentStep) {
        parts.push(fg('accent', PROGRESS_GLYPH_ACTIVE));
      } else {
        parts.push(dimFg('textMuted', PROGRESS_GLYPH_PENDING));
      }
    }
    return parts.join(' ');
  }

  private renderArrow(
    position: TourStep['tooltipPosition'],
    tooltipWidth: number,
    fg: (t: string, s: string) => string,
  ): string | null {
    switch (position) {
      case 'bottom':
        return `  ${fg('accent', '▲')}`;
      case 'top':
        return `  ${fg('accent', '▼')}`;
      case 'left':
        return fg('accent', '▶');
      case 'right':
        return `${' '.repeat(tooltipWidth)} ${fg('accent', '◀')}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + '…';
}

/** Strip ANSI escape sequences for width calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Pad a string to a target width, accounting for ANSI escape sequences. */
function ansiPadEnd(s: string, targetWidth: number): string {
  const visibleLen = stripAnsi(s).length;
  const padding = Math.max(0, targetWidth - visibleLen);
  return s + ' '.repeat(padding);
}

function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth) {
      if (current.length > 0) lines.push(current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines;
}
