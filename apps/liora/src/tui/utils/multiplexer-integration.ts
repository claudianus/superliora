/**
 * MultiplexerIntegration — tmux/zellij awareness for the TUI.
 *
 * Detects and integrates with terminal multiplexers to:
 * - Detect if running inside tmux/zellij/screen
 * - Query pane/window layout for responsive decisions
 * - Send passthrough sequences (kitty graphics inside tmux)
 * - Coordinate split panes for multi-session monitoring
 * - Detect focus events from the multiplexer
 *
 * This enables the TUI to:
 * - Adjust rendering when in a small split pane
 * - Use tmux's native split for session monitoring
 * - Passthrough kitty graphics protocol through tmux
 * - Detect when the terminal is in a background pane
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MultiplexerType = 'tmux' | 'zellij' | 'screen' | 'none';

export interface MultiplexerInfo {
  readonly type: MultiplexerType;
  readonly version: string | null;
  readonly sessionId: string | null;
  readonly windowId: string | null;
  readonly paneId: string | null;
  readonly paneWidth: number;
  readonly paneHeight: number;
  readonly paneActive: boolean;
  readonly paneTitle: string | null;
}

export interface TmuxPaneInfo {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly active: boolean;
  readonly title: string;
  readonly currentCommand: string;
}

export interface MultiplexerCapabilities {
  /** Whether passthrough sequences are supported. */
  readonly passthrough: boolean;
  /** Whether we can query pane info. */
  readonly paneQuery: boolean;
  /** Whether we can create splits. */
  readonly splitControl: boolean;
  /** Whether focus events are available. */
  readonly focusEvents: boolean;
  /** Whether true color is preserved. */
  readonly trueColor: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMUX_PASSTHROUGH_PREFIX = '\x1bPtmux;';
const TMUX_PASSTHROUGH_SUFFIX = '\x1b\\';

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect the terminal multiplexer from environment variables.
 */
export function detectMultiplexer(env: Record<string, string | undefined> = process.env): MultiplexerType {
  if (env['TMUX'] !== undefined) return 'tmux';
  if (env['ZELLIJ'] !== undefined || env['ZELLIJ_SESSION_NAME'] !== undefined) return 'zellij';
  if (env['STY'] !== undefined || env['WINDOW'] !== undefined) return 'screen';
  return 'none';
}

/**
 * Get detailed multiplexer information.
 * Uses environment variables and optionally queries the multiplexer.
 */
export function getMultiplexerInfo(
  env: Record<string, string | undefined> = process.env,
  columns?: number,
  rows?: number,
): MultiplexerInfo {
  const type = detectMultiplexer(env);

  switch (type) {
    case 'tmux':
      return getTmuxInfo(env, columns, rows);
    case 'zellij':
      return getZellijInfo(env, columns, rows);
    case 'screen':
      return getScreenInfo(env, columns, rows);
    default:
      return {
        type: 'none',
        version: null,
        sessionId: null,
        windowId: null,
        paneId: null,
        paneWidth: columns ?? process.stdout.columns ?? 80,
        paneHeight: rows ?? process.stdout.rows ?? 24,
        paneActive: true,
        paneTitle: null,
      };
  }
}

/**
 * Get capabilities for the detected multiplexer.
 */
export function getMultiplexerCapabilities(type: MultiplexerType): MultiplexerCapabilities {
  switch (type) {
    case 'tmux':
      return {
        passthrough: true,
        paneQuery: true,
        splitControl: true,
        focusEvents: true,
        trueColor: true, // tmux 3.2+ with -Tc or -2
      };
    case 'zellij':
      return {
        passthrough: false, // Zellij handles kitty graphics natively
        paneQuery: true,
        splitControl: true,
        focusEvents: true,
        trueColor: true,
      };
    case 'screen':
      return {
        passthrough: false,
        paneQuery: false,
        splitControl: true,
        focusEvents: false,
        trueColor: false, // screen has limited true color support
      };
    default:
      return {
        passthrough: false,
        paneQuery: false,
        splitControl: false,
        focusEvents: false,
        trueColor: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Tmux Integration
// ---------------------------------------------------------------------------

function getTmuxInfo(
  env: Record<string, string | undefined>,
  columns?: number,
  rows?: number,
): MultiplexerInfo {
  const tmuxEnv = env['TMUX'] ?? '';
  const parts = tmuxEnv.split(',');
  const socketPath = parts[0] ?? null;
  const serverPid = parts[1] ?? null;
  const sessionId = parts[2] ?? null;

  // Parse pane info from TMUX_PANE
  const paneId = env['TMUX_PANE'] ?? null;

  return {
    type: 'tmux',
    version: null, // Would require tmux -V query
    sessionId,
    windowId: null,
    paneId,
    paneWidth: columns ?? process.stdout.columns ?? 80,
    paneHeight: rows ?? process.stdout.rows ?? 24,
    paneActive: true, // Assume active; would need focus-events
    paneTitle: null,
    // Store extra info for potential queries
    ...({ socketPath, serverPid } as Record<string, unknown>),
  };
}

/**
 * Wrap a sequence for tmux passthrough.
 * Required for kitty graphics protocol inside tmux.
 */
export function tmuxPassthrough(sequence: string): string {
  // Escape inner escape sequences for tmux
  const escaped = sequence.replaceAll('\x1b', '\x1b\x1b');
  return `${TMUX_PASSTHROUGH_PREFIX}${escaped}${TMUX_PASSTHROUGH_SUFFIX}`;
}

/**
 * Generate tmux commands for split pane management.
 * Returns shell commands that can be executed.
 */
export function tmuxSplitCommands(options: {
  readonly direction: 'horizontal' | 'vertical';
  readonly command?: string;
  readonly size?: string;
  readonly targetPane?: string;
}): string[] {
  const args: string[] = ['split-window'];

  if (options.direction === 'horizontal') {
    args.push('-h');
  } else {
    args.push('-v');
  }

  if (options.size) {
    args.push('-l', options.size);
  }

  if (options.targetPane) {
    args.push('-t', options.targetPane);
  }

  if (options.command) {
    args.push(options.command);
  }

  return ['tmux', ...args];
}

/**
 * Generate tmux command to select/focus a pane.
 */
export function tmuxSelectPane(paneId: string): string[] {
  return ['tmux', 'select-pane', '-t', paneId];
}

/**
 * Generate tmux command to resize a pane.
 */
export function tmuxResizePane(paneId: string, width?: number, height?: number): string[] {
  const args = ['tmux', 'resize-pane', '-t', paneId];
  if (width !== undefined) {
    args.push('-x', String(width));
  }
  if (height !== undefined) {
    args.push('-y', String(height));
  }
  return args;
}

// ---------------------------------------------------------------------------
// Zellij Integration
// ---------------------------------------------------------------------------

function getZellijInfo(
  env: Record<string, string | undefined>,
  columns?: number,
  rows?: number,
): MultiplexerInfo {
  return {
    type: 'zellij',
    version: null,
    sessionId: env['ZELLIJ_SESSION_NAME'] ?? null,
    windowId: null,
    paneId: null, // Zellij doesn't expose pane ID via env
    paneWidth: columns ?? process.stdout.columns ?? 80,
    paneHeight: rows ?? process.stdout.rows ?? 24,
    paneActive: true,
    paneTitle: null,
  };
}

/**
 * Generate zellij commands for pane management.
 */
export function zellijPaneCommands(options: {
  readonly direction: 'right' | 'down';
  readonly command?: string;
  readonly name?: string;
}): string[] {
  const args = ['zellij', 'action', 'new-pane'];

  if (options.direction === 'right') {
    args.push('--direction', 'right');
  } else {
    args.push('--direction', 'down');
  }

  if (options.name) {
    args.push('--name', options.name);
  }

  if (options.command) {
    args.push('--', options.command);
  }

  return args;
}

// ---------------------------------------------------------------------------
// Screen Integration
// ---------------------------------------------------------------------------

function getScreenInfo(
  env: Record<string, string | undefined>,
  columns?: number,
  rows?: number,
): MultiplexerInfo {
  return {
    type: 'screen',
    version: null,
    sessionId: env['STY'] ?? null,
    windowId: env['WINDOW'] ?? null,
    paneId: null,
    paneWidth: columns ?? process.stdout.columns ?? 80,
    paneHeight: rows ?? process.stdout.rows ?? 24,
    paneActive: true,
    paneTitle: null,
  };
}

// ---------------------------------------------------------------------------
// Responsive Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if we're in a constrained split pane.
 * Used to adjust TUI layout for small panes.
 */
export function isConstrainedPane(info: MultiplexerInfo): boolean {
  return info.paneWidth < 80 || info.paneHeight < 24;
}

/**
 * Get the effective rendering dimensions considering multiplexer chrome.
 * Tmux status line, zellij frame, etc.
 */
export function getEffectiveDimensions(
  info: MultiplexerInfo,
  columns: number,
  rows: number,
): { width: number; height: number } {
  let height = rows;

  // Tmux status line takes 1 row (top or bottom)
  if (info.type === 'tmux') {
    height = Math.max(1, height - 1);
  }

  // Zellij frame takes 2 rows (top + bottom) and 2 cols (left + right)
  if (info.type === 'zellij') {
    height = Math.max(1, height - 2);
    return { width: Math.max(1, columns - 2), height };
  }

  return { width: columns, height };
}

/**
 * Check if kitty graphics passthrough is needed.
 */
export function needsKittyPassthrough(info: MultiplexerInfo): boolean {
  return info.type === 'tmux';
}

/**
 * Wrap kitty graphics sequence for the current multiplexer.
 */
export function wrapForMultiplexer(sequence: string, info: MultiplexerInfo): string {
  if (needsKittyPassthrough(info)) {
    return tmuxPassthrough(sequence);
  }
  return sequence;
}
