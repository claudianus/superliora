import { GOAL_DOT } from '#/tui/constant/symbols';
import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { currentTheme } from '#/tui/theme/theme';
import type { AppState } from '#/tui/types';
import {
  renderAnimatedGradientText,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

const SOTA_GOAL_OBJECTIVE_PATTERN = /\b(?:ultrawork|sota|harness|tui|zdr)\b|super\s+kimi/i;

function formatBadgeElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

/**
 * Footer goal badge, e.g. `[goal ● active · 4m · 7 turns]`. Only shown for a
 * live (active/paused) goal; terminal/no goal -> no badge. Turn count is a raw
 * count unless an explicit turn budget is set, in which case it shows used/limit.
 */
export function formatGoalBadge(
  goal: AppState['goal'],
  wallClockMs?: number,
  appearance = DEFAULT_APPEARANCE_PREFERENCES,
): string | null {
  if (goal === null || goal === undefined) return null;
  // Show the badge for every persisted, resumable status. `complete` clears the
  // goal, so it never reaches here; only the unset case returns null.
  if (goal.status !== 'active' && goal.status !== 'paused' && goal.status !== 'blocked') {
    return null;
  }
  const statusToken =
    goal.status === 'active' ? 'primary' : goal.status === 'blocked' ? 'warning' : 'textMuted';
  const turns =
    goal.budget.turnBudget !== null
      ? `${goal.turnsUsed}/${goal.budget.turnBudget} turns`
      : `${goal.turnsUsed} ${goal.turnsUsed === 1 ? 'turn' : 'turns'}`;
  const elapsed = formatBadgeElapsed(wallClockMs ?? goal.wallClockMs);
  const isSotaGoal = SOTA_GOAL_OBJECTIVE_PATTERN.test(goal.objective);
  const statusTick = shouldRenderAmbientEffects(appearance)
    ? renderPulseText(goal.status, `footer:goal:${goal.status}`, statusToken, appearance)
    : currentTheme.fg(statusToken, goal.status);
  // Keep statusTick/dot pulsed; elapsed · turns stay muted chrome meta.
  const label = statusTick + currentTheme.fg('textMuted', ` · ${elapsed} · ${turns}`);
  const dot = shouldRenderAmbientEffects(appearance)
    ? renderPulseText(GOAL_DOT, 'footer:goal:dot', statusToken, appearance)
    : currentTheme.fg(statusToken, GOAL_DOT);
  if (isSotaGoal) {
    // Easter egg: goals matching SOTA_GOAL_OBJECTIVE_PATTERN light the whole
    // badge label up with the brand gradient wave (static bold primary when
    // ambient motion is off).
    const sotaLabel = shouldRenderAmbientEffects(appearance)
      ? renderAnimatedGradientText(
          'SuperLiora SOTA',
          `footer:sota:${goal.objective}`,
          appearance,
        )
      : currentTheme.boldFg('primary', 'SuperLiora SOTA');
    return (
      currentTheme.fg('textMuted', '[goal ') +
      dot +
      currentTheme.fg('textMuted', ' ') +
      sotaLabel +
      currentTheme.fg('textMuted', ' / ') +
      label +
      currentTheme.fg('textMuted', ']')
    );
  }
  return (
    currentTheme.fg('textMuted', '[goal ') +
    dot +
    currentTheme.fg('textMuted', ' ') +
    label +
    currentTheme.fg('textMuted', ']')
  );
}

export function goalSnapshotKey(goal: AppState['goal']): string | null {
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
