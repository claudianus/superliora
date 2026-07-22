/**
 * Quest Urgency — Gen 38 triage scoring.
 *
 * Turns a quest's lifecycle state and how long it has been left unattended
 * into a single urgency number so the dashboard can surface the most
 * neglected quest first. The state dominates the score (a quest awaiting
 * approval always outranks a healthy one); within the same state the quest
 * that has waited longest wins.
 *
 * Pure and side-effect free so the scoring is unit-testable in isolation.
 */

import {
  type Quest,
  questStatePriority,
  ATTENTION_STATES,
} from './quest-types';
import {
  type EscalationLevel,
  ATTENTION_ESCALATION_MS,
  ATTENTION_CRITICAL_MS,
} from './attention-controller';

/** Weight per state-priority level — large enough to dominate dwell time. */
const STATE_WEIGHT = 1_000_000;

/**
 * Gen 56: discrete urgency bonus added per escalation level. Large enough to
 * create a visible step at each escalation threshold (so a just-escalated
 * quest jumps ahead of a same-state quest that has waited almost as long),
 * but small enough that it never crosses a state-priority boundary under
 * normal dwell times.
 */
const ESCALATION_BONUS = 100_000;

/**
 * Gen 38: urgency score for a quest. Higher means more urgent. The state
 * priority contributes the dominant term; a quest sitting in an attention
 * state adds the milliseconds it has been waiting so the longest-neglected
 * quest of equal priority sorts first.
 */
export function questUrgencyScore(quest: Quest, now: number = Date.now()): number {
  // Invert state priority so attention states (priority 0) weigh the most.
  const stateWeight = (6 - questStatePriority(quest.state)) * STATE_WEIGHT;
  const dwell =
    quest.attentionEnteredAt !== undefined && ATTENTION_STATES.has(quest.state)
      ? Math.max(0, now - quest.attentionEnteredAt)
      : 0;
  return stateWeight + dwell;
}

/**
 * Gen 38: comparator for triage ordering. Returns negative when `a` is more
 * urgent than `b` (so `a` sorts first). Falls back to insertion-stable order
 * via the caller when scores tie exactly.
 */
export function compareByUrgency(a: Quest, b: Quest, now: number = Date.now()): number {
  return questUrgencyScore(b, now) - questUrgencyScore(a, now);
}

/** Gen 49: a quest paired with its computed urgency score. */
export interface RankedQuest {
  readonly quest: Quest;
  readonly score: number;
}

/**
 * Gen 49: rank a list of quests by urgency, most urgent first, each paired
 * with its score. Stable for equal scores (preserves input order). Useful for
 * triage UIs that want to show the top-N most urgent quests with their scores.
 */
export function rankQuestsByUrgency(
  quests: readonly Quest[],
  now: number = Date.now(),
): RankedQuest[] {
  return quests
    .map((quest, index) => ({ quest, score: questUrgencyScore(quest, now), index }))
    .sort((a, b) => (a.score !== b.score ? b.score - a.score : a.index - b.index))
    .map(({ quest, score }) => ({ quest, score }));
}

/**
 * Gen 56: the escalation level for a quest derived purely from its dwell time
 * in an attention state. Mirrors AttentionController.getEscalationLevel() but
 * stays pure so it can be used in scoring without a controller instance.
 * Returns 0 when the quest is not in an attention state or has not reached
 * the escalation threshold.
 */
export function escalationLevelFor(quest: Quest, now: number = Date.now()): EscalationLevel {
  if (quest.attentionEnteredAt === undefined || !ATTENTION_STATES.has(quest.state)) return 0;
  const dwell = Math.max(0, now - quest.attentionEnteredAt);
  if (dwell < ATTENTION_ESCALATION_MS) return 0;
  if (dwell >= ATTENTION_CRITICAL_MS) return 2;
  return 1;
}

/**
 * Gen 56: urgency score that adds a discrete bonus per escalation level on top
 * of the base Gen 38 score. A quest that has crossed an escalation threshold
 * jumps ahead of a same-state quest that has waited almost as long, so the
 * dashboard surfaces long-neglected quests more aggressively.
 */
export function escalatedUrgencyScore(quest: Quest, now: number = Date.now()): number {
  return questUrgencyScore(quest, now) + escalationLevelFor(quest, now) * ESCALATION_BONUS;
}
