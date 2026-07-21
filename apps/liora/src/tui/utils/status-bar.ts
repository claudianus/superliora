/**
 * Bloomberg Terminal-style status bar rendered at the bottom of the TUI.
 * Shows: git branch | active panel | agent status | model | context usage |
 * session cost | time. Theme-aware (PREMIUM.md): every color flows through
 * `currentTheme`, no hardcoded ANSI and no module-top-level cached styles so
 * theme switches take effect within a single render frame.
 */

import { execSync } from 'node:child_process';

import { currentTheme } from '#/tui/theme';
import {
  renderPulseText,
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

export interface StatusBarData {
  /** Current git branch name (if in a git repo). */
  gitBranch?: string;
  /** Agent streaming phase. */
  agentStatus: 'idle' | 'thinking' | 'working' | 'error';
  /** Context token usage ratio (0-1). */
  contextUsage?: number;
  /** Active panel title. */
  activePanel?: string;
  /** Context tokens used. */
  contextTokens?: number;
  /** Max context tokens. */
  maxContextTokens?: number;
  /** Current model name. */
  model?: string;
  /** Accumulated session cost in USD (best-effort; omitted when unknown). */
  sessionCostUsd?: number;
  /** Current turn/step number during streaming (1-based). */
  currentStep?: number;
  /** Total expected steps (0 = indeterminate). */
  totalSteps?: number;
}

/** Cache git branch to avoid spawning a process every frame. */
let cachedBranch: string | undefined;
let branchCacheTime = 0;
const BRANCH_CACHE_TTL = 10_000; // 10 seconds

function getGitBranch(cwd: string): string | undefined {
  const now = Date.now();
  if (cachedBranch !== undefined && now - branchCacheTime < BRANCH_CACHE_TTL) {
    return cachedBranch;
  }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd,
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    cachedBranch = branch || undefined;
  } catch {
    cachedBranch = undefined;
  }
  branchCacheTime = now;
  return cachedBranch;
}

const STATUS_LABELS = {
  idle: '대기',
  thinking: '추론',
  working: '작업',
  error: '오류',
} as const;

/** Status dot glyph + theme token, resolved at render time (theme-safe). */
function renderStatusBadge(status: StatusBarData['agentStatus']): string {
  const appearance = getActiveAppearancePreferences();
  const animate = shouldRenderAmbientEffects(appearance);
  switch (status) {
    case 'thinking':
      return animate
        ? renderPulseText(`◐ ${STATUS_LABELS.thinking}`, 'status:thinking', 'warning', appearance)
        : `${currentTheme.fg('warning', '◐')} ${STATUS_LABELS.thinking}`;
    case 'working':
      return animate
        ? renderPulseText(`◉ ${STATUS_LABELS.working}`, 'status:working', 'accent', appearance)
        : `${currentTheme.fg('accent', '◉')} ${STATUS_LABELS.working}`;
    case 'error':
      return `${currentTheme.fg('error', '✖')} ${STATUS_LABELS.error}`;
    case 'idle':
    default:
      return `${currentTheme.fg('success', '●')} ${STATUS_LABELS.idle}`;
  }
}

/** Render a compact streaming progress indicator (step dots or bar). */
function renderStreamingProgress(data: StatusBarData): string | undefined {
  if (data.agentStatus === 'idle' || data.agentStatus === 'error') return undefined;
  const appearance = getActiveAppearancePreferences();
  const animate = shouldRenderAmbientEffects(appearance);

  if (data.currentStep !== undefined && data.totalSteps !== undefined && data.totalSteps > 0) {
    // Determinate: show step dots
    const total = Math.min(data.totalSteps, 8); // cap visual dots
    const current = Math.min(data.currentStep, total);
    const filled = '●'.repeat(current);
    const empty = '○'.repeat(total - current);
    const dots = `${filled}${empty}`;
    return animate
      ? renderPulseText(dots, 'status:steps', 'primary', appearance)
      : currentTheme.fg('primary', dots);
  }

  // Indeterminate: animated spinner dots
  const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
  const frameIdx = Math.floor(Date.now() / 120) % SPINNER_FRAMES.length;
  const spinner = SPINNER_FRAMES[frameIdx]!;
  return animate
    ? renderPulseText(spinner, 'status:spinner', 'accent', appearance)
    : currentTheme.fg('accent', spinner);
}

/** Strip ANSI escape sequences for length calculation. */
function stripAnsi(s: string): string {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/** Format token count as human-readable (e.g. 12.3k, 1.2M). */
function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a USD cost compactly (e.g. $0.0042, $1.23). */
function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Render the status bar as a single line of terminal-width text.
 * Lower-priority right segments (cost, model) are dropped on narrow widths so
 * the bar never overflows badly.
 */
export function renderStatusBar(data: StatusBarData, columns: number, cwd: string): string {
  const sep = ` ${currentTheme.dimFg('textDim', '│')} `;
  const leftParts: string[] = [];

  // Git branch
  const branch = data.gitBranch ?? getGitBranch(cwd);
  if (branch) {
    leftParts.push(currentTheme.fg('accent', ` ${branch}`));
  }

  // Active panel
  if (data.activePanel) {
    leftParts.push(currentTheme.boldFg('textStrong', data.activePanel));
  }

  // Agent status
  leftParts.push(renderStatusBadge(data.agentStatus));

  // Streaming progress (step dots or spinner)
  const progressSegment = renderStreamingProgress(data);
  if (progressSegment) {
    leftParts.push(progressSegment);
  }

  // Right side segments. Visual order: model │ context │ cost │ time.
  // Keep-priority when narrow: time > context > model > cost.

  // Time (HH:MM) — always shown, rightmost.
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const timeSegment = currentTheme.dimFg('textMuted', timeStr);

  // Context usage
  let contextSegment: string | undefined;
  if (data.contextUsage !== undefined && data.contextUsage > 0) {
    const pct = Math.round(data.contextUsage * 100);
    const token = pct > 80 ? 'error' : pct > 50 ? 'warning' : 'success';
    const tokenInfo = data.contextTokens !== undefined && data.maxContextTokens !== undefined
      ? `${formatTokenCount(data.contextTokens)}/${formatTokenCount(data.maxContextTokens)}`
      : `${pct}%`;
    // Compact visual bar: ▓▓▓▓░░░░░░ 42%
    const BAR_WIDTH = 6;
    const filled = Math.round(data.contextUsage * BAR_WIDTH);
    const bar = '▓'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
    contextSegment = `${currentTheme.fg(token, bar)} ${currentTheme.fg(token, tokenInfo)}`;
  }

  // Model name (shortened)
  let modelSegment: string | undefined;
  if (data.model) {
    const shortModel = data.model.replace(/^claude-/, '').replace(/-\d{8}$/, '');
    modelSegment = currentTheme.dimFg('textMuted', shortModel);
  }

  // Session cost
  let costSegment: string | undefined;
  if (data.sessionCostUsd !== undefined && data.sessionCostUsd > 0) {
    costSegment = currentTheme.fg('textDim', formatCost(data.sessionCostUsd));
  }

  // Assemble the right side. Visual order: model │ context │ cost │ time.
  // Keep-priority when narrow: time (always) > context > model > cost.
  const left = ` ${leftParts.join(sep)}`;
  const leftLen = stripAnsi(left).length;
  const sepLen = stripAnsi(sep).length;

  const optional: { segment: string; priority: number; order: number }[] = [];
  let order = 0;
  if (modelSegment) optional.push({ segment: modelSegment, priority: 2, order: order++ });
  if (contextSegment) optional.push({ segment: contextSegment, priority: 3, order: order++ });
  if (costSegment) optional.push({ segment: costSegment, priority: 1, order: order++ });

  const baseRightLen = stripAnsi(timeSegment).length + 1; // time + trailing space
  let budget = columns - leftLen - sepLen - baseRightLen;
  const kept: typeof optional = [];
  // Keep highest-priority segments first so important data survives narrow widths.
  for (const entry of [...optional].sort((a, b) => b.priority - a.priority)) {
    const segLen = stripAnsi(entry.segment).length + sepLen;
    if (segLen <= budget) {
      kept.push(entry);
      budget -= segLen;
    }
  }
  // Render the survivors in visual order, time always rightmost.
  kept.sort((a, b) => a.order - b.order);
  const rightSegments = kept.map((e) => e.segment);
  const right = `${rightSegments.join(sep)}${rightSegments.length > 0 ? sep : ''}${timeSegment} `;

  const rightLen = stripAnsi(right).length;
  const padding = Math.max(1, columns - leftLen - rightLen);

  return `${left}${' '.repeat(padding)}${right}`;
}
