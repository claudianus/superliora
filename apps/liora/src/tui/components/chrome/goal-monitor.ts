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
import chalk from 'chalk';

import { formatGoalElapsed } from '#/tui/components/messages/goal-format';
import type { ColorPalette } from '#/tui/theme/colors';
import type { ColorToken } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPremiumAccentLine,
  renderPulseGlyph,
  renderPulseText,
  renderSettleFlash,
  renderSpectacularText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { formatTokenCount } from '#/utils/usage/usage-format';

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
  return ` Goal · ${goal.status} `;
}

/**
 * Build the multi-line goal monitor body (no outer panel frame).
 * `wallClockMs` should already include the live timer delta for active goals.
 * `changedAtMs` triggers a short settle-flash on objective when status flips.
 */
export function renderGoalMonitorLines(options: {
  readonly goal: GoalSnapshot & { readonly status: LiveGoalStatus };
  readonly colors: ColorPalette;
  readonly width: number;
  readonly wallClockMs: number;
  readonly changedAtMs?: number;
  readonly profile?: 'tiny' | 'compact' | 'standard' | 'wide' | 'ultrawide';
}): string[] {
  const { goal, colors, width, wallClockMs } = options;
  const profile = options.profile ?? 'standard';
  const appearance = getActiveAppearancePreferences();
  const ambient = shouldRenderAmbientEffects(appearance);
  const statusToken = goalMonitorStatusToken(goal.status);
  const contentWidth = Math.max(1, width);
  const lines: string[] = [];

  // Status row: pulse glyph + status label + elapsed · turns
  const statusGlyph = ambient
    ? renderPulseGlyph(
        goal.status === 'active'
          ? ['●', '◆', '✦', '◆']
          : goal.status === 'blocked'
            ? ['⚠', '●', '⚠', '●']
            : ['○', '◌', '○', '◌'],
        `goal:lifecycle:${goal.status}`,
        goal.status === 'blocked' ? '⚠' : goal.status === 'paused' ? '○' : '●',
        statusToken,
        appearance,
      )
    : chalk.hex(colors[statusToken])(
        goal.status === 'blocked' ? '⚠' : goal.status === 'paused' ? '○' : '●',
      );

  const statusLabel = ambient
    ? renderPulseText(goal.status, `goal:lifecycle:label:${goal.status}`, statusToken, appearance)
    : chalk.hex(colors[statusToken]).bold(goal.status);

  const elapsed = formatGoalElapsed(wallClockMs);
  const turns =
    goal.budget.turnBudget !== null
      ? `${goal.turnsUsed}/${goal.budget.turnBudget} turns`
      : `${goal.turnsUsed} ${goal.turnsUsed === 1 ? 'turn' : 'turns'}`;
  const meta = chalk.hex(colors.textDim)(`${elapsed} · ${turns}`);
  const statusRow = `  ${statusGlyph} ${statusLabel} ${chalk.hex(colors.textMuted)('·')} ${meta}`;
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
    objectiveText = chalk.hex(colors.text).bold(goal.objective);
  }

  const bar = chalk.hex(colors[statusToken])('▌');
  const objectiveIndent = `  ${bar} `;
  const objectiveWrapWidth = Math.max(1, contentWidth - visibleWidth(objectiveIndent));
  const objectiveLines = wrapAndCap(objectiveText, objectiveWrapWidth, MAX_OBJECTIVE_LINES);
  for (const [index, line] of objectiveLines.entries()) {
    const prefix = index === 0 ? objectiveIndent : `  ${chalk.hex(colors[statusToken])('│')} `;
    lines.push(truncateToWidth(`${prefix}${line}`, contentWidth, '…'));
  }

  if (goal.completionCriterion !== undefined && goal.completionCriterion.length > 0) {
    const criterionPrefix = `  ${chalk.hex(colors[statusToken])('▌')} `;
    const criterionBody = chalk.hex(colors.textDim)(`✓ ${goal.completionCriterion}`);
    const criterionWrap = Math.max(1, contentWidth - visibleWidth(criterionPrefix));
    for (const line of wrapAndCap(criterionBody, criterionWrap, MAX_CRITERION_LINES)) {
      lines.push(truncateToWidth(`${criterionPrefix}${line}`, contentWidth, '…'));
    }
  }

  if (profile === 'tiny') {
    return lines;
  }

  // Progress + budget strip
  lines.push(renderGoalProgressStrip(goal, colors, wallClockMs, contentWidth, ambient));

  if (goal.status === 'blocked' && goal.terminalReason !== undefined) {
    const reason = chalk.hex(colors.warning)(
      `  ⚠ ${truncateToWidth(goal.terminalReason, Math.max(8, contentWidth - 4), '…')}`,
    );
    lines.push(reason);
  } else if (goal.status === 'paused' && goal.terminalReason !== undefined) {
    lines.push(
      chalk.hex(colors.textDim)(
        `  paused — ${truncateToWidth(goal.terminalReason, Math.max(8, contentWidth - 12), '…')}`,
      ),
    );
  }

  return lines;
}

function renderGoalProgressStrip(
  goal: GoalSnapshot,
  colors: ColorPalette,
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
    const barColor =
      primary.ratio >= 0.9 ? colors.warning : primary.ratio >= 0.7 ? colors.accent : colors.primary;
    const bar = renderRendererRatioProgressBar({
      ratio: primary.ratio,
      width: PROGRESS_BAR_WIDTH,
      filledStyle: (text) => chalk.hex(barColor)(text),
      emptyStyle: (text) => chalk.hex(colors.textMuted)(text),
    });
    const pct = chalk.hex(colors.textDim)(` ${String(Math.round(primary.ratio * 100))}%`);
    const label = ambient
      ? renderPremiumAccentLine(primary.key, `goal:progress:${primary.key}`)
      : chalk.hex(colors.primary)(primary.key);
    parts.push(`${label} ${bar}${pct}`);
  }

  // Remaining budget chips
  if (budget.remainingTurns !== null) {
    parts.push(chalk.hex(colors.textDim)(`${budget.remainingTurns} turns left`));
  }
  if (budget.remainingTokens !== null) {
    parts.push(chalk.hex(colors.textDim)(`${formatTokenCount(budget.remainingTokens)} tok left`));
  }
  if (budget.remainingWallClockMs !== null) {
    const remaining = Math.max(0, budget.remainingWallClockMs - Math.max(0, wallClockMs - goal.wallClockMs));
    // When wall clock is live-adjusted, recompute remaining from absolute budget.
    const liveRemaining =
      budget.wallClockBudgetMs !== null
        ? Math.max(0, budget.wallClockBudgetMs - wallClockMs)
        : remaining;
    parts.push(chalk.hex(colors.textDim)(`${formatGoalElapsed(liveRemaining)} left`));
  }

  // Always show token spend for context even without a budget.
  if (budget.tokenBudget === null) {
    parts.push(chalk.hex(colors.textDim)(`${formatTokenCount(goal.tokensUsed)} tok`));
  }

  if (budget.overBudget) {
    parts.push(chalk.hex(colors.warning).bold('over budget'));
  }

  const joined = `  ${parts.join(chalk.hex(colors.textMuted)(' · '))}`;
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
