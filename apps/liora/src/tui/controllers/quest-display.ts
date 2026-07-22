/**
 * Quest Display — Gen 50 presentation formatters.
 *
 * Turns the attention/urgency building blocks (Gen 47 summary, Gen 49
 * ranking) into ready-to-render strings for the dashboard summary bar and
 * triage overlays. Pure and side-effect free so the formatting is
 * unit-testable in isolation.
 */

import { formatElapsed, type Quest } from './quest-types';
import type { AttentionSummary, EscalationLevel } from './attention-controller';
import { rankQuestsByUrgency } from './quest-urgency';

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
