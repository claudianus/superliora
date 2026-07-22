/**
 * FocusMode — distraction-free zen mode for the TUI.
 *
 * Provides a minimal-chrome experience for focused work:
 * - Hides all panels, docks, and status bars
 * - Centers content with comfortable margins
 * - Dimmed/breathing ambient background
 * - Typewriter scrolling (keeps cursor centered)
 * - Progressive disclosure (chrome fades back on inactivity)
 * - Session timer and word count for writing flow
 * - Quick exit on Esc or configurable key
 *
 * Modes:
 * - Zen: Maximum minimalism, only text and cursor
 * - Focus: Minimal chrome, status hints visible
 * - Reading: Optimized for reviewing agent output
 *
 * The mode smoothly transitions using the spring animation system,
 * fading chrome elements in/out rather than abrupt show/hide.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FocusModeType = 'zen' | 'focus' | 'reading' | 'off';

export interface FocusModeState {
  readonly mode: FocusModeType;
  /** Transition progress 0-1 (0 = off, 1 = fully in mode). */
  readonly transition: number;
  /** Whether typewriter scrolling is active. */
  readonly typewriterScroll: boolean;
  /** Session start time for timer. */
  readonly sessionStartMs: number;
  /** Characters typed in this session. */
  readonly charCount: number;
  /** Lines of content visible. */
  readonly contentLines: number;
}

export interface FocusModeConfig {
  /** Default mode when activated. */
  readonly defaultMode: FocusModeType;
  /** Margin width (columns) on each side. */
  readonly marginColumns: number;
  /** Maximum content width. */
  readonly maxContentWidth: number;
  /** Whether to show a subtle progress indicator. */
  readonly showProgress: boolean;
  /** Whether to enable typewriter scrolling. */
  readonly typewriterScroll: boolean;
  /** Ambient animation intensity (0-1). */
  readonly ambientIntensity: number;
  /** Auto-exit after inactivity (ms, 0 = disabled). */
  readonly autoExitMs: number;
}

export interface FocusChromeVisibility {
  readonly titleBar: number;
  readonly statusBar: number;
  readonly leftDock: number;
  readonly rightDock: number;
  readonly panelBorders: number;
  readonly scrollBar: number;
  readonly lineNumbers: number;
  readonly breadcrumbs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: FocusModeConfig = {
  defaultMode: 'focus',
  marginColumns: 8,
  maxContentWidth: 100,
  showProgress: true,
  typewriterScroll: true,
  ambientIntensity: 0.3,
  autoExitMs: 0,
};

/** Chrome visibility targets for each mode (0 = hidden, 1 = visible). */
const MODE_CHROME: Record<FocusModeType, FocusChromeVisibility> = {
  off: {
    titleBar: 1,
    statusBar: 1,
    leftDock: 1,
    rightDock: 1,
    panelBorders: 1,
    scrollBar: 1,
    lineNumbers: 1,
    breadcrumbs: 1,
  },
  zen: {
    titleBar: 0,
    statusBar: 0,
    leftDock: 0,
    rightDock: 0,
    panelBorders: 0,
    scrollBar: 0,
    lineNumbers: 0,
    breadcrumbs: 0,
  },
  focus: {
    titleBar: 0,
    statusBar: 0.3,
    leftDock: 0,
    rightDock: 0,
    panelBorders: 0.2,
    scrollBar: 0.3,
    lineNumbers: 0,
    breadcrumbs: 0,
  },
  reading: {
    titleBar: 0,
    statusBar: 0.5,
    leftDock: 0,
    rightDock: 0.5,
    panelBorders: 0.3,
    scrollBar: 0.5,
    lineNumbers: 0.5,
    breadcrumbs: 0.3,
  },
};

// ---------------------------------------------------------------------------
// FocusMode Controller
// ---------------------------------------------------------------------------

export class FocusModeController {
  private _mode: FocusModeType = 'off';
  private _transition = 0;
  private _targetTransition = 0;
  private config: FocusModeConfig;
  private sessionStartMs = 0;
  private charCount = 0;
  private lastActivityMs = 0;
  private typewriterLine = -1;

  // Spring animation for smooth transitions
  private transitionVelocity = 0;
  private readonly springStiffness = 120;
  private readonly springDamping = 14;

  constructor(config?: Partial<FocusModeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Mode Control ─────────────────────────────────────────────────

  /** Activate focus mode. */
  activate(mode?: FocusModeType): void {
    this._mode = mode ?? this.config.defaultMode;
    this._targetTransition = 1;
    this.sessionStartMs = Date.now();
    this.charCount = 0;
    this.lastActivityMs = Date.now();
  }

  /** Deactivate focus mode. */
  deactivate(): void {
    this._mode = 'off';
    this._targetTransition = 0;
  }

  /** Toggle focus mode on/off. */
  toggle(): void {
    if (this._mode === 'off') {
      this.activate();
    } else {
      this.deactivate();
    }
  }

  /** Cycle through modes: off → focus → zen → reading → off. */
  cycle(): void {
    const order: FocusModeType[] = ['off', 'focus', 'zen', 'reading'];
    const idx = order.indexOf(this._mode);
    this._mode = order[(idx + 1) % order.length]!;
    this._targetTransition = this._mode === 'off' ? 0 : 1;
    if (this._mode !== 'off' && this.sessionStartMs === 0) {
      this.sessionStartMs = Date.now();
    }
  }

  get mode(): FocusModeType {
    return this._mode;
  }

  get isActive(): boolean {
    return this._mode !== 'off';
  }

  get transition(): number {
    return this._transition;
  }

  // ─── Animation ────────────────────────────────────────────────────

  /** Update the transition animation. Call every frame. */
  update(dtMs: number): void {
    const dt = Math.min(dtMs / 1000, 0.064); // Clamp to prevent instability

    // Spring physics for smooth transition
    const displacement = this._targetTransition - this._transition;
    const springForce = displacement * this.springStiffness;
    const dampingForce = -this.transitionVelocity * this.springDamping;
    const acceleration = springForce + dampingForce;

    this.transitionVelocity += acceleration * dt;
    this._transition += this.transitionVelocity * dt;

    // Clamp and settle
    if (Math.abs(displacement) < 0.001 && Math.abs(this.transitionVelocity) < 0.001) {
      this._transition = this._targetTransition;
      this.transitionVelocity = 0;
    }
    this._transition = Math.max(0, Math.min(1, this._transition));

    // Auto-exit check
    if (this.config.autoExitMs > 0 && this.isActive) {
      const now = Date.now();
      if (now - this.lastActivityMs > this.config.autoExitMs) {
        this.deactivate();
      }
    }
  }

  // ─── Activity Tracking ────────────────────────────────────────────

  /** Report user activity (typing, scrolling, etc). */
  reportActivity(): void {
    this.lastActivityMs = Date.now();
  }

  /** Report character input for word count. */
  reportInput(chars: number): void {
    this.charCount += chars;
    this.reportActivity();
  }

  /** Set the typewriter target line (keeps this line centered). */
  setTypewriterLine(line: number): void {
    this.typewriterLine = line;
  }

  // ─── Layout Computation ───────────────────────────────────────────

  /** Get chrome visibility values (interpolated during transition). */
  getChromeVisibility(): FocusChromeVisibility {
    const target = MODE_CHROME[this._mode];
    const off = MODE_CHROME.off;
    const t = this._transition;

    return {
      titleBar: lerp(off.titleBar, target.titleBar, t),
      statusBar: lerp(off.statusBar, target.statusBar, t),
      leftDock: lerp(off.leftDock, target.leftDock, t),
      rightDock: lerp(off.rightDock, target.rightDock, t),
      panelBorders: lerp(off.panelBorders, target.panelBorders, t),
      scrollBar: lerp(off.scrollBar, target.scrollBar, t),
      lineNumbers: lerp(off.lineNumbers, target.lineNumbers, t),
      breadcrumbs: lerp(off.breadcrumbs, target.breadcrumbs, t),
    };
  }

  /** Compute the content area dimensions for the current mode. */
  computeContentArea(termWidth: number, termHeight: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    if (!this.isActive || this._transition < 0.01) {
      return { x: 0, y: 0, width: termWidth, height: termHeight };
    }

    const t = this._transition;
    const margin = Math.round(this.config.marginColumns * t);
    const contentWidth = Math.min(
      this.config.maxContentWidth,
      termWidth - margin * 2,
    );
    const x = Math.round((termWidth - contentWidth) / 2);

    // Vertical margins (smaller)
    const vMargin = Math.round(2 * t);
    const contentHeight = termHeight - vMargin * 2;

    return {
      x,
      y: vMargin,
      width: Math.max(20, contentWidth),
      height: Math.max(5, contentHeight),
    };
  }

  /** Compute typewriter scroll offset to keep target line centered. */
  computeTypewriterScroll(
    viewportHeight: number,
    totalLines: number,
    currentLine: number,
  ): number {
    if (!this.config.typewriterScroll || this.typewriterLine < 0) {
      return -1; // No override
    }

    const targetLine = this.typewriterLine >= 0 ? this.typewriterLine : currentLine;
    const centerLine = Math.floor(viewportHeight / 2);
    const scrollTarget = targetLine - centerLine;

    return Math.max(0, Math.min(totalLines - viewportHeight, scrollTarget));
  }

  // ─── Status ───────────────────────────────────────────────────────

  /** Get the current state snapshot. */
  get state(): FocusModeState {
    return {
      mode: this._mode,
      transition: this._transition,
      typewriterScroll: this.config.typewriterScroll,
      sessionStartMs: this.sessionStartMs,
      charCount: this.charCount,
      contentLines: 0, // Set by caller
    };
  }

  /** Get session duration in ms. */
  get sessionDurationMs(): number {
    if (this.sessionStartMs === 0) return 0;
    return Date.now() - this.sessionStartMs;
  }

  /** Get words per minute (based on char count). */
  get wordsPerMinute(): number {
    const minutes = this.sessionDurationMs / 60000;
    if (minutes < 0.1) return 0;
    const words = this.charCount / 5; // Rough estimate
    return Math.round(words / minutes);
  }

  /** Update configuration. */
  configure(patch: Partial<FocusModeConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  get currentConfig(): FocusModeConfig {
    return this.config;
  }
}

// ---------------------------------------------------------------------------
// Ambient Effects for Focus Mode
// ---------------------------------------------------------------------------

/**
 * Compute ambient background intensity for focus mode.
 * Creates a subtle breathing effect to reduce eye strain.
 */
export function focusAmbientIntensity(
  timeMs: number,
  config: FocusModeConfig,
  transition: number,
): number {
  if (transition < 0.01) return 0;

  // Slow breathing cycle (8 seconds)
  const breathCycle = Math.sin((timeMs / 8000) * Math.PI * 2) * 0.5 + 0.5;
  const baseIntensity = config.ambientIntensity * transition;

  return baseIntensity * (0.7 + breathCycle * 0.3);
}

/**
 * Generate a subtle gradient background for focus mode.
 * Returns ANSI escape sequences for a vertical gradient.
 */
export function focusGradientBackground(
  height: number,
  intensity: number,
  hue: number = 220, // Blue-ish
): string[] {
  const lines: string[] = [];
  for (let row = 0; row < height; row++) {
    const t = row / Math.max(1, height - 1);
    // Darker at top and bottom, slightly lighter in middle
    const lightness = 8 + Math.sin(t * Math.PI) * 4 * intensity;
    const l = Math.round(lightness);
    lines.push(`\x1b[48;2;${String(l)};${String(l)};${String(Math.round(l * 1.2))}m`);
  }
  return lines;
}

/**
 * Render a minimal progress indicator for focus mode.
 * Shows elapsed time and character count subtly.
 */
export function focusProgressIndicator(
  durationMs: number,
  charCount: number,
  fg: (token: string, text: string) => string,
): string {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const words = Math.floor(charCount / 5);

  return fg('textMuted', `${timeStr} · ${String(words)}w`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
