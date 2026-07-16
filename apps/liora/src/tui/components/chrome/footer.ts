/**
 * Footer/status bar — multi-line status display at the bottom of the TUI.
 *
 * Layout:
 *   Line 1: [yolo] [ultrawork] [plan] <model> <cwd>  <git-badge>  <shortcut hints>
 *   Line 2: context: XX.X% (tokens/max)
 */

import type { Component, RendererViewportSnapshot } from '#/tui/renderer';
import {
  projectRendererViewportHistoryStatus,
  truncateToWidth,
  visibleWidth,
} from '#/tui/renderer';
import chalk from 'chalk';

import { ALL_TIPS, type ToolbarTip } from '#/tui/constant/tips';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import type { ColorPalette } from '#/tui/theme/colors';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  renderAnimatedGradientText,
  renderPulseText,
  renderShimmerPrefix,
} from '#/tui/utils/appearance-effects';
import {
  createGitStatusCache,
  formatGitBadgeBase,
  formatPullRequestBadge,
  type GitStatus,
  type GitStatusCache,
} from '#/utils/git/git-status';
import { formatTokenCount, safeUsageRatio } from '#/utils/usage/usage-format';
import { ttui } from '#/tui/utils/tui-i18n';

const MAX_CWD_SEGMENTS = 3;
const GOAL_TIMER_INTERVAL_MS = 1_000;
const SOTA_GOAL_OBJECTIVE_PATTERN = /\b(?:ultrawork|sota|harness|tui|liorabench|zdr)\b|super\s+kimi/i;

// Toolbar tips — rotates every 10s. Most tips are short and pair up (two
// joined by " | ") when space allows; tips flagged `solo` are long or
// important enough to take the whole slot on their own. A `priority` weight
// makes a tip recur more often in the rotation (default 1). Width is always
// the final arbiter (a pair that doesn't fit falls back to its first tip).
const TIP_ROTATE_INTERVAL_MS = 10_000;
const TIP_SEPARATOR = ' | ';
type FooterTranscriptViewportSnapshot = Pick<
  RendererViewportSnapshot,
  'followOutput' | 'offsetFromBottom'
>;

/**
 * Expand tips into a rotation sequence using smooth weighted round-robin
 * (the nginx SWRR algorithm). Higher-`priority` tips appear more often while
 * staying evenly spread, so a tip generally does not land next to its own
 * duplicate. Deterministic and computed once at module load. Exported for
 * unit testing.
 */
export function buildWeightedTips(tips: readonly ToolbarTip[]): readonly ToolbarTip[] {
  const items = tips.map((t) => ({
    tip: t,
    weight: Math.max(1, Math.trunc(t.priority ?? 1)),
    current: 0,
  }));
  const total = items.reduce((sum, it) => sum + it.weight, 0);
  const seq: ToolbarTip[] = [];
  for (let n = 0; n < total; n++) {
    let best = items[0]!;
    for (const it of items) {
      it.current += it.weight;
      if (it.current > best.current) best = it;
    }
    best.current -= total;
    seq.push(best.tip);
  }
  return seq;
}

const ROTATION: readonly ToolbarTip[] = buildWeightedTips(ALL_TIPS);

function currentTipIndex(): number {
  return Math.floor(Date.now() / TIP_ROTATE_INTERVAL_MS);
}

/**
 * Pick the tip(s) for a rotation index over the weighted ROTATION sequence.
 * `primary` is always shown when it fits; `pair` (primary + next tip joined
 * by the separator) is offered for wide terminals. Pairing is skipped when
 * the current/next tip is `solo` or when the neighbour is a duplicate of the
 * current tip (which can happen at the wrap boundary), keeping long/important
 * tips on their own and avoiding "X | X".
 */
function tipsForIndex(index: number): { primary: string; pair: string | null } {
  const n = ROTATION.length;
  if (n === 0) return { primary: '', pair: null };
  const offset = ((index % n) + n) % n;
  const current = ROTATION[offset]!;
  if (n === 1 || current.solo) return { primary: current.text, pair: null };
  const next = ROTATION[(offset + 1) % n]!;
  if (next.solo || next.text === current.text) return { primary: current.text, pair: null };
  return { primary: current.text, pair: current.text + TIP_SEPARATOR + next.text };
}

/**
 * Footer goal badge, e.g. `[goal ● active · 4m · 7 turns]`. Only shown for a
 * live (active/paused) goal; terminal/no goal -> no badge. Turn count is a raw
 * count unless an explicit turn budget is set, in which case it shows used/limit.
 */
function formatGoalBadge(
  goal: AppState['goal'],
  colors: ColorPalette,
  wallClockMs?: number,
): string | null {
  if (goal === null || goal === undefined) return null;
  // Show the badge for every persisted, resumable status. `complete` clears the
  // goal, so it never reaches here; only the unset case returns null.
  if (goal.status !== 'active' && goal.status !== 'paused' && goal.status !== 'blocked') {
    return null;
  }
  const dotColor =
    goal.status === 'active'
      ? colors.primary
      : goal.status === 'blocked'
        ? colors.warning
        : colors.textMuted;
  const turns =
    goal.budget.turnBudget !== null
      ? `${goal.turnsUsed}/${goal.budget.turnBudget} turns`
      : `${goal.turnsUsed} ${goal.turnsUsed === 1 ? 'turn' : 'turns'}`;
  const elapsed = formatBadgeElapsed(wallClockMs ?? goal.wallClockMs);
  const isSotaGoal = SOTA_GOAL_OBJECTIVE_PATTERN.test(goal.objective);
  const label = `${goal.status} · ${elapsed} · ${turns}`;
  if (isSotaGoal) {
    return (
      chalk.hex(colors.textMuted)('[goal ') +
      chalk.hex(dotColor)('●') +
      chalk.hex(colors.textMuted)(' ') +
      chalk.hex(colors.primary).bold('SuperLiora SOTA') +
      chalk.hex(colors.textMuted)(` / ${label}]`)
    );
  }
  return (
    chalk.hex(colors.textMuted)('[goal ') +
    chalk.hex(dotColor)('●') +
    chalk.hex(colors.textMuted)(` ${label}]`)
  );
}

function formatBadgeElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function modelDisplayName(state: AppState): string {
  const model = state.availableModels[state.model];
  return model?.displayName ?? model?.model ?? state.model;
}

function shortenCwd(path: string): string {
  if (!path) return path;
  const home = process.env['HOME'] ?? '';
  let work = path;
  if (home && path === home) {
    return '~';
  }
  if (home && path.startsWith(home + '/')) {
    work = '~' + path.slice(home.length);
  }

  const segments = work.split('/').filter((s) => s.length > 0);
  if (segments.length <= MAX_CWD_SEGMENTS) return work;
  const tail = segments.slice(-MAX_CWD_SEGMENTS).join('/');
  return `…/${tail}`;
}

function safeUsage(usage: number): number {
  return safeUsageRatio(usage);
}

function formatContextStatus(usage: number, tokens?: number, maxTokens?: number): string {
  const ratio = safeUsage(usage);
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const bar = renderContextUsageBar(ratio);
  if (maxTokens && maxTokens > 0 && tokens !== undefined) {
    return `context: ${bar} ${pct} (${formatTokenCount(tokens)}/${formatTokenCount(maxTokens)})`;
  }
  return `context: ${bar} ${pct}`;
}

function renderContextUsageBar(ratio: number): string {
  // 10-cell high-res bar with eighths partial fill for demo-grade pressure glance.
  const width = 10;
  const totalEighths = Math.max(0, Math.min(width * 8, Math.round(ratio * width * 8)));
  const fullCells = Math.floor(totalEighths / 8);
  const rem = totalEighths % 8;
  const PARTIAL = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;
  const partial = PARTIAL[rem] ?? '';
  const usedCells = fullCells + (partial.length > 0 ? 1 : 0);
  return `${'█'.repeat(fullCells)}${partial}${'░'.repeat(Math.max(0, width - usedCells))}`;
}

export type FooterBadgeSeverity = 'muted' | 'info' | 'warning' | 'danger';

export interface FooterBadge {
  readonly text: string;
  readonly severity: FooterBadgeSeverity;
}

function styleFooterBadge(
  badge: FooterBadge,
  colors: ColorPalette,
  appearance: AppState['appearance'] | undefined,
): string {
  if (badge.severity === 'danger') {
    return renderPulseText(badge.text, `footer:badge:${badge.text}`, 'error', appearance);
  }
  const hex =
    badge.severity === 'warning'
      ? colors.warning
      : badge.severity === 'info'
        ? colors.primary
        : colors.textMuted;
  return chalk.hex(hex).bold(badge.text);
}

/** Evidence-missing badge for Context OS continuity (T4 durable IDs). */
export function formatContextOSFooterBadge(
  contextOS: AppState['contextOS'],
): FooterBadge | null {
  if (contextOS === undefined || contextOS === null || contextOS.pageCount <= 0) {
    return null;
  }
  if (contextOS.missingEvidencePageCount > 0) {
    return {
      text: `ctx-os:evidence↓${contextOS.evidenceIdRecallScore.toFixed(2)}`,
      severity: 'danger',
    };
  }
  if (contextOS.latestContinuityStatus !== 'ready') {
    return {
      text: `ctx-os:${contextOS.latestContinuityStatus}`,
      severity: 'warning',
    };
  }
  return null;
}

/** Micro tool-result clearing badge (primary cheap context path). */
export function formatMicroCompactionFooterBadge(
  micro: AppState['microCompaction'],
): FooterBadge | null {
  if (micro === undefined || micro === null || micro.total <= 0) return null;
  const last = micro.lastTrigger ?? 'micro';
  const severity: FooterBadgeSeverity =
    last === 'swarm_pressure' || last === 'usage_and_cache_miss' ? 'warning' : 'info';
  const short =
    last === 'usage_and_cache_miss'
      ? 'cache-miss'
      : last === 'swarm_pressure'
        ? 'swarm'
        : last;
  return {
    text: `μ:${short}×${String(micro.total)}`,
    severity,
  };
}


function nonEmptyEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** True when a zero-config image provider key is present in the process env. */
export function mediaImageKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['OPENAI_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

/** True when a zero-config video provider key is present (Google/Gemini). */
export function mediaVideoKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    nonEmptyEnv(env['GOOGLE_API_KEY']) !== undefined ||
    nonEmptyEnv(env['GEMINI_API_KEY']) !== undefined
  );
}

/** True when any zero-config media key is present. */
export function mediaProviderKeyReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return mediaImageKeyReady(env) || mediaVideoKeyReady(env);
}

/** Compact footer badge for beginner-visible media readiness (no MCP). */
/** Compact footer badge for default ZDR-friendly local posture (telemetry off). */
export function formatZdrFooterBadge(
  env: NodeJS.ProcessEnv = process.env,
): { readonly label: string; readonly severity: FooterBadgeSeverity } | null {
  // Product telemetry is opt-in. Absence of SUPERLIORA_TELEMETRY=1 keeps ZDR-friendly local mode.
  const raw = nonEmptyEnv(env['SUPERLIORA_TELEMETRY'] ?? env['TELEMETRY']);
  if (raw !== undefined && ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) {
    return { label: 'tel', severity: 'warning' };
  }
  return { label: 'zdr', severity: 'info' };
}

export function formatMediaFooterBadge(
  env: NodeJS.ProcessEnv = process.env,
): { readonly label: string; readonly severity: FooterBadgeSeverity } | null {
  const image = mediaImageKeyReady(env);
  const video = mediaVideoKeyReady(env);
  if (!image && !video) return null;
  // Beginner-readable dense badges: modalities that are zero-config ready (no MCP).
  if (image && video) return { label: 'img·vid', severity: 'info' };
  if (image) return { label: 'img', severity: 'info' };
  return { label: 'vid', severity: 'info' };
}

/** Compact footer badge for always-on web research (no MCP). */
export function formatWebFooterBadge(): {
  readonly label: string;
  readonly severity: FooterBadgeSeverity;
} {
  // WebSearch + FetchURL + Context7 are built-in zero-config research tools.
  return { label: 'web', severity: 'info' };
}

/** Compact footer badge for office skills via SearchSkill (no MCP). */
export function formatOfficeFooterBadge(): {
  readonly label: string;
  readonly severity: FooterBadgeSeverity;
} {
  // docx / pptx / xlsx skills are catalog-ready for Word, slides, sheets.
  return { label: 'office', severity: 'info' };
}

/** Context usage line severity aligned with soft/hard reclaim ladder. */
export function contextUsageSeverity(usage: number): FooterBadgeSeverity {
  const ratio = safeUsage(usage);
  if (ratio >= 0.9) return 'danger';
  // Ladder: soft 0.011 · handoff 0.018 · hard 0.38 · abs10k.
  // Soft → info (reclaim soon); hard → warning (stop before rot); ≥0.9 → danger.
  if (ratio >= 0.38) return 'warning';
  if (ratio >= 0.011) return 'info';
  return 'muted';
}

function formatTranscriptViewportBadge(
  viewport: FooterTranscriptViewportSnapshot | undefined,
  colors: ColorPalette,
): string | null {
  const status = projectRendererViewportHistoryStatus(viewport);
  if (status === undefined) return null;
  return chalk.hex(colors.warning).bold(`[${status.label}]`);
}

function footerNextAction(state: AppState, git: GitStatus | null): string | null {
  if (state.isCompacting) return ttui('tui.footer.compacting');
  if (state.isBackgroundCompacting) return ttui('tui.footer.compacting.background');
  if (state.isReplaying) return ttui('tui.footer.replaying');
  if (state.model.trim().length === 0) return ttui('tui.footer.next.login');
  if (safeUsage(state.contextUsage) >= 0.011) return ttui('tui.footer.next.compact');
  if (
    state.contextOS !== undefined &&
    state.contextOS !== null &&
    state.contextOS.missingEvidencePageCount > 0
  ) {
    return 'durable evidence missing after compaction — verify IDs before resume';
  }
  if (state.ultraworkMode) {
    return ttui('tui.footer.ultrawork');
  }
  if (state.premiumQualityMode) {
    return ttui('tui.footer.premium');
  }
  if (state.streamingPhase !== 'idle') return null;
  if (git?.dirty === true) return ttui('tui.footer.next.review');
  // Beginner path: surface media readiness when keys are missing (image/video are zero-config otherwise).
  if (!mediaProviderKeyReady()) {
    return ttui('tui.footer.next.media');
  }
  return ttui('tui.footer.next.default');
}

export function formatFooterGitBadge(status: GitStatus, colors: ColorPalette): string {
  const base = chalk.hex(colors.textDim)(formatGitBadgeBase(status));
  if (status.pullRequest === null) return base;

  const pullRequest = chalk.hex(colors.primary)(
    formatPullRequestBadge(status.pullRequest, { linkPullRequest: true }),
  );
  return `${base} ${pullRequest}`;
}

export class FooterComponent implements Component {
  private state: AppState;
  private readonly onRefresh: () => void;
  private readonly getTranscriptViewport: (() => FooterTranscriptViewportSnapshot) | undefined;
  private gitCache: GitStatusCache;
  private gitCacheWorkDir: string;
  private transientHint: string | null = null;
  private goalSnapshotKey: string | null = null;
  private goalObservedAtMs = Date.now();
  private goalTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Non-terminal background-task counts split by kind so the footer can
   * render two distinct badges. `bashTasks` covers `bash-*` BPM tasks
   * spawned via `Shell run_in_background=true`; `agentTasks` covers
   * `agent-*` BPM tasks (background subagents). Either zero hides its
   * respective badge.
   */
  private backgroundBashTaskCount = 0;
  private backgroundAgentCount = 0;

  constructor(
    state: AppState,
    onRefresh: () => void = () => {},
    getTranscriptViewport?: () => FooterTranscriptViewportSnapshot,
  ) {
    this.state = state;
    this.onRefresh = onRefresh;
    this.getTranscriptViewport = getTranscriptViewport;
    this.gitCacheWorkDir = state.workDir;
    this.gitCache = createGitStatusCache(state.workDir, { onChange: this.onRefresh });
    this.syncGoalClock(state.goal);
    this.syncGoalTimer(state.goal);
  }

  setState(state: AppState): void {
    if (state.workDir !== this.gitCacheWorkDir) {
      this.gitCacheWorkDir = state.workDir;
      this.gitCache = createGitStatusCache(state.workDir, { onChange: this.onRefresh });
    }
    this.syncGoalClock(state.goal);
    this.syncGoalTimer(state.goal);
    this.state = state;
  }

  /**
   * Short-lived hint that replaces the rotating toolbar tips on line 1.
   * Used by the exit-confirmation double-tap flow to show "Press Ctrl+C
   * again to exit" without requiring a toast/overlay subsystem.
   * Pass `null` to clear.
   */
  setTransientHint(hint: string | null): void {
    this.transientHint = hint;
  }

  getTransientHint(): string | null {
    return this.transientHint;
  }

  /**
   * Sync both background-task badges with live counts. Each non-zero
   * count produces its own bracketed badge on line 1; zeros hide them
   * independently.
   */
  setBackgroundCounts(counts: { bashTasks: number; agentTasks: number }): void {
    this.backgroundBashTaskCount = Math.max(0, counts.bashTasks);
    this.backgroundAgentCount = Math.max(0, counts.agentTasks);
  }

  invalidate(): void {}

  render(width: number): string[] {
    const colors = currentTheme.palette;
    const state = this.state;
    const appearance = state.appearance ?? DEFAULT_APPEARANCE_PREFERENCES;

    // ── Line 1: mode badges + model + [N task(s) running] + [N agent(s) running] + cwd + git + hints ──
    const left: string[] = [];
    const modes: string[] = [];
    if (state.permissionMode === 'auto') modes.push(chalk.hex(colors.warning).bold('auto'));
    if (state.permissionMode === 'yolo') modes.push(chalk.hex(colors.warning).bold('yolo'));
    if (state.ultraworkMode) {
      modes.push(renderAnimatedGradientText('ultrawork', 'footer:ultrawork', appearance));
    } else if (state.planMode) {
      modes.push(renderPulseText('plan', 'footer:plan', 'primary', appearance));
    }
    if (state.swarmMode) {
      modes.push(renderPulseText('swarm-armed', 'footer:swarm', 'accent', appearance));
    }
    if (state.premiumQualityMode) {
      modes.push(renderAnimatedGradientText('premium', 'footer:premium', appearance));
    }
    if (state.isBackgroundCompacting) {
      modes.push(renderPulseText('compact-bg', 'footer:compact-bg', 'warning', appearance));
    } else if (state.isCompacting) {
      modes.push(renderPulseText('compact', 'footer:compact', 'primary', appearance));
    }
    const mediaBadge = formatMediaFooterBadge();
    if (mediaBadge !== null) {
      modes.push(
        renderPulseText(mediaBadge.label, `footer:${mediaBadge.label}`, 'accent', appearance),
      );
    }
    const webBadge = formatWebFooterBadge();
    modes.push(renderPulseText(webBadge.label, `footer:${webBadge.label}`, 'accent', appearance));
    const officeBadge = formatOfficeFooterBadge();
    modes.push(renderPulseText(officeBadge.label, `footer:${officeBadge.label}`, 'accent', appearance));
    const zdrBadge = formatZdrFooterBadge();
    if (zdrBadge !== null) {
      modes.push(
        renderPulseText(zdrBadge.label, `footer:${zdrBadge.label}`, 'primary', appearance),
      );
    }
    if (modes.length > 0) left.push(modes.join(' '));

    const transcriptViewportBadge = formatTranscriptViewportBadge(
      this.getTranscriptViewport?.(),
      colors,
    );
    if (transcriptViewportBadge !== null) left.push(transcriptViewportBadge);

    const goalBadge = formatGoalBadge(state.goal, colors, this.goalWallClockMs(state.goal));
    if (goalBadge !== null) left.push(goalBadge);

    const model = modelDisplayName(state);
    if (model) {
      const thinkingLabel = state.thinking ? ' thinking' : '';
      const modelLabel = `${model}${thinkingLabel}`;
      left.push(
        state.streamingPhase === 'idle' && !state.thinking
          ? chalk.hex(colors.text)(modelLabel)
          : renderPulseText(modelLabel, 'footer:model', 'text', appearance),
      );
    }

    // Background-task badges sit immediately before cwd. `bash-*` tasks
    // (shell processes) and `agent-*` tasks (background subagents) get
    // separate badges so the user can distinguish them at a glance.
    if (this.backgroundBashTaskCount > 0) {
      const noun = this.backgroundBashTaskCount === 1 ? 'task' : 'tasks';
      left.push(
        renderPulseText(
          `[${String(this.backgroundBashTaskCount)} ${noun} running]`,
          'footer:bash-tasks',
          'primary',
          appearance,
        ),
      );
    }
    if (this.backgroundAgentCount > 0) {
      const noun = this.backgroundAgentCount === 1 ? 'agent' : 'agents';
      left.push(
        renderPulseText(
          `[${String(this.backgroundAgentCount)} ${noun} running]`,
          'footer:agent-tasks',
          'primary',
          appearance,
        ),
      );
    }

    const cwd = shortenCwd(state.workDir);
    if (cwd) left.push(chalk.hex(colors.textDim)(cwd));

    const git = this.gitCache.getStatus();
    if (git !== null) {
      left.push(formatFooterGitBadge(git, colors));
    }

    const leftLine = left.join('  ');
    const leftWidth = visibleWidth(leftLine);

    // Rotating hint tips, fill remaining space on line 1.
    const { primary, pair } = tipsForIndex(currentTipIndex());
    const gap = 2;
    const remaining = Math.max(0, width - leftWidth - gap);
    let tipText = '';
    if (pair && visibleWidth(pair) <= remaining) {
      tipText = pair;
    } else if (primary && visibleWidth(primary) <= remaining) {
      tipText = primary;
    }

    let line1: string;
    if (tipText) {
      const pad = width - leftWidth - visibleWidth(tipText);
      line1 = leftLine + ' '.repeat(Math.max(0, pad)) + chalk.hex(colors.textMuted)(tipText);
    } else if (leftWidth <= width) {
      line1 = leftLine;
    } else {
      line1 = truncateToWidth(leftLine, width, '…');
    }

    // ── Line 2: transient hint (bottom-left) + context (right) ──
    const contextBase = formatContextStatus(
      state.contextUsage,
      state.contextTokens,
      state.maxContextTokens,
    );
    const contextOsBadge = formatContextOSFooterBadge(state.contextOS);
    const microBadge = formatMicroCompactionFooterBadge(state.microCompaction);
    const usageSeverity = contextUsageSeverity(state.contextUsage);
    const contextParts: string[] = [
      styleFooterBadge({ text: contextBase, severity: usageSeverity }, colors, appearance),
    ];
    if (contextOsBadge !== null) {
      contextParts.push(styleFooterBadge(contextOsBadge, colors, appearance));
    }
    if (microBadge !== null) {
      contextParts.push(styleFooterBadge(microBadge, colors, appearance));
    }
    const contextText = contextParts.join(chalk.hex(colors.textMuted)(' · '));
    const contextWidth = visibleWidth(contextText);
    let line2: string;
    const nextAction = footerNextAction(state, git);
    const shimmer =
      this.transientHint === null
        ? renderShimmerPrefix(appearance)
        : '';
    const leftHint = this.transientHint ?? (nextAction === null ? null : shimmer + nextAction);
    if (leftHint !== null) {
      const maxHintWidth = Math.max(0, width - contextWidth - 1);
      const shownHint =
        visibleWidth(leftHint) <= maxHintWidth
          ? leftHint
          : truncateToWidth(leftHint, maxHintWidth, '…');
      const hintWidth = visibleWidth(shownHint);
      const pad = Math.max(0, width - hintWidth - contextWidth);
      const hintStyle = this.transientHint !== null
        ? chalk.hex(colors.warning).bold
        : chalk.hex(colors.textDim);
      line2 = hintStyle(shownHint) + ' '.repeat(pad) + contextText;
    } else {
      const leftPad = Math.max(0, width - contextWidth);
      line2 = ' '.repeat(leftPad) + contextText;
    }

    return [truncateToWidth(line1, width), truncateToWidth(line2, width)];
  }

  /**
   * Tear down owned resources (goal timer). Called from the TUI shutdown path
   * so the refresh interval does not keep firing into a stopped renderer.
   * Idempotent.
   */
  dispose(): void {
    if (this.goalTimer !== null) {
      clearInterval(this.goalTimer);
      this.goalTimer = null;
    }
  }

  private syncGoalClock(goal: AppState['goal']): void {
    const key = goalSnapshotKey(goal);
    if (key === this.goalSnapshotKey) return;
    this.goalSnapshotKey = key;
    this.goalObservedAtMs = Date.now();
  }

  private syncGoalTimer(goal: AppState['goal']): void {
    if (goal?.status === 'active') {
      if (this.goalTimer !== null) return;
      this.goalTimer = setInterval(() => {
        this.onRefresh();
      }, GOAL_TIMER_INTERVAL_MS);
      this.goalTimer.unref?.();
      return;
    }

    if (this.goalTimer !== null) {
      clearInterval(this.goalTimer);
      this.goalTimer = null;
    }
  }

  private goalWallClockMs(goal: AppState['goal']): number | undefined {
    if (goal === null || goal === undefined) return undefined;
    if (goal.status !== 'active') return goal.wallClockMs;
    return goal.wallClockMs + Math.max(0, Date.now() - this.goalObservedAtMs);
  }
}

function goalSnapshotKey(goal: AppState['goal']): string | null {
  if (goal === null || goal === undefined) return null;
  return [
    goal.goalId,
    goal.status,
    goal.terminalReason ?? '',
    String(goal.turnsUsed),
    String(goal.tokensUsed),
    String(goal.wallClockMs),
    String(goal.budget.tokenBudget),
    String(goal.budget.turnBudget),
    String(goal.budget.wallClockBudgetMs),
  ].join('\u0000');
}
