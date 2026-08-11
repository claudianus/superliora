/**
 * Live goal monitor chrome — objective, status pulse, progress bars, and
 * remaining budget — rendered above the Todo Board when a goal is active /
 * paused / blocked. Shared helpers keep footer badge and panel consistent.
 */

import {
  renderRendererRatioProgressBar,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '#/tui/renderer';
import type { GoalSnapshot, GoalStatus } from '@superliora/sdk';

import { formatGoalElapsed } from '#/tui/components/messages/goal/goal-format';
import {
  BLOCKED_GLYPH,
  GOAL_DOT,
  PENDING_GLYPH,
  PULSE_ACTIVE_FRAMES,
  PULSE_BLOCKED_FRAMES,
  PULSE_PAUSED_FRAMES,
} from '#/tui/constant/symbols';
import { currentTheme, type ColorToken } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumAccentLine,
  renderPulseGlyph,
  renderPulseText,
  renderSettleFlash,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { formatGoalBlockedCopy } from '#/tui/utils/job/goal-blocked-copy';
import type { GoalDeskLive } from '#/tui/utils/job/goal-driver-live';
import { formatTokenCount } from '#/utils/usage/usage-format';

export { formatGoalBlockedCopy } from '#/tui/utils/job/goal-blocked-copy';

const MAX_OBJECTIVE_LINES = 2;
const MAX_CRITERION_LINES = 1;
const PROGRESS_BAR_WIDTH = 10;

export type LiveGoalStatus = Extract<GoalStatus, 'active' | 'paused' | 'blocked'>;

export function isLiveGoal(goal: GoalSnapshot | null | undefined): goal is GoalSnapshot & {
  readonly status: LiveGoalStatus;
} {
  return goal !== null && goal !== undefined && isLiveGoalStatus(goal.status);
}

export function isLiveGoalStatus(status: GoalStatus): status is LiveGoalStatus {
  return status === 'active' || status === 'paused' || status === 'blocked';
}

export function goalMonitorBorderToken(status: LiveGoalStatus): ColorToken {
  switch (status) {
    case 'active':
      return 'primary';
    case 'paused':
      return 'textMuted';
    case 'blocked':
      return 'warning';
  }
}

export function goalMonitorStatusToken(status: LiveGoalStatus): ColorToken {
  switch (status) {
    case 'active':
      return 'primary';
    case 'paused':
      return 'textMuted';
    case 'blocked':
      return 'warning';
  }
}

export function goalMonitorTitle(
  goal: GoalSnapshot & { readonly status: LiveGoalStatus },
  profile: 'tiny' | 'compact' | 'standard' | 'wide' | 'ultrawide' = 'standard',
): string {
  if (profile === 'tiny') return ' Goal ';
  if (goal.execution === 'goal-desk') return ` Goal · desk · ${goal.status} `;
  return ` Goal · ${goal.status} `;
}

/**
 * Build the multi-line goal monitor body (no outer panel frame).
 * `wallClockMs` should already include the live timer delta for active goals.
 * `changedAtMs` triggers a short settle-flash on objective when status flips.
 */
export function renderGoalMonitorLines(options: {
  readonly goal: GoalSnapshot & { readonly status: LiveGoalStatus };
  readonly width: number;
  readonly wallClockMs: number;
  readonly changedAtMs?: number;
  readonly profile?: 'tiny' | 'compact' | 'standard' | 'wide' | 'ultrawide';
  /** Goal Desk lane projection (driver / fleet / idle honesty). */
  readonly deskLive?: GoalDeskLive;
}): string[] {
  const { goal, width, wallClockMs } = options;
  const profile = options.profile ?? 'standard';
  const appearance = getActiveAppearancePreferences();
  const ambient = shouldRenderAmbientEffects(appearance);
  const statusToken = goalMonitorStatusToken(goal.status);
  const contentWidth = Math.max(1, width);
  const lines: string[] = [];
  const deskLane = goal.execution === 'goal-desk';

  // Status row: pulse glyph + status label + elapsed · turns
  const fallbackGlyph =
    goal.status === 'blocked'
      ? BLOCKED_GLYPH
      : goal.status === 'paused'
        ? PENDING_GLYPH
        : GOAL_DOT;
  const statusGlyph = ambient
    ? renderPulseGlyph(
        goal.status === 'active'
          ? PULSE_ACTIVE_FRAMES
          : goal.status === 'blocked'
            ? PULSE_BLOCKED_FRAMES
            : PULSE_PAUSED_FRAMES,
        `goal:lifecycle:${goal.status}`,
        fallbackGlyph,
        statusToken,
        appearance,
      )
    : currentTheme.fg(statusToken, fallbackGlyph);

  const statusLabel = ambient
    ? renderPulseText(goal.status, `goal:lifecycle:label:${goal.status}`, statusToken, appearance)
    : currentTheme.boldFg(statusToken, goal.status);

  const elapsed = formatGoalElapsed(wallClockMs);
  const turns =
    goal.budget.turnBudget !== null
      ? `${goal.turnsUsed}/${goal.budget.turnBudget} turns`
      : `${goal.turnsUsed} ${goal.turnsUsed === 1 ? 'turn' : 'turns'}`;
  const laneChip = deskLane
    ? ambient
      ? ` ${renderPulseText('desk', 'goal:lane:desk', 'accent', appearance)}`
      : ` ${currentTheme.fg('accent', 'desk')}`
    : '';
  const meta = currentTheme.fg('textDim', `${elapsed} · ${turns}`);
  const statusRow = `  ${statusGlyph} ${statusLabel}${laneChip} ${currentTheme.fg('textMuted', '·')} ${meta}`;
  lines.push(truncateToWidth(statusRow, contentWidth, '…'));

  // Objective (spectacular on active, settle-flash on lifecycle change)
  const objectiveSeed = `goal:objective:${goal.goalId}`;
  let objectiveText = goal.objective;
  if (
    options.changedAtMs !== undefined &&
    ambient &&
    appearanceAnimationNow() - options.changedAtMs < 700
  ) {
    objectiveText = renderSettleFlash(
      goal.objective,
      `goal:lifecycle:flash:${goal.goalId}`,
      options.changedAtMs,
      appearance,
    );
  } else if (ambient && goal.status === 'active') {
    objectiveText = renderSpectacularText(goal.objective, objectiveSeed, appearance, {
      intense: true,
      pace: 'slow',
    });
  } else {
    objectiveText = currentTheme.boldFg('text', goal.objective);
  }

  const bar = currentTheme.fg(statusToken, '▌');
  const objectiveIndent = `  ${bar} `;
  const objectiveWrapWidth = Math.max(1, contentWidth - visibleWidth(objectiveIndent));
  const objectiveLines = wrapAndCap(objectiveText, objectiveWrapWidth, MAX_OBJECTIVE_LINES);
  for (const [index, line] of objectiveLines.entries()) {
    const prefix = index === 0 ? objectiveIndent : `  ${currentTheme.fg(statusToken, '│')} `;
    lines.push(truncateToWidth(`${prefix}${line}`, contentWidth, '…'));
  }

  if (goal.completionCriterion !== undefined && goal.completionCriterion.length > 0) {
    const criterionPrefix = `  ${currentTheme.fg(statusToken, '▌')} `;
    // Finish-line copy — never a ✓ (that reads as "already met").
    const criterionBody = currentTheme.fg('textDim', `when · ${goal.completionCriterion}`);
    const criterionWrap = Math.max(1, contentWidth - visibleWidth(criterionPrefix));
    for (const line of wrapAndCap(criterionBody, criterionWrap, MAX_CRITERION_LINES)) {
      lines.push(truncateToWidth(`${criterionPrefix}${line}`, contentWidth, '…'));
    }
  }

  if (deskLane) {
    lines.push(
      truncateToWidth(renderGoalDeskLiveLine(options.deskLive, contentWidth, ambient), contentWidth, '…'),
    );
  }

  if (profile === 'tiny') {
    return lines;
  }

  // Progress + budget strip
  lines.push(renderGoalProgressStrip(goal, wallClockMs, contentWidth, ambient));

  if (goal.status === 'blocked') {
    const copy = formatGoalBlockedCopy(goal.terminalReason);
    lines.push(
      currentTheme.fg(
        'warning',
        `  ${BLOCKED_GLYPH} ${truncateToWidth(copy.headline, Math.max(8, contentWidth - 4), '…')}`,
      ),
    );
    if (copy.next !== undefined) {
      lines.push(
        truncateToWidth(
          `  ${currentTheme.fg('textMuted', 'next')} ${currentTheme.fg('textMuted', '·')} ${currentTheme.fg('textDim', copy.next)}`,
          contentWidth,
          '…',
        ),
      );
    }
  } else if (goal.status === 'paused' && goal.terminalReason !== undefined) {
    lines.push(
      currentTheme.dimFg(
        'textDim',
        `  paused — ${truncateToWidth(goal.terminalReason, Math.max(8, contentWidth - 12), '…')}`,
      ),
    );
  }

  return lines;
}

function renderGoalDeskLiveLine(
  live: GoalDeskLive | undefined,
  width: number,
  ambient: boolean,
): string {
  const prefix = `  ${currentTheme.fg('accent', '↳')} `;
  const appearance = getActiveAppearancePreferences();
  const mode = live?.mode ?? 'spinning_up';

  if (mode === 'spinning_up') {
    const waiting = ambient
      ? renderPulseText('spinning up goal worker…', 'goal:desk:wait', 'textDim', appearance)
      : currentTheme.fg('textDim', 'spinning up goal worker…');
    return truncateToWidth(`${prefix}${waiting}`, width, '…');
  }

  if (mode === 'missing_worker') {
    return truncateToWidth(
      `${prefix}${currentTheme.fg('warning', 'no goal worker')} ${currentTheme.fg('textMuted', '·')} ${currentTheme.fg('textDim', 'Alt+J / /goal status')}`,
      width,
      '…',
    );
  }

  if (mode === 'awaiting_conductor') {
    const last =
      live !== undefined && live.mode === 'awaiting_conductor' && live.lastKind !== undefined
        ? `${live.lastKind}${live.lastStatus !== undefined ? ` ${live.lastStatus}` : ''}`
        : 'workers finished';
    return truncateToWidth(
      `${prefix}${currentTheme.fg('warning', 'awaiting Conductor')} ${currentTheme.fg('textMuted', '·')} ${currentTheme.fg('textDim', last)}`,
      width,
      '…',
    );
  }

  if (mode === 'fleet' && live?.mode === 'fleet') {
    const statusBit =
      live.status === 'running'
        ? ambient
          ? renderPulseText(live.kind, 'goal:desk:fleet', 'primary', appearance)
          : currentTheme.fg('primary', live.kind)
        : currentTheme.fg(
            live.status === 'needs_user' || live.status === 'blocked' ? 'warning' : 'textMuted',
            `${live.kind} ${live.status}`,
          );
    const activity = live.liveActivity;
    const detail =
      activity !== undefined && activity.status === 'running'
        ? `${currentTheme.boldFg('text', activity.name)}${
            activity.target !== undefined && activity.target.length > 0
              ? ` ${currentTheme.fg('textDim', truncateToWidth(activity.target, 28, '…'))}`
              : ''
          }`
        : currentTheme.fg('textDim', live.title);
    return truncateToWidth(
      `${prefix}${statusBit} ${currentTheme.fg('textMuted', '·')} ${detail}`,
      width,
      '…',
    );
  }

  const driver = live?.mode === 'driver' ? live.driver : undefined;
  if (driver === undefined) {
    return truncateToWidth(
      `${prefix}${currentTheme.fg('warning', 'no goal worker')} ${currentTheme.fg('textMuted', '·')} ${currentTheme.fg('textDim', 'Alt+J / /goal status')}`,
      width,
      '…',
    );
  }

  if (driver.status === 'blocked' || driver.status === 'failed') {
    return truncateToWidth(
      `${prefix}${currentTheme.fg('warning', 'worker blocked')} ${currentTheme.fg('textMuted', '·')} ${currentTheme.fg('textDim', '/model · /goal resume')}`,
      width,
      '…',
    );
  }

  const statusBit =
    driver.status === 'running'
      ? ambient
        ? renderPulseText('worker', 'goal:desk:worker', 'primary', appearance)
        : currentTheme.fg('primary', 'worker')
      : currentTheme.fg(
          driver.status === 'needs_user' ? 'warning' : 'textMuted',
          driver.status,
        );

  const activity = driver.liveActivity;
  let detail: string;
  if (activity !== undefined && activity.status === 'running') {
    const target =
      activity.target !== undefined && activity.target.length > 0
        ? ` ${currentTheme.fg('textDim', truncateToWidth(activity.target, 28, '…'))}`
        : '';
    detail = `${currentTheme.boldFg('text', activity.name)}${target}`;
  } else if (driver.phase !== undefined && driver.phase.length > 0) {
    detail = currentTheme.fg('textDim', driver.phase);
  } else {
    const tool = driver.recentTools?.at(-1);
    detail =
      tool !== undefined
        ? currentTheme.fg('textDim', tool)
        : currentTheme.fg('textDim', driver.title);
  }

  return truncateToWidth(
    `${prefix}${statusBit} ${currentTheme.fg('textMuted', '·')} ${detail}`,
    width,
    '…',
  );
}

function renderGoalProgressStrip(
  goal: GoalSnapshot,
  wallClockMs: number,
  width: number,
  ambient: boolean,
): string {
  const parts: string[] = [];
  const { budget } = goal;

  // Prefer the most constrained budget for the primary bar; fall back to turn count only.
  const turnRatio =
    budget.turnBudget !== null && budget.turnBudget > 0
      ? clamp01(goal.turnsUsed / budget.turnBudget)
      : null;
  const tokenRatio =
    budget.tokenBudget !== null && budget.tokenBudget > 0
      ? clamp01(goal.tokensUsed / budget.tokenBudget)
      : null;
  const clockRatio =
    budget.wallClockBudgetMs !== null && budget.wallClockBudgetMs > 0
      ? clamp01(wallClockMs / budget.wallClockBudgetMs)
      : null;

  const primary =
    pickHottestRatio([
      { key: 'turns', ratio: turnRatio },
      { key: 'tokens', ratio: tokenRatio },
      { key: 'time', ratio: clockRatio },
    ]) ?? (turnRatio !== null ? { key: 'turns' as const, ratio: turnRatio } : null);

  if (primary !== null) {
    const barToken: ColorToken =
      primary.ratio >= 0.9 ? 'warning' : primary.ratio >= 0.7 ? 'accent' : 'primary';
    const bar = renderRendererRatioProgressBar({
      ratio: primary.ratio,
      width: PROGRESS_BAR_WIDTH,
      filledStyle: (text) => currentTheme.fg(barToken, text),
      emptyStyle: (text) => currentTheme.fg('textMuted', text),
    });
    const pct = currentTheme.fg('textDim', ` ${String(Math.round(primary.ratio * 100))}%`);
    const label = ambient
      ? renderPremiumAccentLine(primary.key, `goal:progress:${primary.key}`)
      : currentTheme.fg('primary', primary.key);
    parts.push(`${label} ${bar}${pct}`);
  }

  // Remaining budget chips
  if (budget.remainingTurns !== null) {
    parts.push(currentTheme.fg('textDim', `${budget.remainingTurns} turns left`));
  }
  if (budget.remainingTokens !== null) {
    parts.push(currentTheme.fg('textDim', `${formatTokenCount(budget.remainingTokens)} tok left`));
  }
  if (budget.remainingWallClockMs !== null) {
    const remaining = Math.max(0, budget.remainingWallClockMs - Math.max(0, wallClockMs - goal.wallClockMs));
    // When wall clock is live-adjusted, recompute remaining from absolute budget.
    const liveRemaining =
      budget.wallClockBudgetMs !== null
        ? Math.max(0, budget.wallClockBudgetMs - wallClockMs)
        : remaining;
    parts.push(currentTheme.fg('textDim', `${formatGoalElapsed(liveRemaining)} left`));
  }

  // Always show token spend for context even without a budget.
  if (budget.tokenBudget === null) {
    parts.push(currentTheme.fg('textDim', `${formatTokenCount(goal.tokensUsed)} tok`));
  }

  if (budget.overBudget) {
    parts.push(currentTheme.boldFg('warning', 'over budget'));
  }

  const joined = `  ${parts.join(currentTheme.fg('textMuted', ' · '))}`;
  return truncateToWidth(joined, width, '…');
}

function pickHottestRatio(
  candidates: readonly { key: 'turns' | 'tokens' | 'time'; ratio: number | null }[],
): { key: 'turns' | 'tokens' | 'time'; ratio: number } | null {
  let best: { key: 'turns' | 'tokens' | 'time'; ratio: number } | null = null;
  for (const candidate of candidates) {
    if (candidate.ratio === null) continue;
    if (best === null || candidate.ratio > best.ratio) {
      best = { key: candidate.key, ratio: candidate.ratio };
    }
  }
  return best;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function wrapAndCap(text: string, width: number, maxLines: number): string[] {
  if (width <= 0 || maxLines <= 0) return [];
  const wrapped = wrapTextWithAnsi(text, width);
  if (wrapped.length <= maxLines) return wrapped;
  const head = wrapped.slice(0, maxLines);
  const last = head[maxLines - 1] ?? '';
  head[maxLines - 1] = truncateToWidth(last, width, '…');
  return head;
}

/** Stable key for detecting goal snapshot identity / progress ticks. */
export function goalMonitorSnapshotKey(goal: GoalSnapshot | null | undefined): string | null {
  if (goal === null || goal === undefined) return null;
  return [
    goal.goalId,
    goal.status,
    goal.terminalReason ?? '',
    String(goal.turnsUsed),
    String(goal.tokensUsed),
    String(goal.wallClockMs),
    goal.objective,
    goal.completionCriterion ?? '',
    String(goal.budget.turnBudget ?? ''),
    String(goal.budget.tokenBudget ?? ''),
    String(goal.budget.wallClockBudgetMs ?? ''),
  ].join('|');
}
