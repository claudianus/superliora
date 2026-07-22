/**
 * Quest Display — Gen 50 presentation formatters.
 *
 * Turns the attention/urgency building blocks (Gen 47 summary, Gen 49
 * ranking) into ready-to-render strings for the dashboard summary bar and
 * triage overlays. Pure and side-effect free so the formatting is
 * unit-testable in isolation.
 */

import { formatElapsed, type Quest, type QuestState, questHealthScore, formatChangeCount, ATTENTION_STATES } from './quest-types';
import type { AttentionSummary, EscalationLevel, AttentionLoadLevel } from './attention-controller';
import { classifyAttentionLoad } from './attention-controller';
import type { ColorToken } from '../theme';
import {
  rankQuestsByUrgency,
  rankQuestsByEscalatedUrgency,
  escalationLevelFor,
  urgencyDistribution,
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

/**
 * Gen 66: a compact context-window usage label, e.g. "62%". The usage is a
 * 0–1 fraction; it is clamped and rounded to a whole percent. Returns null
 * when the usage is undefined or not positive so callers can hide the segment
 * entirely.
 */
export function formatContextUsage(usage: number | undefined): string | null {
  if (usage === undefined || usage <= 0) return null;
  const percent = Math.round(Math.max(0, Math.min(1, usage)) * 100);
  return `${String(percent)}%`;
}

/**
 * Gen 67: severity classification for a quest's health score (0–100).
 * Returns 'healthy' for scores ≥ 70, 'warning' for 40–69, and 'critical' for
 * < 40. Lets callers apply consistent color coding without duplicating the
 * threshold logic.
 */
export function classifyHealthSeverity(score: number): 'healthy' | 'warning' | 'critical' {
  if (score >= 70) return 'healthy';
  if (score >= 40) return 'warning';
  return 'critical';
}

/** Gen 68: a structured health label for a quest, ready for colorized display. */
export interface HealthLabel {
  /** The 0–100 health score. */
  readonly score: number;
  /** The severity classification for color coding. */
  readonly severity: 'healthy' | 'warning' | 'critical';
  /** The display text, e.g. "♥ 82". */
  readonly text: string;
}

/**
 * Gen 68: a structured health label for a quest, e.g. { score: 82,
 * severity: 'healthy', text: '♥ 82' }. Composes questHealthScore() with the
 * Gen 67 severity classification so callers can render the score and apply
 * consistent color coding from a single call.
 */
export function formatHealthLabel(quest: Quest, now: number = Date.now()): HealthLabel {
  const score = questHealthScore(quest, now);
  return {
    score,
    severity: classifyHealthSeverity(score),
    text: `♥ ${String(score)}`,
  };
}

/**
 * Gen 69: a fleet-wide average health label, e.g. "avg ♥ 78". Averages the
 * per-quest health scores (rounded to a whole number) so the summary bar can
 * show overall fleet health at a glance. Returns null when there are no
 * quests so callers can hide the segment entirely.
 */
export function formatFleetHealthSummary(quests: readonly Quest[], now: number = Date.now()): string | null {
  if (quests.length === 0) return null;
  const total = quests.reduce<number>((sum, quest) => sum + questHealthScore(quest, now), 0);
  const average = Math.round(total / quests.length);
  return `avg ♥ ${String(average)}`;
}

/**
 * Gen 70: a fleet-wide change summary, e.g. "+120 −34". Sums the added and
 * removed line counts across all quests so the summary bar can show the total
 * diff footprint at a glance. Returns null when there are no quests so callers
 * can hide the segment entirely.
 */
export function formatFleetChangeSummary(quests: readonly Quest[]): string | null {
  if (quests.length === 0) return null;
  const added = quests.reduce<number>((sum, quest) => sum + quest.changeCount.added, 0);
  const removed = quests.reduce<number>((sum, quest) => sum + quest.changeCount.removed, 0);
  return `+${String(added)} −${String(removed)}`;
}

/**
 * Gen 71: a fleet-wide todo progress summary, e.g. "12/20 todos". Sums the
 * done and total counts across all quests that report todo progress so the
 * summary bar can show overall plan completion at a glance. Returns null when
 * no quest reports any todo items so callers can hide the segment entirely.
 */
export function formatFleetTodoSummary(quests: readonly Quest[]): string | null {
  let done = 0;
  let total = 0;
  for (const quest of quests) {
    if (quest.todoProgress !== undefined && quest.todoProgress.total > 0) {
      done += quest.todoProgress.done;
      total += quest.todoProgress.total;
    }
  }
  if (total === 0) return null;
  return `${String(done)}/${String(total)} todos`;
}

/**
 * Gen 72: a fleet-wide average context-window usage label, e.g. "avg ctx 45%".
 * Averages the context usage across all quests that report it (each a 0–1
 * fraction), rounded to a whole percent. Returns null when no quest reports
 * context usage so callers can hide the segment entirely.
 */
export function formatFleetContextSummary(quests: readonly Quest[]): string | null {
  let sum = 0;
  let count = 0;
  for (const quest of quests) {
    if (quest.contextUsage !== undefined && quest.contextUsage > 0) {
      sum += Math.max(0, Math.min(1, quest.contextUsage));
      count += 1;
    }
  }
  if (count === 0) return null;
  const percent = Math.round((sum / count) * 100);
  return `avg ctx ${String(percent)}%`;
}

/**
 * Gen 73: a fleet-wide model distribution summary, e.g. "3 claude · 1 gpt".
 * Counts quests per model name (ignoring quests without one) and lists them
 * most-used first, breaking ties alphabetically. Returns null when no quest
 * reports a model so callers can hide the segment entirely.
 */
export function formatFleetModelSummary(quests: readonly Quest[]): string | null {
  const counts = new Map<string, number>();
  for (const quest of quests) {
    if (quest.modelName !== undefined && quest.modelName.length > 0) {
      counts.set(quest.modelName, (counts.get(quest.modelName) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const segments = [...counts.entries()]
    .sort((a, b) => (a[1] !== b[1] ? b[1] - a[1] : a[0].localeCompare(b[0])))
    .map(([model, count]) => `${String(count)} ${model}`);
  return segments.join(' · ');
}

/** Gen 74: a structured snapshot of every non-null fleet summary segment. */
export interface FleetSummarySnapshot {
  /** Gen 64 state breakdown, e.g. "5 quests (2 running · 1 approval)". */
  readonly stateSummary: string | null;
  /** Gen 69 average health, e.g. "avg ♥ 78". */
  readonly healthSummary: string | null;
  /** Gen 70 total diff footprint, e.g. "+120 −34". */
  readonly changeSummary: string | null;
  /** Gen 71 total todo progress, e.g. "12/20 todos". */
  readonly todoSummary: string | null;
  /** Gen 72 average context usage, e.g. "avg ctx 45%". */
  readonly contextSummary: string | null;
  /** Gen 73 model distribution, e.g. "3 claude · 1 gpt". */
  readonly modelSummary: string | null;
  /** All non-null segments in display order, ready to join. */
  readonly segments: readonly string[];
}

/**
 * Gen 74: compose the individual fleet summary formatters (Gen 64–73) into a
 * single structured snapshot the dashboard summary bar can render directly.
 * Each segment is computed independently and dropped when null, so the bar
 * shows only the segments that carry information. `segments` lists the
 * non-null segments in display order for easy joining.
 */
export function buildFleetSummarySnapshot(
  quests: readonly Quest[],
  now: number = Date.now(),
): FleetSummarySnapshot {
  const stateSummary = formatFleetStateSummary(quests);
  const healthSummary = formatFleetHealthSummary(quests, now);
  const changeSummary = formatFleetChangeSummary(quests);
  const todoSummary = formatFleetTodoSummary(quests);
  const contextSummary = formatFleetContextSummary(quests);
  const modelSummary = formatFleetModelSummary(quests);
  const segments = [
    stateSummary,
    healthSummary,
    changeSummary,
    todoSummary,
    contextSummary,
    modelSummary,
  ].filter((segment): segment is string => segment !== null);
  return {
    stateSummary,
    healthSummary,
    changeSummary,
    todoSummary,
    contextSummary,
    modelSummary,
    segments,
  };
}

/**
 * Gen 75: a single combined fleet summary line for the dashboard bar. Leads
 * with the Gen 59 escalation-aware attention summary (when anything needs
 * attention) and appends the Gen 74 fleet segments, so the operator sees both
 * the attention situation and the fleet state in one line. Returns null when
 * there are no quests and nothing needs attention.
 */
export function formatCombinedFleetSummary(
  quests: readonly Quest[],
  attentionSummary: AttentionSummary,
  levels: readonly EscalationLevel[],
  now: number = Date.now(),
): string | null {
  const attention = formatEscalatedAttentionSummary(attentionSummary, levels);
  const snapshot = buildFleetSummarySnapshot(quests, now);
  const parts = [attention, ...snapshot.segments].filter(
    (part): part is string => part !== null,
  );
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/**
 * Gen 76: a single compact line describing one quest, e.g.
 * "Fix login [waiting-approval] ♥ 82 +12 -3". Composes the quest name, state,
 * health score, and change count so triage overlays and lists can render a
 * quest summary from one call. The health and change segments are included
 * only when they carry information.
 */
export function formatQuestCompactLine(quest: Quest, now: number = Date.now()): string {
  const parts: string[] = [quest.name, `[${quest.state}]`];
  const health = questHealthScore(quest, now);
  parts.push(`♥ ${String(health)}`);
  const changes = formatChangeCount(quest.changeCount);
  if (changes !== '+0 -0') {
    parts.push(changes);
  }
  return parts.join(' ');
}

/**
 * Gen 77: the Gen 76 compact line with the Gen 54 escalation badge appended,
 * e.g. "Fix login [waiting-approval] ♥ 82 +12 -3 🔥 15m". Long-neglected
 * quests carry their escalation badge inline so triage lists surface neglect
 * at a glance. The badge is omitted for quests that have not crossed an
 * escalation threshold, so this degrades gracefully to the plain compact line.
 */
export function formatEscalatedQuestCompactLine(quest: Quest, now: number = Date.now()): string {
  const base = formatQuestCompactLine(quest, now);
  const level = escalationLevelFor(quest, now);
  const dwellMs =
    quest.attentionEnteredAt !== undefined ? Math.max(0, now - quest.attentionEnteredAt) : null;
  const badge = formatEscalationBadge(level, dwellMs);
  return badge === null ? base : `${base} ${badge}`;
}

/**
 * Gen 79: a summary-bar label for the operator's cognitive load (Gen 78), e.g.
 * "⚠ overloaded (9 pending)". Returns null for the 'normal' level so callers
 * can hide the segment entirely — only elevated and overloaded loads are worth
 * surfacing. The pending count is included so the operator sees the raw demand
 * behind the classification.
 */
export function formatAttentionLoadLabel(
  level: AttentionLoadLevel,
  pendingCount: number,
): string | null {
  if (level === 'normal') return null;
  const icon = level === 'overloaded' ? '🔥' : '⚠';
  return `${icon} ${level} (${String(pendingCount)} pending)`;
}

/**
 * Gen 89: the theme color token for a cognitive load level, so a triage
 * overlay can tint itself by demand — green when comfortable, amber as it
 * approaches capacity, red once the operator is beyond working-memory limits.
 * 'normal' maps to success so a healthy panel still reads as calm rather than
 * unstyled.
 */
export function attentionLoadColorToken(level: AttentionLoadLevel): ColorToken {
  if (level === 'overloaded') return 'error';
  if (level === 'elevated') return 'warning';
  return 'success';
}

/**
 * Gen 80: compute the operator's attention load label directly from a quest
 * list, without needing the live AttentionController. Counts quests currently
 * in an attention state, classifies the load (Gen 78), and renders the label
 * (Gen 79). Returns null when the load is normal so callers can hide the
 * segment. Useful for the dashboard summary bar, which already holds the quest
 * data and does not need to reach into the controller.
 */
export function formatFleetAttentionLoadLine(quests: readonly Quest[]): string | null {
  const pendingCount = quests.filter((quest) => ATTENTION_STATES.has(quest.state)).length;
  return formatAttentionLoadLabel(classifyAttentionLoad(pendingCount), pendingCount);
}

/**
 * Gen 81: the Gen 80 attention load line enriched with how many of the pending
 * quests are critically escalated, e.g. "🔥 overloaded (9 pending, 2
 * critical)". The critical count tells the operator not just how much demand
 * there is, but how much of it is about to time out. Returns null when the
 * load is normal so callers can hide the segment.
 */
export function formatEscalatedFleetAttentionLoadLine(
  quests: readonly Quest[],
  now: number = Date.now(),
): string | null {
  const pending = quests.filter((quest) => ATTENTION_STATES.has(quest.state));
  const level = classifyAttentionLoad(pending.length);
  if (level === 'normal') return null;
  const criticalCount = pending.filter((quest) => escalationLevelFor(quest, now) === 2).length;
  const icon = level === 'overloaded' ? '🔥' : '⚠';
  const base = `${icon} ${level} (${String(pending.length)} pending`;
  return criticalCount > 0 ? `${base}, ${String(criticalCount)} critical)` : `${base})`;
}

/**
 * Gen 82: a one-line triage recommendation telling the operator which quest to
 * handle first, e.g. "→ handle 'Fix login' first 🔥 15m". Picks the most
 * urgent quest (Gen 57 escalation-aware ranking) and appends its escalation
 * badge (Gen 54) so the neglect behind the recommendation is visible. Returns
 * null when nothing needs attention, so callers can hide the segment. This
 * turns the abstract "N pending" load into a concrete next action.
 */
export function formatTriageRecommendationLine(
  quests: readonly Quest[],
  now: number = Date.now(),
): string | null {
  // Only quests needing the operator's action are triage candidates; a happily
  // running quest must never be recommended for handling.
  const pending = quests.filter((quest) => ATTENTION_STATES.has(quest.state));
  if (pending.length === 0) return null;
  const ranked = rankQuestsByEscalatedUrgency(pending, now);
  const top = ranked[0];
  if (top === undefined) return null;
  const level = escalationLevelFor(top.quest, now);
  const dwellMs =
    top.quest.attentionEnteredAt !== undefined
      ? Math.max(0, now - top.quest.attentionEnteredAt)
      : null;
  const badge = formatEscalationBadge(level, dwellMs);
  const base = `→ handle '${top.quest.name}' first`;
  return badge === null ? base : `${base} ${badge}`;
}

/**
 * Gen 83: the next few attention quests in priority order, e.g.
 * "queue: Fix login · Add tests · Refactor". Where Gen 82 names the single
 * most urgent quest, this shows the operator the short queue behind it so they
 * can plan the next couple of interventions. Only quests needing action are
 * listed. Returns null when nothing needs attention so callers can hide the
 * segment.
 */
export function formatTriageQueueLine(
  quests: readonly Quest[],
  topN: number,
  now: number = Date.now(),
): string | null {
  const pending = quests.filter((quest) => ATTENTION_STATES.has(quest.state));
  if (pending.length === 0) return null;
  const limit = Math.max(1, topN);
  const names = rankQuestsByEscalatedUrgency(pending, now)
    .slice(0, limit)
    .map((ranked) => ranked.quest.name);
  return `queue: ${names.join(' · ')}`;
}

/**
 * Gen 84: a structured snapshot of the whole triage panel — the load line
 * (Gen 81), the escalation distribution (Gen 86), the recommendation (Gen 82),
 * and the queue (Gen 83) — so a triage overlay can render everything from a
 * single call. `lines` holds the non-null segments in display order, ready to
 * print; the individual fields stay available for callers that want to style
 * or place each line separately.
 *
 * Gen 88: `loadLevel` exposes the raw cognitive load classification so callers
 * can color or branch on it (e.g. tint the whole panel red when overloaded)
 * without re-deriving it from the quest list.
 *
 * Gen 90: `loadColorToken` is the ready-to-use theme token for that level, so
 * a renderer can paint the panel without mapping the level itself.
 */
export interface TriagePanelSnapshot {
  readonly loadLevel: AttentionLoadLevel;
  readonly loadColorToken: ColorToken;
  readonly loadLine: string | null;
  readonly distributionLine: string | null;
  readonly recommendationLine: string | null;
  readonly queueLine: string | null;
  readonly lines: readonly string[];
}

export function buildTriagePanelSnapshot(
  quests: readonly Quest[],
  queueSize: number,
  now: number = Date.now(),
): TriagePanelSnapshot {
  const pendingCount = quests.filter((quest) => ATTENTION_STATES.has(quest.state)).length;
  const loadLevel = classifyAttentionLoad(pendingCount);
  const loadColorToken = attentionLoadColorToken(loadLevel);
  const loadLine = formatEscalatedFleetAttentionLoadLine(quests, now);
  const distributionLine = formatUrgencyDistributionLine(quests, now);
  const recommendationLine = formatTriageRecommendationLine(quests, now);
  const queueLine = formatTriageQueueLine(quests, queueSize, now);
  const lines = [loadLine, distributionLine, recommendationLine, queueLine].filter(
    (line): line is string => line !== null,
  );
  return {
    loadLevel,
    loadColorToken,
    loadLine,
    distributionLine,
    recommendationLine,
    queueLine,
    lines,
  };
}

/**
 * Gen 86: a one-line breakdown of the fleet's attention quests across
 * escalation levels, e.g. "2 fresh · 1 escalated · 1 critical". Buckets with a
 * zero count are omitted so the line stays compact. Returns null when no quest
 * needs attention so callers can hide the segment. Gives the operator an
 * at-a-glance read on how much of the pending demand is about to time out.
 */
export function formatUrgencyDistributionLine(
  quests: readonly Quest[],
  now: number = Date.now(),
): string | null {
  const { normal, escalated, critical } = urgencyDistribution(quests, now);
  const segments: string[] = [];
  if (normal > 0) segments.push(`${String(normal)} fresh`);
  if (escalated > 0) segments.push(`${String(escalated)} escalated`);
  if (critical > 0) segments.push(`${String(critical)} critical`);
  if (segments.length === 0) return null;
  return segments.join(' · ');
}
