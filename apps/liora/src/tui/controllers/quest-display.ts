/**
 * Quest Display — Gen 50 presentation formatters.
 *
 * Turns the attention/urgency building blocks (Gen 47 summary, Gen 49
 * ranking) into ready-to-render strings for the dashboard summary bar and
 * triage overlays. Pure and side-effect free so the formatting is
 * unit-testable in isolation.
 */

import { formatElapsed, type Quest, type QuestState } from './quest-types';
import type { AttentionSummary, EscalationLevel } from './attention-controller';
import {
  rankQuestsByUrgency,
  rankQuestsByEscalatedUrgency,
  escalationLevelFor,
} from './quest-urgency';

/**
 * Gen 50: one-line attention summary for the dashboard bar, e.g.
 * "3 need attention (oldest 2m)". Returns null when nothing needs attention
 * so callers can hide the segment entirely.
 */
export function formatAttentionSummary(summary: AttentionSummary): string | null {
  if (summary.count === 0) return null;
  const base = `${String(summary.count)} need attention`;
  if (summary.oldestDwellMs === null) return base;
  return `${base} (oldest ${formatElapsed(summary.oldestDwellMs)})`;
}

/**
 * Gen 50: compact triage lines for the top-N most urgent quests, e.g.
 * "1. Fix login bug [waiting-approval]". Most urgent first; returns an empty
 * array when there are no quests.
 */
export function formatUrgencyRank(quests: readonly Quest[], topN: number, now: number = Date.now()): string[] {
  const limit = Math.max(0, topN);
  return rankQuestsByUrgency(quests, now)
    .slice(0, limit)
    .map((ranked, index) => `${String(index + 1)}. ${ranked.quest.name} [${ranked.quest.state}]`);
}

/**
 * Gen 54: a compact escalation badge for a quest cell, e.g. "⚠ 5m" for a
 * warning-level quest or "🔥 15m" for a critical one. Returns null for level 0
 * so callers can hide the badge entirely. The dwell time is included so the
 * operator sees at a glance how long the quest has been ignored.
 */
export function formatEscalationBadge(level: EscalationLevel, dwellMs: number | null): string | null {
  if (level === 0) return null;
  const icon = level === 2 ? '🔥' : '⚠';
  const dwell = dwellMs === null ? '' : ` ${formatElapsed(dwellMs)}`;
  return `${icon}${dwell}`;
}

/**
 * Gen 55: one-line escalation summary for the dashboard bar, e.g.
 * "2 escalated (1 critical)". Returns null when nothing is escalated so
 * callers can hide the segment entirely. The critical count is called out
 * separately so the operator can tell at a glance whether any quest has been
 * ignored long enough to be critical.
 */
export function formatEscalationSummary(levels: readonly EscalationLevel[]): string | null {
  const escalated = levels.filter((level) => level > 0);
  if (escalated.length === 0) return null;
  const criticalCount = escalated.filter((level) => level === 2).length;
  const base = `${String(escalated.length)} escalated`;
  if (criticalCount === 0) return base;
  return `${base} (${String(criticalCount)} critical)`;
}

/**
 * Gen 58: escalation-aware triage lines for the top-N most urgent quests, e.g.
 * "1. Fix login bug [waiting-approval] 🔥 15m". Composes the Gen 57
 * escalated ranking with the Gen 54 badge so long-neglected quests surface
 * first and carry their escalation badge inline. The badge is omitted for
 * quests that have not crossed an escalation threshold.
 */
export function formatEscalatedTriageLines(
  quests: readonly Quest[],
  topN: number,
  now: number = Date.now(),
): string[] {
  const limit = Math.max(0, topN);
  return rankQuestsByEscalatedUrgency(quests, now)
    .slice(0, limit)
    .map((ranked, index) => {
      const base = `${String(index + 1)}. ${ranked.quest.name} [${ranked.quest.state}]`;
      const level = escalationLevelFor(ranked.quest, now);
      const dwellMs =
        ranked.quest.attentionEnteredAt !== undefined
          ? Math.max(0, now - ranked.quest.attentionEnteredAt)
          : null;
      const badge = formatEscalationBadge(level, dwellMs);
      return badge === null ? base : `${base} ${badge}`;
    });
}

/**
 * Gen 59: escalation-aware attention summary for the dashboard bar, e.g.
 * "3 need attention (oldest 2m, 1 critical)". Composes the Gen 47 attention
 * summary with the Gen 53 escalation levels so the operator sees both how
 * long the oldest quest has waited and whether any quest has been ignored
 * long enough to be critical. Returns null when nothing needs attention so
 * callers can hide the segment entirely.
 */
export function formatEscalatedAttentionSummary(
  summary: AttentionSummary,
  levels: readonly EscalationLevel[],
): string | null {
  if (summary.count === 0) return null;
  const criticalCount = levels.filter((level) => level === 2).length;
  const escalatedCount = levels.filter((level) => level > 0).length;
  const parts: string[] = [];
  if (summary.oldestDwellMs !== null) {
    parts.push(`oldest ${formatElapsed(summary.oldestDwellMs)}`);
  }
  if (criticalCount > 0) {
    parts.push(`${String(criticalCount)} critical`);
  } else if (escalatedCount > 0) {
    parts.push(`${String(escalatedCount)} escalated`);
  }
  const base = `${String(summary.count)} need attention`;
  if (parts.length === 0) return base;
  return `${base} (${parts.join(', ')})`;
}

/**
 * Gen 61: a strip-blink label for the thumbnail strip in pinned mode, scaled
 * by the fleet-wide max escalation level (Gen 60). Returns "⚡ BLINK" for a
 * warning-level fleet and "🔥 BLINK" for a critical one, so the strip blinks
 * harder when any quest has been ignored long enough to be critical. Returns
 * null for level 0 so callers can fall back to the plain blink.
 */
export function formatStripBlinkLabel(maxLevel: EscalationLevel): string | null {
  if (maxLevel === 0) return null;
  return maxLevel === 2 ? '🔥 BLINK' : '⚡ BLINK';
}

/**
 * Gen 62: a compact session-cost label, e.g. "$1.23". Returns null when the
 * cost is undefined or not positive so callers can hide the segment entirely.
 * Centralizes the "$N.NN" formatting that was previously duplicated across the
 * dashboard cells and the expand view.
 */
export function formatCostUsd(costUsd: number | undefined): string | null {
  if (costUsd === undefined || costUsd <= 0) return null;
  return `$${costUsd.toFixed(2)}`;
}

/**
 * Gen 63: a fleet-wide total cost label, e.g. "$4.56 total". Sums the given
 * per-quest costs (ignoring undefined entries) and returns null when the total
 * is not positive so callers can hide the segment entirely. Centralizes the
 * fleet total that the summary bar computes inline.
 */
export function formatTotalCostUsd(costs: readonly (number | undefined)[]): string | null {
  const total = costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
  if (total <= 0) return null;
  return `$${total.toFixed(2)} total`;
}

/** Short labels for each quest state, used in the fleet summary. */
const STATE_LABELS: Record<QuestState, string> = {
  idle: 'idle',
  running: 'running',
  blocked: 'blocked',
  'waiting-approval': 'approval',
  done: 'done',
  failed: 'failed',
};

/** Display order for state segments in the fleet summary. */
const STATE_ORDER: readonly QuestState[] = [
  'waiting-approval',
  'failed',
  'blocked',
  'running',
  'idle',
  'done',
];

/**
 * Gen 64: a compact fleet state summary for the dashboard bar, e.g.
 * "5 quests (2 running · 1 approval)". Counts quests per state and lists only
 * the non-zero categories, most urgent first. Returns null when there are no
 * quests so callers can hide the segment entirely.
 */
export function formatFleetStateSummary(quests: readonly Quest[]): string | null {
  if (quests.length === 0) return null;
  const counts = new Map<QuestState, number>();
  for (const quest of quests) {
    counts.set(quest.state, (counts.get(quest.state) ?? 0) + 1);
  }
  const segments = STATE_ORDER.filter((state) => (counts.get(state) ?? 0) > 0).map(
    (state) => `${String(counts.get(state))} ${STATE_LABELS[state]}`,
  );
  const total = `${String(quests.length)} quest${quests.length === 1 ? '' : 's'}`;
  if (segments.length === 0) return total;
  return `${total} (${segments.join(' · ')})`;
}

/**
 * Gen 65: a compact todo progress label, e.g. "3/5". Returns null when the
 * progress is undefined or has no items so callers can hide the segment
 * entirely. Centralizes the "done/total" formatting previously inlined in the
 * thumbnail strip.
 */
export function formatTodoProgress(progress: { done: number; total: number } | undefined): string | null {
  if (progress === undefined || progress.total <= 0) return null;
  return `${String(progress.done)}/${String(progress.total)}`;
}
